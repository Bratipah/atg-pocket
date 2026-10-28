import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Decision, DecisionReasonCode, Money } from './treasury-domain.js';

const SCHEMA_VERSION = 1;
const GENESIS_HASH = '0'.repeat(64);
type Outcome = Decision;
export interface PersistedProposal {
  schemaVersion: 1; id: string; createdAt: string; classification: 'user-created';
  transaction: Money;
  evaluation: { policyId: string; policyVersion: number; policyCurrency: string; perTransactionLimit: Money; period: string; periodCap: Money; approvalThreshold: Money; priorSpending: Money; outcome: Outcome; reasonCodes: DecisionReasonCode[]; evaluatedAt: string; evaluationKind: 'initial' | 'reevaluation' };
  auditEventIds: string[];
}
export interface AuditEvent {
  schemaVersion: 1; id: string; timestamp: string; type: 'proposal.evaluated'; proposalId: string;
  details: { outcome: Outcome; reasonCodes: DecisionReasonCode[]; policyId: string; policyVersion: number };
  previousHash: string; hash: string;
}
interface StoreFile { schemaVersion: 1; proposals: PersistedProposal[]; events: AuditEvent[] }
export interface NewProposal { transaction: Money; evaluation: Omit<PersistedProposal['evaluation'], 'evaluatedAt' | 'evaluationKind'> }
export interface AuditVerification { valid: boolean; eventCount: number; firstInvalidEventId: string | null; issue: string | null; }

export class TreasuryStoreError extends Error {
  constructor(message: string, readonly code: 'CORRUPT' | 'IO' | 'INVALID') { super(message); }
}

/** JSON snapshot repository. All operations are serialized within the single Electron app instance. */
export class TreasuryStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly filePath: string) {}

  createProposal(input: NewProposal): Promise<PersistedProposal> {
    return this.serial(async () => {
      const state = await this.load();
      const id = randomUUID(); const eventId = randomUUID(); const now = new Date().toISOString();
      const proposal: PersistedProposal = { schemaVersion: 1, id, createdAt: now, classification: 'user-created', transaction: clone(input.transaction), evaluation: { ...clone(input.evaluation), evaluatedAt: now, evaluationKind: 'initial' }, auditEventIds: [eventId] };
      const eventBase = { schemaVersion: 1 as const, id: eventId, timestamp: now, type: 'proposal.evaluated' as const, proposalId: id, details: { outcome: proposal.evaluation.outcome, reasonCodes: [...proposal.evaluation.reasonCodes], policyId: proposal.evaluation.policyId, policyVersion: proposal.evaluation.policyVersion }, previousHash: state.events.at(-1)?.hash ?? GENESIS_HASH };
      const event: AuditEvent = { ...eventBase, hash: hashEvent(eventBase) };
      state.proposals.push(proposal); state.events.push(event);
      await this.commit(state);
      return clone(proposal);
    });
  }

  listProposals(): Promise<PersistedProposal[]> { return this.serial(async () => clone((await this.load()).proposals).reverse()); }
  getAudit(proposalId?: string): Promise<{ events: AuditEvent[]; verification: AuditVerification }> {
    return this.serial(async () => {
      const state = await this.load(); const verification = verifyAudit(state.events);
      return { events: clone(proposalId ? state.events.filter((event) => event.proposalId === proposalId) : state.events), verification };
    });
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }
  private async load(): Promise<StoreFile> {
    let raw: string;
    try { raw = await readFile(this.filePath, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, proposals: [], events: [] };
      throw new TreasuryStoreError('Local treasury storage could not be read.', 'IO');
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new TreasuryStoreError('Local treasury storage is corrupted; it was preserved without changes.', 'CORRUPT'); }
    if (!validStore(parsed)) throw new TreasuryStoreError('Local treasury storage is malformed or incompatible; it was preserved without changes.', 'CORRUPT');
    const verification = verifyAudit(parsed.events);
    if (!verification.valid) throw new TreasuryStoreError(`Audit history is invalid at ${verification.firstInvalidEventId ?? 'unknown event'}; storage was preserved without changes.`, 'CORRUPT');
    return parsed;
  }
  private async commit(state: StoreFile): Promise<void> {
    const directory = path.dirname(this.filePath); const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let renamed = false;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      handle = await open(tempPath, 'wx', 0o600);
      await handle.writeFile(`${canonical(state)}\n`, 'utf8'); await handle.sync(); await handle.close(); handle = undefined;
      await rename(tempPath, this.filePath);
      renamed = true;
      const dirHandle = await open(directory, 'r'); try { await dirHandle.sync(); } finally { await dirHandle.close(); }
    } catch {
      if (handle) await handle.close().catch(() => undefined);
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw new TreasuryStoreError(renamed ? 'The complete snapshot was replaced, but durable commit could not be confirmed. Reload local records before retrying.' : 'Local treasury write failed before replacement; the previous snapshot remains in place.', 'IO');
    }
  }
}

