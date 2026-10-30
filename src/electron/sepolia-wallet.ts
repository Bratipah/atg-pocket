import WDK from '@tetherto/wdk';
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';
import type { SafeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { decodeTestUsdtTransfer, ERC20_INTERFACE, evaluateSepoliaTestUsdtTransfer, formatTestUsdt, formatWeiAsEth, parseTestUsdt, SEPOLIA_CHAIN_ID, SEPOLIA_RPC_URL, SEPOLIA_TEST_USDT_POLICY, SEPOLIA_VERIFICATION_RPC_URL, TEST_USDT_ADDRESS, TEST_USDT_DECIMALS, TEST_USDT_NAME, TEST_USDT_SYMBOL, validateEvmAddress } from './sepolia-domain.js';

const WALLET_ID = 'atg-sepolia-only';
interface VaultRecord { schemaVersion: 1; encryptedSeed: string; backupConfirmed: boolean }
export interface WalletStatus { setup: 'not-created' | 'backup-required' | 'ready' | 'unavailable'; network: 'verified' | 'unavailable' | 'unsupported' | 'not-checked'; address: string | null; balanceWei: string | null; testUsdtBalanceBaseUnits: string | null; testUsdtVerified: boolean; refreshedAt: string | null; error?: string }
export interface TransferQuote {
  proposalId: string; chainId: number; asset: 'sepolia-test-USDt'; tokenAddress: string; recipient: string; amountBaseUnits: string;
  feeWei: string; decision: 'allow' | 'require_approval' | 'deny'; reason: string;
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
    if (!record && this.pendingVault) return { setup: 'backup-required', network: 'not-checked', address: this.pendingAddress, balanceWei: null, testUsdtBalanceBaseUnits: null, testUsdtVerified: false, refreshedAt: null };
    if (!record) return { setup: 'not-created', network: 'not-checked', address: null, balanceWei: null, testUsdtBalanceBaseUnits: null, testUsdtVerified: false, refreshedAt: null };
    const address = await this.withAccount(record, async (account, wdk) => {
      try {
        const walletAddress = await account.getAddress();
        try {
          const [chainId, balance] = await Promise.all([this.rpc('eth_chainId', []), account.getBalance()]);
          if (Number(BigInt(chainId)) !== SEPOLIA_CHAIN_ID) return { address: walletAddress, balanceWei: null, testUsdtBalanceBaseUnits: null, testUsdtVerified: false, network: 'unsupported' as const, error: 'RPC chain ID does not match Sepolia.' };
          const verified = await this.verifyTokenContract();
          let tokenBalanceBaseUnits: string | null = null;
          if (verified) {
            try { tokenBalanceBaseUnits = BigInt(await account.getTokenBalance(TEST_USDT_ADDRESS)).toString(); } catch { /* Gas balance remains useful; transfers remain disabled until token balance is available. */ }
          }
          return { address: walletAddress, balanceWei: balance.toString(), testUsdtBalanceBaseUnits: tokenBalanceBaseUnits, testUsdtVerified: verified && tokenBalanceBaseUnits !== null, network: 'verified' as const, ...(!(verified && tokenBalanceBaseUnits !== null) ? { error: 'Test USD₮ contract or balance could not be verified; token transfers are disabled.' } : {}) };
        } catch { return { address: walletAddress, balanceWei: null, testUsdtBalanceBaseUnits: null, testUsdtVerified: false, network: 'unavailable' as const, error: 'Sepolia RPC is unavailable; balances were not refreshed.' }; }
      } finally { wdk.dispose(); }
    });
    return { setup: record.backupConfirmed ? 'ready' : 'backup-required', network: address.network, address: address.address, balanceWei: address.balanceWei, testUsdtBalanceBaseUnits: address.testUsdtBalanceBaseUnits, testUsdtVerified: address.testUsdtVerified, refreshedAt: address.balanceWei === null ? null : new Date().toISOString(), ...('error' in address ? { error: address.error } : {}) };
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
    const amountBaseUnits = parseTestUsdt(raw.amount);
    if (raw.chainId !== SEPOLIA_CHAIN_ID || raw.asset !== 'sepolia-test-USDt') throw new Error('Only Sepolia test USD₮ transfers are supported.');
    const quote = await this.withAccount(record, async (account, wdk) => {
      try {
        const actualChain = Number(BigInt(await this.rpc('eth_chainId', [])));
        if (actualChain !== SEPOLIA_CHAIN_ID || !(await this.verifyTokenContract())) throw new Error('Sepolia test USD₮ contract verification failed.');
        const tokenBalance = BigInt(await account.getTokenBalance(TEST_USDT_ADDRESS));
        if (amountBaseUnits > tokenBalance) throw new Error('Test USD₮ balance does not cover this transfer.');
        const estimate = await account.quoteTransfer({ token: TEST_USDT_ADDRESS, recipient, amount: amountBaseUnits });
        const feeWei = BigInt(estimate.fee);
        const gasBalance = BigInt(await account.getBalance());
        if (feeWei > gasBalance) throw new Error('Sepolia ETH balance does not cover the estimated network fee.');
        const decision = evaluateSepoliaTestUsdtTransfer({ chainId: actualChain, asset: 'sepolia-test-USDt', tokenAddress: TEST_USDT_ADDRESS, amountBaseUnits, feeWei, policy: SEPOLIA_TEST_USDT_POLICY });
        return { proposalId: randomUUID(), chainId: actualChain, asset: 'sepolia-test-USDt' as const, tokenAddress: TEST_USDT_ADDRESS, recipient, amountBaseUnits: amountBaseUnits.toString(), feeWei: feeWei.toString(), decision: decision.outcome, reason: decision.reason };
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
    this.inFlight = true; this.quoteCache.delete(proposalId); this.approved.delete(proposalId);
    let reachedSubmission = false;
    try {
      const record = await this.requireReadyVault();
      const recipient = validateEvmAddress(previous.recipient);
      const amountBaseUnits = BigInt(previous.amountBaseUnits);
      const result = await this.withAccount(record, async (account, wdk) => {
        try {
          const actualChain = Number(BigInt(await this.rpc('eth_chainId', [])));
          if (actualChain !== SEPOLIA_CHAIN_ID || previous.chainId !== SEPOLIA_CHAIN_ID || previous.tokenAddress !== TEST_USDT_ADDRESS || !(await this.verifyTokenContract())) throw new Error('Network or test token changed; transfer stopped.');
          if (recipient !== previous.recipient || amountBaseUnits.toString() !== previous.amountBaseUnits) throw new Error('Critical transfer fields changed; create a new quote.');
          if (BigInt(await account.getTokenBalance(TEST_USDT_ADDRESS)) < amountBaseUnits) throw new Error('Test USD₮ balance no longer covers this transfer.');
          const estimate = await account.quoteTransfer({ token: TEST_USDT_ADDRESS, recipient, amount: amountBaseUnits });
          const feeWei = BigInt(estimate.fee);
          if (feeWei > BigInt(await account.getBalance())) throw new Error('Sepolia ETH balance no longer covers the estimated network fee.');
          const decision = evaluateSepoliaTestUsdtTransfer({ chainId: actualChain, asset: previous.asset, tokenAddress: previous.tokenAddress, amountBaseUnits, feeWei, policy: SEPOLIA_TEST_USDT_POLICY });
          if (decision.outcome === 'deny' || (decision.outcome === 'require_approval' && previous.decision !== 'require_approval')) throw new Error(`Final policy revalidation denied or requires approval: ${decision.reason}`);
          if (feeWei.toString() !== previous.feeWei) throw new Error('The network fee estimate changed. Create and review a fresh quote.');
          await onState('signing', { policyDecision: decision.outcome, feeWei: feeWei.toString() });
          await onState('broadcast_attempt'); reachedSubmission = true;
          let sent;
          try { sent = await account.transfer({ token: TEST_USDT_ADDRESS, recipient, amount: amountBaseUnits }); }
          catch { await onState('unknown', { reason: 'submission_response_ambiguous' }); return { ambiguous: true as const }; }
          await onState('broadcast', { txHash: sent.hash });
          return { hash: sent.hash };
        } finally { wdk.dispose(); }
      });
      return 'ambiguous' in result ? { status: 'unknown', error: 'Submission outcome is unknown. Check activity before retrying.' } : { status: 'broadcast', hash: result.hash };
    } catch (error) {
      if (reachedSubmission) await onState('unknown', { reason: 'submission_or_audit_response_ambiguous' }).catch(() => undefined);
      throw error;
    } finally { this.inFlight = false; }
  }

  async verifyReceipt(hash: string): Promise<{ status: 'confirmed' | 'failed' | 'pending' | 'unknown'; hash: string; from?: string; recipient?: string; tokenAddress?: string; amountBaseUnits?: string; blockNumber?: number }> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Invalid transaction hash.');
    try {
      const [tx, receipt] = await Promise.all([this.rpc('eth_getTransactionByHash', [hash], true), this.rpc('eth_getTransactionReceipt', [hash], true)]);
      if (!tx || !receipt) return { status: 'pending', hash };
      if (Number(BigInt(await this.rpc('eth_chainId', [], true))) !== SEPOLIA_CHAIN_ID || (tx.chainId && Number(BigInt(tx.chainId)) !== SEPOLIA_CHAIN_ID)) return { status: 'unknown', hash };
      const decoded = decodeTestUsdtTransfer(tx.input ?? tx.data, tx.value ?? '0x0');
      if (receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() || tx.to?.toLowerCase() !== TEST_USDT_ADDRESS.toLowerCase() || !/^0x[0-9a-fA-F]{40}$/.test(tx.from ?? '') || !decoded) return { status: 'unknown', hash };
      const status = receipt.status === '0x1' ? 'confirmed' : receipt.status === '0x0' ? 'failed' : 'unknown';
      const hasMatchingLog = Array.isArray(receipt.logs) && receipt.logs.some((log: any) => {
        try {
          if (log.address?.toLowerCase() !== TEST_USDT_ADDRESS.toLowerCase()) return false;
          const parsed = ERC20_INTERFACE.parseLog({ topics: log.topics, data: log.data });
          return parsed?.name === 'Transfer' && String(parsed.args[0]).toLowerCase() === tx.from.toLowerCase() && String(parsed.args[1]).toLowerCase() === decoded.recipient.toLowerCase() && (parsed.args[2] as bigint).toString() === decoded.amountBaseUnits;
        } catch { return false; }
      });
      return { status: status === 'confirmed' && !hasMatchingLog ? 'unknown' : status, hash, from: tx.from, recipient: decoded.recipient, tokenAddress: tx.to, amountBaseUnits: decoded.amountBaseUnits, blockNumber: Number(BigInt(receipt.blockNumber)) };
    } catch { return { status: 'unknown', hash }; }
  }

  private async rpc(method: string, params: unknown[], independent = false): Promise<any> {
    const response = await fetch(independent ? SEPOLIA_VERIFICATION_RPC_URL : SEPOLIA_RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error('RPC request failed.');
    const body = await response.json() as { result?: unknown; error?: unknown };
    if (body.error || !Object.hasOwn(body, 'result')) throw new Error('RPC response was invalid.');
    return body.result;
  }

  private async verifyTokenContract(): Promise<boolean> {
    try {
      const code = await this.rpc('eth_getCode', [TEST_USDT_ADDRESS, 'latest']);
      if (typeof code !== 'string' || code === '0x') return false;
      const call = async (name: 'name' | 'symbol' | 'decimals') => {
        const data = ERC20_INTERFACE.encodeFunctionData(name);
        const result = await this.rpc('eth_call', [{ to: TEST_USDT_ADDRESS, data }, 'latest']);
        return ERC20_INTERFACE.decodeFunctionResult(name, result)[0];
      };
      const [name, symbol, decimals] = await Promise.all([call('name'), call('symbol'), call('decimals')]);
      return name === TEST_USDT_NAME && symbol === TEST_USDT_SYMBOL && Number(decimals) === TEST_USDT_DECIMALS;
    } catch { return false; }
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
    const wdk = new WDK(seed).registerWallet(WALLET_ID, WalletManagerEvm, { provider: SEPOLIA_RPC_URL, chainId: SEPOLIA_CHAIN_ID, transactionMaxFee: SEPOLIA_TEST_USDT_POLICY.maxFeeWei });
    seed = '';
    let account;
    try { account = await wdk.getAccount(WALLET_ID, 0); }
    catch (error) { wdk.dispose(); throw error; }
    return operation(account, wdk);
  }
}

export function publicQuoteDetails(quote: TransferQuote): Record<string, string | number> {
  return { chainId: quote.chainId, asset: quote.asset, tokenAddress: quote.tokenAddress, recipient: quote.recipient, amount: formatTestUsdt(BigInt(quote.amountBaseUnits)), feeEth: formatWeiAsEth(BigInt(quote.feeWei)), decision: quote.decision, reason: quote.reason };
}
