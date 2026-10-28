import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TreasuryStore, TreasuryStoreError, verifyAudit } from '../dist/electron/treasury-store.js';
import { validateAuditRequest, validateProposalInput } from '../dist/electron/validation.js';

const money = { currency: 'KES', minorUnits: 800000 };
const evaluation = { policyId: 'synthetic-procurement-v1', policyVersion: 1, policyCurrency: 'KES', perTransactionLimit: { currency: 'KES', minorUnits: 2000000 }, period: 'example week', periodCap: { currency: 'KES', minorUnits: 6000000 }, approvalThreshold: { currency: 'KES', minorUnits: 1000000 }, priorSpending: { currency: 'KES', minorUnits: 2400000 }, outcome: 'allow', reasonCodes: ['WITHIN_POLICY_LIMITS'] };
async function fixture(t, storePath = undefined) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'atg-store-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = storePath ?? path.join(directory, 'treasury.json');
  return { file, store: new TreasuryStore(file), directory };
}

test('proposal and evaluation survive service restart with one linked audit event', async (t) => {
  const { file, store } = await fixture(t);
  const created = await store.createProposal({ transaction: money, evaluation });
  const restarted = new TreasuryStore(file);
  const records = await restarted.listProposals();
  assert.equal(records.length, 1); assert.equal(records[0].id, created.id);
  assert.equal(records[0].evaluation.outcome, 'allow'); assert.equal(records[0].classification, 'user-created');
  const audit = await restarted.getAudit(created.id);
  assert.equal(audit.events.length, 1); assert.equal(audit.verification.valid, true);
});

test('failed writes reject without leaving a proposal or partial file', async (t) => {
  const { directory } = await fixture(t);
  const badPath = path.join(directory, 'is-a-directory'); await import('node:fs/promises').then(({ mkdir }) => mkdir(badPath));
  const store = new TreasuryStore(badPath);
  await assert.rejects(store.createProposal({ transaction: money, evaluation }), (error) => error instanceof TreasuryStoreError && error.code === 'IO');
});

test('stale interrupted-write temporary files do not replace or hide the committed snapshot', async (t) => {
  const { file, store } = await fixture(t);
  const saved = await store.createProposal({ transaction: money, evaluation });
  await writeFile(`${file}.interrupted.tmp`, '{ incomplete snapshot');
  const restarted = new TreasuryStore(file);
  assert.equal((await restarted.listProposals())[0].id, saved.id);
});

test('audit chain detects modified, deleted, reordered, and malformed entries', async (t) => {
  const { store } = await fixture(t);
  await store.createProposal({ transaction: money, evaluation });
  await store.createProposal({ transaction: { ...money, minorUnits: 700000 }, evaluation });
  const events = (await store.getAudit()).events;
  assert.equal(verifyAudit(events).valid, true);
  const modified = structuredClone(events); modified[0].details.outcome = 'deny'; assert.equal(verifyAudit(modified).issue, 'hash_mismatch');
  assert.equal(verifyAudit(events.slice(1)).issue, 'broken_link');
  assert.equal(verifyAudit([...events].reverse()).issue, 'broken_link');
  assert.equal(verifyAudit([{ ...events[0], hash: 'not-a-hash' }]).issue, 'malformed_event');
  const noTail = events.slice(0, -1); assert.equal(verifyAudit(noTail).valid, true, 'a standalone chain cannot identify a removed valid suffix without an external anchor');
});

test('corrupt, malformed, and incompatible stores fail closed and remain untouched', async (t) => {
  const { file } = await fixture(t);
  for (const bytes of ['{broken', JSON.stringify({ schemaVersion: 99, proposals: [], events: [] }), JSON.stringify({ schemaVersion: 1, proposals: [{ id: 'bad' }], events: [] })]) {
    await writeFile(file, bytes);
    const store = new TreasuryStore(file);
    await assert.rejects(store.listProposals(), (error) => error instanceof TreasuryStoreError && error.code === 'CORRUPT');
    assert.equal(await readFile(file, 'utf8'), bytes);
  }
});

test('simultaneous creates are serialized as complete records and events', async (t) => {
  const { file, store } = await fixture(t);
  await Promise.all(Array.from({ length: 12 }, (_, index) => store.createProposal({ transaction: { ...money, minorUnits: money.minorUnits + index }, evaluation })));
  const restarted = new TreasuryStore(file);
  assert.equal((await restarted.listProposals()).length, 12);
  assert.equal((await restarted.getAudit()).events.length, 12);
  assert.equal((await restarted.getAudit()).verification.valid, true);
});

test('IPC request validation rejects decision/configuration/path fields and audit injection', () => {
  assert.deepEqual(validateProposalInput({ amount: '10', currency: 'KES' }), { amount: '10', currency: 'KES' });
  for (const request of [{ amount: '10', currency: 'KES', outcome: 'allow' }, { amount: '10', currency: 'KES', policy: {} }, { amount: '10', currency: 'KES', path: '/tmp/x' }]) assert.throws(() => validateProposalInput(request));
  assert.deepEqual(validateAuditRequest(undefined), {});
  assert.throws(() => validateAuditRequest({ proposalId: 'x', delete: true }));
});

test('audit payload shape carries no secrets or unnecessary free text', async (t) => {
  const { store } = await fixture(t);
  await store.createProposal({ transaction: money, evaluation });
  const { events } = await store.getAudit();
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /seed|private.?key|mnemonic|password|context|description/i);
  assert.deepEqual(Object.keys(events[0].details).sort(), ['outcome', 'policyId', 'policyVersion', 'reasonCodes'].sort());
});
