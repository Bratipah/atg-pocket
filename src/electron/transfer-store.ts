import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { TEST_USDT_ADDRESS } from './sepolia-domain.js';

export type TransferState = 'proposed' | 'awaiting_approval' | 'ready_to_confirm' | 'cancelled' | 'rejected' | 'signing' | 'signed' | 'broadcast' | 'confirmed' | 'failed' | 'unknown';
export interface TransferRecord {
  id: string; createdAt: string; updatedAt: string; chainId: number; asset: 'native-ETH' | 'sepolia-test-USDt'; recipient: string;
  amountWei?: string; tokenAddress?: string; amountBaseUnits?: string; feeWei: string; decision: 'allow' | 'require_approval' | 'deny'; approved: boolean;
  confirmed: boolean; state: TransferState; txHash: string | null; receiptStatus: string | null;
}
export interface TransferEvent { id: string; timestamp: string; transferId: string; type: string; details: Record<string, unknown>; previousHash: string; hash: string }
interface Snapshot { schemaVersion: 1; transfers: TransferRecord[]; events: TransferEvent[] }
export type NewTransfer = { id?: string; chainId: number; asset: 'native-ETH'; recipient: string; amountWei: string; feeWei: string; decision: TransferRecord['decision']; reason: string } | { id?: string; chainId: number; asset: 'sepolia-test-USDt'; recipient: string; tokenAddress: string; amountBaseUnits: string; feeWei: string; decision: TransferRecord['decision']; reason: string };

