import WDK from '@tetherto/wdk';
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';
import { JsonRpcProvider } from 'ethers';
import type { SafeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import {
  evaluateSepoliaEthTransfer, formatWeiAsEth, parseEthToWei, SEPOLIA_CHAIN_ID,
  SEPOLIA_ETH_POLICY, SEPOLIA_RPC_URL, SEPOLIA_VERIFICATION_RPC_URL, validateEvmAddress,
} from './sepolia-domain.js';

const WALLET_ID = 'atg-sepolia-only';
interface VaultRecord { schemaVersion: 1; encryptedSeed: string; backupConfirmed: boolean }
export interface WalletStatus { setup: 'not-created' | 'backup-required' | 'ready' | 'unavailable'; network: 'verified' | 'unavailable' | 'unsupported' | 'not-checked'; address: string | null; balanceWei: string | null; refreshedAt: string | null; error?: string }
export interface TransferQuote {
  proposalId: string; chainId: number; asset: 'native-ETH'; recipient: string; amountWei: string;
  feeWei: string; totalDebitWei: string; gasLimit: string; maxFeePerGas: string; maxPriorityFeePerGas: string | null; decision: 'allow' | 'require_approval' | 'deny'; reason: string;
}

export class SepoliaWalletService {
  private inFlight = false;
  private backupPhrase: string | null = null;
  private backupPhraseDelivered = false;
  private pendingVault: VaultRecord | null = null;
  private pendingAddress: string | null = null;
  private recoveryMode = false;
  private recoveryAwaitingConfirm = false;
  private quoteCache = new Map<string, TransferQuote>();
  private approved = new Set<string>();
  private creatingWallet = false;

  constructor(private readonly vaultPath: string, private readonly safeStorage: SafeStorage) {}

  async getStatus(): Promise<WalletStatus> {
    const record = await this.loadVault();
    if (!record && this.pendingVault) return { setup: 'backup-required', network: 'not-checked', address: this.pendingAddress, balanceWei: null, refreshedAt: null };
    if (!record) return { setup: 'not-created', network: 'not-checked', address: null, balanceWei: null, refreshedAt: null };
    const address = await this.withAccount(record, async (account, wdk) => {
      try {
        const walletAddress = await account.getAddress();
        try {
          const [chainId, balance] = await Promise.all([this.rpc('eth_chainId', []), account.getBalance()]);
          if (Number(BigInt(chainId)) !== SEPOLIA_CHAIN_ID) return { address: walletAddress, balanceWei: null, network: 'unsupported' as const, error: 'RPC chain ID does not match Sepolia.' };
          return { address: walletAddress, balanceWei: balance.toString(), network: 'verified' as const };
        } catch { return { address: walletAddress, balanceWei: null, network: 'unavailable' as const, error: 'Sepolia RPC is unavailable; balance was not refreshed.' }; }
      } finally { wdk.dispose(); }
    });
    return { setup: record.backupConfirmed ? 'ready' : 'backup-required', network: address.network, address: address.address, balanceWei: address.balanceWei, refreshedAt: address.balanceWei === null ? null : new Date().toISOString(), ...('error' in address ? { error: address.error } : {}) };
  }

  async createWallet(): Promise<{ address: string }> {
    if (this.creatingWallet) throw new Error('Wallet setup is already in progress.');
    this.creatingWallet = true;
    try {
    if (await this.loadVault() || this.pendingVault) throw new Error('A local Sepolia wallet already exists or is awaiting backup.');
    await this.assertSecureStorage();
    if (Number(BigInt(await this.rpc('eth_chainId', []))) !== SEPOLIA_CHAIN_ID) throw new Error('Sepolia RPC is unavailable or reported a different chain. No wallet was created.');
    const phrase = WDK.getRandomSeedPhrase(12);
    const encrypted = await this.safeStorage.encryptStringAsync(phrase);
    const record: VaultRecord = { schemaVersion: 1, encryptedSeed: encrypted.toString('base64'), backupConfirmed: false };
    this.pendingVault = record;
    this.backupPhrase = phrase;
    try {
      const result = await this.withAccount(record, async (account, wdk) => {
        try {
          return { address: await account.getAddress() };
        } finally { wdk.dispose(); }
      });
      this.pendingAddress = result.address;
      return result;
    } catch (error) {
      this.backupPhrase = null; this.pendingVault = null;
      throw error;
    }
    } finally { this.creatingWallet = false; }
  }

  /** Called only by the dedicated, one-purpose backup window. It can succeed once. */
  consumeBackupPhrase(): string {
    if (!this.backupPhrase) throw new Error('No one-time wallet backup is available.');
    if (this.backupPhraseDelivered) throw new Error('The backup phrase has already been shown in this window.');
    this.backupPhraseDelivered = true;
    return this.backupPhrase;
  }
  hasPendingBackup(): boolean { return this.pendingVault !== null && (this.backupPhrase !== null || this.recoveryAwaitingConfirm); }
  beginBackupWindow(): void { if (this.hasPendingBackup()) this.backupPhraseDelivered = false; }
  beginRecoveryWindow(): void { this.recoveryMode = true; this.backupPhraseDelivered = false; }
  async restoreFromPhrase(raw: unknown): Promise<{ address: string }> {
    if (!this.recoveryMode || typeof raw !== 'string' || !WDK.isValidSeed(raw.trim())) throw new Error('Enter a valid recovery phrase in the dedicated recovery window.');
    if (this.creatingWallet) throw new Error('Wallet setup is already in progress.');
    this.creatingWallet = true;
    try {
      if (await this.loadVault() || this.pendingVault) throw new Error('A local wallet already exists or is being set up.');
      await this.assertSecureStorage();
      if (Number(BigInt(await this.rpc('eth_chainId', []))) !== SEPOLIA_CHAIN_ID) throw new Error('Sepolia RPC is unavailable or reported a different chain.');
      const seed = raw.trim();
      const encrypted = await this.safeStorage.encryptStringAsync(seed);
      const record: VaultRecord = { schemaVersion: 1, encryptedSeed: encrypted.toString('base64'), backupConfirmed: false };
      const derived = await this.withAccount(record, async (account, wdk) => { try { return await account.getAddress(); } finally { wdk.dispose(); } });
      this.pendingVault = record; this.pendingAddress = derived; this.recoveryMode = false; this.recoveryAwaitingConfirm = true;
      return { address: derived };
    } finally { this.creatingWallet = false; }
  }

  setQuoteId(quote: TransferQuote, id: string): TransferQuote {
    const registered = { ...quote, proposalId: id };
    this.quoteCache.set(id, registered);
    return registered;
  }

  approveTransfer(proposalId: string): void {
    if (this.inFlight) throw new Error('Signing or broadcast is already in progress.');
    const quote = this.quoteCache.get(proposalId);
    if (!quote || quote.decision !== 'require_approval') throw new Error('This transfer is not awaiting policy approval.');
    this.approved.add(proposalId);
  }

  cancelTransfer(proposalId: string): void { if (this.inFlight) throw new Error('Signing or broadcast is already in progress.'); this.quoteCache.delete(proposalId); this.approved.delete(proposalId); }

  async confirmBackup(): Promise<void> {
    const record = this.pendingVault;
    if (!record || (!this.backupPhrase && !this.recoveryAwaitingConfirm)) throw new Error('Wallet backup confirmation is unavailable.');
    await this.writeVault({ ...record, backupConfirmed: true });
    this.backupPhrase = null; this.pendingVault = null; this.backupPhraseDelivered = false; this.recoveryAwaitingConfirm = false;
  }

  async quoteTransfer(raw: { recipient: unknown; amount: unknown; chainId: unknown; asset: unknown }): Promise<TransferQuote> {
    if (this.inFlight) throw new Error('A wallet signing or broadcast operation is already in progress.');
    const record = await this.requireReadyVault();
    const recipient = validateEvmAddress(raw.recipient);
    const amountWei = parseEthToWei(raw.amount);
    if (raw.chainId !== SEPOLIA_CHAIN_ID || raw.asset !== 'native-ETH') throw new Error('Only native ETH on Sepolia is supported.');
    const quote = await this.withAccount(record, async (account, wdk) => {
      try {
        const actualChain = Number(BigInt(await this.rpc('eth_chainId', [])));
        if (actualChain !== SEPOLIA_CHAIN_ID) throw new Error('Connected RPC reported an unsupported chain.');
        const transaction = await this.buildTransaction(recipient, amountWei, await account.getAddress());
        const estimate = await account.quoteSendTransaction(transaction);
        const feeWei = BigInt(estimate.fee);
        const balance = await account.getBalance();
        if (amountWei + feeWei > balance) throw new Error('Wallet balance does not cover the amount and estimated fee.');
        const decision = evaluateSepoliaEthTransfer({ chainId: actualChain, asset: 'native-ETH', amountWei, feeWei, policy: SEPOLIA_ETH_POLICY });
        return { proposalId: randomUUID(), chainId: actualChain, asset: 'native-ETH' as const, recipient, amountWei: amountWei.toString(), feeWei: feeWei.toString(), totalDebitWei: (amountWei + feeWei).toString(), gasLimit: String(transaction.gasLimit), maxFeePerGas: String(transaction.maxFeePerGas ?? transaction.gasPrice), maxPriorityFeePerGas: transaction.maxPriorityFeePerGas == null ? null : String(transaction.maxPriorityFeePerGas), decision: decision.outcome, reason: decision.reason };
      } finally { wdk.dispose(); }
    });
    this.quoteCache.set(quote.proposalId, quote);
    return quote;
  }

  async submitTransfer(proposalId: string, onState: (state: string, details?: Record<string, unknown>) => Promise<void>): Promise<{ status: string; hash?: string; error?: string }> {
    if (this.inFlight) throw new Error('A wallet signing or broadcast operation is already in progress.');
    const previous = this.quoteCache.get(proposalId);
    if (!previous) throw new Error('Transfer quote expired. Create and review a fresh quote.');
    if (previous.decision === 'deny') throw new Error('Policy denied this transfer.');
    if (previous.decision === 'require_approval' && !this.approved.has(proposalId)) throw new Error('This transfer requires a separate explicit policy approval.');
    this.inFlight = true;
    this.quoteCache.delete(proposalId);
    this.approved.delete(proposalId);
    let reachedSigning = false;
    let reachedBroadcast = false;
    try {
      const record = await this.requireReadyVault();
      const validatedRecipient = validateEvmAddress(previous.recipient);
      const amountWei = BigInt(previous.amountWei);
      const result = await this.withAccount(record, async (account, wdk) => {
        try {
          const actualChain = Number(BigInt(await this.rpc('eth_chainId', [])));
          if (actualChain !== SEPOLIA_CHAIN_ID || previous.chainId !== SEPOLIA_CHAIN_ID) throw new Error('Network changed; transfer stopped.');
          const transaction = await this.buildTransaction(validatedRecipient, amountWei, await account.getAddress());
          const currentQuote = await account.quoteSendTransaction(transaction);
          const feeWei = BigInt(currentQuote.fee);
          const balance = await account.getBalance();
          if (amountWei + feeWei > balance) throw new Error('Wallet balance no longer covers the transfer and fee.');
          const decision = evaluateSepoliaEthTransfer({ chainId: actualChain, asset: previous.asset, amountWei, feeWei, policy: SEPOLIA_ETH_POLICY });
          if (decision.outcome === 'deny' || (decision.outcome === 'require_approval' && previous.decision !== 'require_approval')) throw new Error(`Final policy revalidation denied or requires approval: ${decision.reason}`);
          if (previous.recipient !== validatedRecipient || previous.amountWei !== amountWei.toString()) throw new Error('Critical transfer fields changed; create a new quote.');
          if (feeWei.toString() !== previous.feeWei || String(transaction.gasLimit) !== previous.gasLimit || String(transaction.maxFeePerGas ?? transaction.gasPrice) !== previous.maxFeePerGas || String(transaction.maxPriorityFeePerGas ?? '') !== String(previous.maxPriorityFeePerGas ?? '')) throw new Error('The network fee estimate changed. Create and review a fresh quote.');
          await onState('signing', { policyDecision: decision.outcome, feeWei: feeWei.toString() });
          reachedSigning = true;
          const signed = await account.signTransaction(transaction);
          await onState('signed');
          await onState('broadcast_attempt');
          let broadcast;
          try { broadcast = await account.sendTransaction(signed); }
          catch {
            // Broadcast can have reached the node even if its response was lost. Never resend.
            await onState('unknown', { reason: 'broadcast_response_ambiguous' });
            return { ambiguous: true as const };
          }
          reachedBroadcast = true;
          await onState('broadcast', { txHash: broadcast.hash });
          return { hash: broadcast.hash };
        } finally { wdk.dispose(); }
      });
      return 'ambiguous' in result ? { status: 'unknown', error: 'Broadcast outcome is unknown. Check the transaction list before retrying.' } : { status: 'broadcast', hash: result.hash };
    } catch (error) {
      if (reachedBroadcast) await onState('unknown', { reason: 'broadcast_audit_or_response_ambiguous' }).catch(() => undefined);
      else if (reachedSigning) await onState('failed', { reason: 'signing_or_broadcast_failed' }).catch(() => undefined);
      throw error;
    } finally { this.inFlight = false; }
  }

  async verifyReceipt(hash: string): Promise<{ status: 'confirmed' | 'failed' | 'pending' | 'unknown'; hash: string; from?: string; recipient?: string; valueWei?: string; blockNumber?: number }> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Invalid transaction hash.');
    try {
      const [tx, receipt] = await Promise.all([
        this.rpc('eth_getTransactionByHash', [hash], true),
        this.rpc('eth_getTransactionReceipt', [hash], true),
      ]);
      if (!tx || !receipt) return { status: 'pending', hash };
      if (Number(BigInt(await this.rpc('eth_chainId', [], true))) !== SEPOLIA_CHAIN_ID || (tx.chainId && Number(BigInt(tx.chainId)) !== SEPOLIA_CHAIN_ID)) return { status: 'unknown', hash };
      if (receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() || !/^0x[0-9a-fA-F]{40}$/.test(tx.from ?? '') || !/^0x[0-9a-fA-F]{40}$/.test(tx.to ?? '') || typeof tx.value !== 'string' || (tx.input !== '0x' && tx.input !== '0x0')) return { status: 'unknown', hash };
      const status = receipt.status === '0x1' ? 'confirmed' : receipt.status === '0x0' ? 'failed' : 'unknown';
      return { status, hash, from: tx.from, recipient: tx.to, valueWei: BigInt(tx.value).toString(), blockNumber: Number(BigInt(receipt.blockNumber)) };
    } catch { return { status: 'unknown', hash }; }
  }

  private async rpc(method: string, params: unknown[], independent = false): Promise<any> {
    const response = await fetch(independent ? SEPOLIA_VERIFICATION_RPC_URL : SEPOLIA_RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error('RPC request failed.');
    const body = await response.json() as { result?: unknown; error?: unknown };
    if (body.error || !Object.hasOwn(body, 'result')) throw new Error('RPC response was invalid.');
    return body.result;
  }

  private async buildTransaction(recipient: string, amountWei: bigint, from: string) {
    const provider = new JsonRpcProvider(SEPOLIA_RPC_URL, SEPOLIA_CHAIN_ID, { staticNetwork: true });
    try {
      const [gasLimit, feeData, nonce] = await Promise.all([
        provider.estimateGas({ from, to: recipient, value: amountWei, chainId: SEPOLIA_CHAIN_ID }),
        provider.getFeeData(),
        provider.getTransactionCount(from, 'pending'),
      ]);
      if (feeData.maxFeePerGas !== null && feeData.maxPriorityFeePerGas !== null) {
        return { to: recipient, value: amountWei, chainId: SEPOLIA_CHAIN_ID, nonce, gasLimit, maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas };
      }
      if (feeData.gasPrice === null) throw new Error('Fee estimate unavailable.');
      return { to: recipient, value: amountWei, chainId: SEPOLIA_CHAIN_ID, nonce, gasLimit, gasPrice: feeData.gasPrice };
    } finally { provider.destroy(); }
  }

  private async requireReadyVault(): Promise<VaultRecord> {
    const record = await this.loadVault();
    if (!record || !record.backupConfirmed) throw new Error('Complete and confirm the local wallet backup before transferring.');
    return record;
  }
  private async loadVault(): Promise<VaultRecord | null> {
    let raw: string;
    try { raw = await readFile(this.vaultPath, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('Encrypted wallet storage is unavailable.'); }
    try {
      const data = JSON.parse(raw);
      if (data.schemaVersion !== 1 || typeof data.encryptedSeed !== 'string' || typeof data.backupConfirmed !== 'boolean') throw new Error();
      return data as VaultRecord;
    } catch { throw new Error('Encrypted wallet record is malformed; it was preserved.'); }
  }
  private async assertSecureStorage(): Promise<void> {
    if (process.platform === 'linux' && this.safeStorage.getSelectedStorageBackend() !== 'gnome_libsecret') throw new Error('Secure wallet storage requires the GNOME Keyring backend.');
    if (!(await this.safeStorage.isAsyncEncryptionAvailable())) throw new Error('OS-backed secure storage is unavailable.');
  }
  private async writeVault(data: VaultRecord): Promise<void> {
    await this.assertSecureStorage();
    const directory = path.dirname(this.vaultPath);
    const temp = `${this.vaultPath}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(data)}\n`, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, this.vaultPath);
    const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
  }
  private async withAccount<T>(record: VaultRecord, operation: (account: any, wdk: WDK) => Promise<T>): Promise<T> {
    const decrypted = await this.safeStorage.decryptStringAsync(Buffer.from(record.encryptedSeed, 'base64'));
    let seed = decrypted.result;
    if (!WDK.isValidSeed(seed)) throw new Error('Encrypted wallet seed could not be validated.');
    const wdk = new WDK(seed).registerWallet(WALLET_ID, WalletManagerEvm, { provider: SEPOLIA_RPC_URL, chainId: SEPOLIA_CHAIN_ID, transactionMaxFee: SEPOLIA_ETH_POLICY.maxFeeWei });
    seed = '';
    let account;
    try { account = await wdk.getAccount(WALLET_ID, 0); }
    catch (error) { wdk.dispose(); throw error; }
    return operation(account, wdk);
  }
}

export function publicQuoteDetails(quote: TransferQuote): Record<string, string | number> {
  return { chainId: quote.chainId, asset: quote.asset, recipient: quote.recipient, amount: formatWeiAsEth(BigInt(quote.amountWei)), feeEth: formatWeiAsEth(BigInt(quote.feeWei)), totalDebitEth: formatWeiAsEth(BigInt(quote.totalDebitWei)), decision: quote.decision, reason: quote.reason };
}