export function verifyAudit(events: unknown): AuditVerification {
  if (!Array.isArray(events)) return { valid: false, eventCount: 0, firstInvalidEventId: null, issue: 'events_not_array' };
  let previousHash = GENESIS_HASH;
  for (const raw of events) {
    if (!validEvent(raw)) return { valid: false, eventCount: events.length, firstInvalidEventId: typeof raw?.id === 'string' ? raw.id : null, issue: 'malformed_event' };
    if (raw.previousHash !== previousHash) return { valid: false, eventCount: events.length, firstInvalidEventId: raw.id, issue: 'broken_link' };
    const { hash, ...base } = raw;
    if (hashEvent(base) !== hash) return { valid: false, eventCount: events.length, firstInvalidEventId: raw.id, issue: 'hash_mismatch' };
    previousHash = hash;
  }
  return { valid: true, eventCount: events.length, firstInvalidEventId: null, issue: null };
}

function hashEvent(event: Omit<AuditEvent, 'hash'>): string { return createHash('sha256').update(canonical(event), 'utf8').digest('hex'); }
/** Canonical JSON: object keys sorted recursively, arrays retain order, UTF-8 encoding. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
const outcomes = ['allow', 'require_approval', 'deny'];
const reasons = ['POLICY_MISSING', 'POLICY_INVALID', 'TRANSACTION_INVALID', 'CURRENCY_MISMATCH', 'PRIOR_SPENDING_INVALID', 'HARD_TRANSACTION_LIMIT_EXCEEDED', 'PERIOD_BUDGET_EXCEEDED', 'APPROVAL_THRESHOLD_REACHED', 'WITHIN_POLICY_LIMITS'];
function validMoney(value: any): boolean { return value && typeof value === 'object' && ['KES', 'USD', 'JPY'].includes(value.currency) && Number.isSafeInteger(value.minorUnits) && value.minorUnits >= 0; }
function validEvent(value: any): value is AuditEvent {
  return exactKeys(value, ['schemaVersion', 'id', 'timestamp', 'type', 'proposalId', 'details', 'previousHash', 'hash']) && value.schemaVersion === 1 && typeof value.id === 'string' && isUtc(value.timestamp) && value.type === 'proposal.evaluated' && typeof value.proposalId === 'string' && exactKeys(value.details, ['outcome', 'reasonCodes', 'policyId', 'policyVersion']) && outcomes.includes(value.details.outcome) && Array.isArray(value.details.reasonCodes) && value.details.reasonCodes.length > 0 && value.details.reasonCodes.every((r: unknown) => reasons.includes(String(r))) && typeof value.details.policyId === 'string' && Number.isSafeInteger(value.details.policyVersion) && typeof value.previousHash === 'string' && /^[0-9a-f]{64}$/.test(value.previousHash) && typeof value.hash === 'string' && /^[0-9a-f]{64}$/.test(value.hash);
}
function validProposal(value: any): value is PersistedProposal {
  const e = value?.evaluation;
  return exactKeys(value, ['schemaVersion', 'id', 'createdAt', 'classification', 'transaction', 'evaluation', 'auditEventIds']) && value.schemaVersion === 1 && typeof value.id === 'string' && isUtc(value.createdAt) && value.classification === 'user-created' && validMoney(value.transaction) && exactKeys(e, ['policyId', 'policyVersion', 'policyCurrency', 'perTransactionLimit', 'period', 'periodCap', 'approvalThreshold', 'priorSpending', 'outcome', 'reasonCodes', 'evaluatedAt', 'evaluationKind']) && typeof e.policyId === 'string' && Number.isSafeInteger(e.policyVersion) && ['KES', 'USD', 'JPY'].includes(e.policyCurrency) && validMoney(e.perTransactionLimit) && typeof e.period === 'string' && validMoney(e.periodCap) && validMoney(e.approvalThreshold) && validMoney(e.priorSpending) && outcomes.includes(e.outcome) && Array.isArray(e.reasonCodes) && e.reasonCodes.length > 0 && e.reasonCodes.every((r: unknown) => reasons.includes(String(r))) && isUtc(e.evaluatedAt) && ['initial', 'reevaluation'].includes(e.evaluationKind) && Array.isArray(value.auditEventIds) && value.auditEventIds.every((id: unknown) => typeof id === 'string');
}
function exactKeys(value: any, keys: string[]): boolean { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function isUtc(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)); }
function validStore(value: any): value is StoreFile {
  if (!exactKeys(value, ['schemaVersion', 'proposals', 'events']) || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.proposals) || !value.proposals.every(validProposal) || !Array.isArray(value.events) || !value.events.every(validEvent)) return false;
  const eventById = new Map<string, AuditEvent>(value.events.map((event: AuditEvent) => [event.id, event] as [string, AuditEvent]));
  const proposalIds = new Set(value.proposals.map((proposal: PersistedProposal) => proposal.id));
  if (proposalIds.size !== value.proposals.length || eventById.size !== value.events.length) return false;
  if (value.events.some((event: AuditEvent) => !proposalIds.has(event.proposalId))) return false;
  return value.proposals.every((proposal: PersistedProposal) => proposal.auditEventIds.length > 0 && proposal.auditEventIds.every((id) => {
    const event = eventById.get(id);
    return event?.proposalId === proposal.id && event.details.outcome === proposal.evaluation.outcome && event.details.policyId === proposal.evaluation.policyId && event.details.policyVersion === proposal.evaluation.policyVersion;
  }));
}