/** Atomic snapshot and SHA-256 chain modeled on TreasuryStore; only public lifecycle data is stored. */
export class TransferStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly filePath: string) {}

  create(input: NewTransfer): Promise<TransferRecord> {
    return this.serial(async () => {
      const data = await this.load();
      const now = new Date().toISOString(); const id = input.id ?? randomUUID();
      const state: TransferState = input.decision === 'deny' ? 'rejected' : input.decision === 'require_approval' ? 'awaiting_approval' : 'ready_to_confirm';
      const transfer: TransferRecord = { id, createdAt: now, updatedAt: now, chainId: input.chainId, asset: input.asset, recipient: input.recipient, ...(input.asset === 'native-ETH' ? { amountWei: input.amountWei } : { tokenAddress: input.tokenAddress, amountBaseUnits: input.amountBaseUnits }), feeWei: input.feeWei, decision: input.decision, approved: false, confirmed: false, state, txHash: null, receiptStatus: null };
      data.transfers.push(transfer);
      await this.append(data, id, 'proposal.created', { chainId: input.chainId, asset: input.asset, recipient: input.recipient, ...(input.asset === 'native-ETH' ? { amountWei: input.amountWei } : { tokenAddress: input.tokenAddress, amountBaseUnits: input.amountBaseUnits }) });
      await this.append(data, id, 'policy.evaluated', { decision: input.decision, reason: input.reason, feeWei: input.feeWei });
      await this.append(data, id, `transfer.${state}`, { initial: true });
      await this.commit(data);
      return structuredClone(transfer);
    });
  }

  update(id: string, state: TransferState, details: Record<string, unknown> = {}, patch: Partial<Pick<TransferRecord, 'approved' | 'confirmed' | 'txHash' | 'receiptStatus'>> = {}): Promise<TransferRecord> {
    return this.serial(async () => {
      const data = await this.load(); const transfer = data.transfers.find((item) => item.id === id);
      if (!transfer) throw new Error('Transfer proposal was not found.');
      Object.assign(transfer, patch, { state, updatedAt: new Date().toISOString() });
      await this.append(data, id, `transfer.${state}`, details);
      await this.commit(data);
      return structuredClone(transfer);
    });
  }

  recordEvent(id: string, type: string, details: Record<string, unknown> = {}): Promise<void> {
    return this.serial(async () => {
      const data = await this.load();
      if (!data.transfers.some((item) => item.id === id)) throw new Error('Transfer proposal was not found.');
      await this.append(data, id, type, details);
      await this.commit(data);
    });
  }

  recoverAfterRestart(): Promise<void> {
    return this.serial(async () => {
      const data = await this.load();
      let changed = false;
      for (const transfer of data.transfers) {
        if (['awaiting_approval', 'ready_to_confirm'].includes(transfer.state) && !transfer.confirmed) {
          transfer.state = 'cancelled'; transfer.updatedAt = new Date().toISOString(); changed = true;
          await this.append(data, transfer.id, 'transfer.cancelled', { reason: 'quote_expired_after_restart' });
        } else if (['signing', 'signed', 'broadcast'].includes(transfer.state)) {
          transfer.state = 'unknown'; transfer.updatedAt = new Date().toISOString(); changed = true;
          await this.append(data, transfer.id, 'transfer.unknown', { reason: 'app_restarted_during_submission' });
        }
      }
      if (changed) await this.commit(data);
    });
  }

  async list(): Promise<TransferRecord[]> { return this.serial(async () => structuredClone((await this.load()).transfers).reverse()); }
  async audit(): Promise<{ events: TransferEvent[]; valid: boolean }> { return this.serial(async () => { const data = await this.load(); return { events: data.events, valid: verifyTransferEvents(data.events) }; }); }

  private async append(data: Snapshot, transferId: string, type: string, details: Record<string, unknown>): Promise<void> {
    const base = { id: randomUUID(), timestamp: new Date().toISOString(), transferId, type, details, previousHash: data.events.at(-1)?.hash ?? '0'.repeat(64) };
    data.events.push({ ...base, hash: digest(base) });
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> { const next = this.queue.then(fn, fn); this.queue = next.then(() => undefined, () => undefined); return next; }
  private async load(): Promise<Snapshot> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Snapshot;
      if (!validSnapshot(parsed)) throw new Error();
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, transfers: [], events: [] };
      throw new Error('Transfer history is invalid or unavailable; existing data was preserved.');
    }
  }
  private async commit(data: Snapshot): Promise<void> {
    const directory = path.dirname(this.filePath); const temp = `${this.filePath}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(`${canonical(data)}\n`, 'utf8'); await file.sync(); } finally { await file.close(); }
    await rename(temp, this.filePath);
    const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
  }
}

export function verifyTransferEvents(events: unknown): boolean {
  if (!Array.isArray(events)) return false;
  let previous = '0'.repeat(64);
  for (const item of events) {
    if (!exactKeys(item, ['id', 'timestamp', 'transferId', 'type', 'details', 'previousHash', 'hash']) || typeof item.id !== 'string' || !isUtc(item.timestamp) || typeof item.transferId !== 'string' || typeof item.type !== 'string' || !/^(proposal\.created|policy\.evaluated|broadcast\.attempt|transfer\.(awaiting_approval|ready_to_confirm|cancelled|rejected|signing|signed|broadcast|confirmed|failed|unknown))$/.test(item.type) || !validDetails(item.details) || typeof item.hash !== 'string' || !/^[0-9a-f]{64}$/.test(item.hash) || item.previousHash !== previous) return false;
    const { hash, ...base } = item;
    if (digest(base) !== hash) return false;
    previous = hash;
  }
  return true;
}
function exactKeys(value: any, keys: string[]): boolean { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function isUtc(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)); }
function validDetails(value: any): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => /seed|mnemonic|private.?key|signing.?payload|signed.?transaction/i.test(key))) return false;
  return Object.values(value).every((item) => ['string', 'number', 'boolean'].includes(typeof item) && (typeof item !== 'string' || item.length <= 200));
}
function validTransfer(value: any): value is TransferRecord {
  const base = /^[0-9a-f-]{36}$/i.test(value?.id ?? '') && isUtc(value?.createdAt) && isUtc(value?.updatedAt) && value?.chainId === 11155111 && /^0x[0-9a-fA-F]{40}$/.test(value?.recipient ?? '') && /^\d+$/.test(value?.feeWei ?? '') && ['allow', 'require_approval', 'deny'].includes(value?.decision) && typeof value?.approved === 'boolean' && typeof value?.confirmed === 'boolean' && ['proposed', 'awaiting_approval', 'ready_to_confirm', 'cancelled', 'rejected', 'signing', 'signed', 'broadcast', 'confirmed', 'failed', 'unknown'].includes(value?.state) && (value?.txHash === null || /^0x[0-9a-fA-F]{64}$/.test(value?.txHash)) && (value?.receiptStatus === null || ['confirmed', 'failed', 'pending', 'unknown'].includes(value?.receiptStatus));
  const common = ['id', 'createdAt', 'updatedAt', 'chainId', 'asset', 'recipient', 'feeWei', 'decision', 'approved', 'confirmed', 'state', 'txHash', 'receiptStatus'];
  const legacy = value?.asset === 'native-ETH' && exactKeys(value, [...common, 'amountWei']) && /^\d+$/.test(value.amountWei ?? '');
  const token = value?.asset === 'sepolia-test-USDt' && exactKeys(value, [...common, 'tokenAddress', 'amountBaseUnits']) && value.tokenAddress === TEST_USDT_ADDRESS && /^\d+$/.test(value.amountBaseUnits ?? '');
  return base && (legacy || token);
}
function validSnapshot(value: any): value is Snapshot {
  if (!exactKeys(value, ['schemaVersion', 'transfers', 'events']) || value.schemaVersion !== 1 || !Array.isArray(value.transfers) || !value.transfers.every(validTransfer) || !Array.isArray(value.events) || !verifyTransferEvents(value.events)) return false;
  const ids = new Set(value.transfers.map((transfer: TransferRecord) => transfer.id));
  if (ids.size !== value.transfers.length || new Set(value.events.map((event: TransferEvent) => event.id)).size !== value.events.length || !value.events.every((event: TransferEvent) => ids.has(event.transferId))) return false;
  return value.transfers.every((transfer: TransferRecord) => {
    const events = value.events.filter((event: TransferEvent) => event.transferId === transfer.id);
    const proposal = events.find((event: TransferEvent) => event.type === 'proposal.created');
    const policy = events.find((event: TransferEvent) => event.type === 'policy.evaluated');
    const stateEvent = [...events].reverse().find((event: TransferEvent) => event.type.startsWith('transfer.'));
    if (!proposal || !policy || !stateEvent || stateEvent.type !== `transfer.${transfer.state}`) return false;
    if (proposal.details.chainId !== transfer.chainId || proposal.details.asset !== transfer.asset || proposal.details.recipient !== transfer.recipient || (transfer.asset === 'native-ETH' ? proposal.details.amountWei !== transfer.amountWei : proposal.details.amountBaseUnits !== transfer.amountBaseUnits || proposal.details.tokenAddress !== transfer.tokenAddress)) return false;
    if (policy.details.decision !== transfer.decision || policy.details.feeWei !== transfer.feeWei) return false;
    if (transfer.txHash && !events.some((event: TransferEvent) => event.type === 'transfer.broadcast' && event.details.txHash === transfer.txHash)) return false;
    if (transfer.receiptStatus && !events.some((event: TransferEvent) => event.details.receiptStatus === transfer.receiptStatus)) return false;
    return true;
  });
}
function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
function canonical(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
