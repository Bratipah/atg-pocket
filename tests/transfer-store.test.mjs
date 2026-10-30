import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TransferStore, verifyTransferEvents } from '../dist/electron/transfer-store.js';
import { TEST_USDT_ADDRESS } from '../dist/electron/sepolia-domain.js';

test('transfer lifecycle and hash-chained audit survive restart with minimal public details', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atg-transfer-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'transfers.json'); const store = new TransferStore(file);
  const proposal = await store.create({ chainId: 11155111, asset: 'native-ETH', recipient: `0x${'a'.repeat(40)}`, amountWei: '100000000000000', feeWei: '20000000000000', decision: 'require_approval', reason: 'APPROVAL_THRESHOLD_REACHED' });
  await store.update(proposal.id, 'ready_to_confirm', { humanApproval: true }, { approved: true });
  await store.update(proposal.id, 'ready_to_confirm', { humanAction: 'explicit_confirmation' }, { confirmed: true });
  await store.update(proposal.id, 'signing'); await store.update(proposal.id, 'signed');
  await store.recordEvent(proposal.id, 'broadcast.attempt');
  await store.update(proposal.id, 'broadcast', { txHash: `0x${'b'.repeat(64)}` }, { txHash: `0x${'b'.repeat(64)}` });
  const restarted = new TransferStore(file); const record = (await restarted.list())[0];
  assert.equal(record.state, 'broadcast'); assert.equal(record.approved, true); assert.equal(record.confirmed, true);
  const audit = await restarted.audit(); assert.equal(audit.valid, true); assert.equal(audit.events.length, 9);
  assert.doesNotMatch(JSON.stringify(audit.events), /mnemonic|private.?key|seedphrase|signedTransaction/i);
});

test('transfer store accepts test USD₮ rows while preserving legacy ETH activity', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atg-transfer-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'transfers.json'); const store = new TransferStore(file);
  const legacy = await store.create({ chainId: 11155111, asset: 'native-ETH', recipient: `0x${'a'.repeat(40)}`, amountWei: '100', feeWei: '2', decision: 'allow', reason: 'legacy' });
  const token = await store.create({ chainId: 11155111, asset: 'sepolia-test-USDt', tokenAddress: TEST_USDT_ADDRESS, recipient: `0x${'b'.repeat(40)}`, amountBaseUnits: '1234567', feeWei: '3', decision: 'allow', reason: 'test-token' });
  const restarted = new TransferStore(file); const records = await restarted.list();
  assert.deepEqual(records.map((item) => item.asset), ['sepolia-test-USDt', 'native-ETH']);
  assert.equal(records[0].amountBaseUnits, '1234567');
  assert.equal(records[1].amountWei, '100');
  assert.equal((await restarted.audit()).valid, true);
  assert.ok(legacy.id && token.id);
});

test('transfer audit tampering is detected and the corrupt snapshot is preserved', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atg-transfer-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'transfers.json'); const store = new TransferStore(file);
  await store.create({ chainId: 11155111, asset: 'native-ETH', recipient: `0x${'a'.repeat(40)}`, amountWei: '1', feeWei: '2', decision: 'allow', reason: 'WITHIN_SEPOLIA_ETH_POLICY' });
  const state = JSON.parse(await readFile(file, 'utf8')); state.events[0].details.amountWei = '3';
  const tampered = JSON.stringify(state); await writeFile(file, tampered);
  assert.equal(verifyTransferEvents(state.events), false);
  await assert.rejects(new TransferStore(file).list(), /preserved/);
  assert.equal(await readFile(file, 'utf8'), tampered);
});

test('a transfer record cannot claim a lifecycle state that its audit chain did not record', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atg-transfer-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'transfers.json'); const store = new TransferStore(file);
  const proposal = await store.create({ chainId: 11155111, asset: 'native-ETH', recipient: `0x${'a'.repeat(40)}`, amountWei: '1', feeWei: '2', decision: 'allow', reason: 'WITHIN_SEPOLIA_ETH_POLICY' });
  const state = JSON.parse(await readFile(file, 'utf8')); state.transfers[0].state = 'confirmed';
  const tampered = JSON.stringify(state); await writeFile(file, tampered);
  await assert.rejects(new TransferStore(file).list(), /preserved/);
  assert.equal((await readFile(file, 'utf8')), tampered);
  assert.equal(proposal.state, 'ready_to_confirm');
});

test('restart expires unconfirmed quotes and marks interrupted submissions unknown without retry', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atg-transfer-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'transfers.json'); const store = new TransferStore(file);
  const ready = await store.create({ chainId: 11155111, asset: 'native-ETH', recipient: `0x${'a'.repeat(40)}`, amountWei: '1', feeWei: '2', decision: 'allow', reason: 'WITHIN_SEPOLIA_ETH_POLICY' });
  const interrupted = await store.create({ chainId: 11155111, asset: 'native-ETH', recipient: `0x${'b'.repeat(40)}`, amountWei: '1', feeWei: '2', decision: 'allow', reason: 'WITHIN_SEPOLIA_ETH_POLICY' });
  await store.update(interrupted.id, 'signing'); await store.update(interrupted.id, 'signed');
  await store.recordEvent(interrupted.id, 'broadcast.attempt'); await store.update(interrupted.id, 'broadcast', { txHash: `0x${'c'.repeat(64)}` }, { txHash: `0x${'c'.repeat(64)}` });
  await store.recoverAfterRestart();
  const records = await store.list();
  assert.equal(records.find((item) => item.id === ready.id).state, 'cancelled');
  assert.equal(records.find((item) => item.id === interrupted.id).state, 'unknown');
  assert.equal(records.find((item) => item.id === interrupted.id).txHash, `0x${'c'.repeat(64)}`);
});
