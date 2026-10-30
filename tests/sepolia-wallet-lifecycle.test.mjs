import assert from 'node:assert/strict';
import test from 'node:test';
import { SepoliaWalletService } from '../dist/electron/sepolia-wallet.js';
import { ERC20_INTERFACE, TEST_USDT_ADDRESS } from '../dist/electron/sepolia-domain.js';

const address = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
const hash = `0x${'b'.repeat(64)}`;
const amount = '1000000';
const fee = '20000000000000';
function mockService({ send = async () => ({ hash }) } = {}) {
  const service = new SepoliaWalletService('/unused', {});
  service.quoteCache.set('proposal-1', { proposalId: 'proposal-1', chainId: 11155111, asset: 'sepolia-test-USDt', tokenAddress: TEST_USDT_ADDRESS, recipient: address, amountBaseUnits: amount, feeWei: fee, decision: 'allow', reason: 'WITHIN_SEPOLIA_TEST_USDT_POLICY' });
  service.approved = new Set();
  service.requireReadyVault = async () => ({ schemaVersion: 1, encryptedSeed: '', backupConfirmed: true });
  service.rpc = async () => '0xaa36a7';
  service.verifyTokenContract = async () => true;
  const account = {
    getAddress: async () => `0x${'c'.repeat(40)}`,
    quoteTransfer: async () => ({ fee: BigInt(fee), gasLimit: 65000n, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 100_000_000n }),
    getTokenBalance: async () => 100_000_000n,
    getBalance: async () => 10n ** 18n,
    transfer: send,
    dispose() {},
  };
  service.withAccount = async (_record, operation) => operation(account, { dispose() {} });
  return service;
}

test('user rejection or cancellation never reaches signing or broadcast', async () => {
  let sent = 0;
  const rejected = mockService({ send: async () => { sent++; return { hash }; } });
  rejected.quoteCache.get('proposal-1').decision = 'require_approval';
  await assert.rejects(rejected.submitTransfer('proposal-1', async () => {}), /explicit policy approval/);
  rejected.cancelTransfer('proposal-1');
  await assert.rejects(rejected.submitTransfer('proposal-1', async () => {}), /quote expired/);
  assert.equal(sent, 0);
});

test('an ambiguous WDK submission becomes unknown and is never blindly retried', async () => {
  let sent = 0; const states = [];
  const service = mockService({ send: async () => { sent++; throw new Error('response lost'); } });
  const result = await service.submitTransfer('proposal-1', async (state) => { states.push(state); });
  assert.equal(result.status, 'unknown'); assert.equal(sent, 1);
  await assert.rejects(service.submitTransfer('proposal-1', async () => {}), /quote expired/);
  assert.equal(sent, 1); assert.deepEqual(states, ['signing', 'broadcast_attempt', 'unknown']);
});

test('duplicate signing is rejected while the first submission is active', async () => {
  let release;
  const service = mockService({ send: () => new Promise((resolve) => { release = () => resolve({ hash }); }) });
  const first = service.submitTransfer('proposal-1', async () => {});
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(service.submitTransfer('proposal-1', async () => {}), /already in progress/);
  release();
  assert.equal((await first).status, 'broadcast');
});

test('independent receipt verification distinguishes success, reverted, pending and invalid receipts', async () => {
  const service = new SepoliaWalletService('/unused', {});
  let receiptStatus = '0x1';
  const input = ERC20_INTERFACE.encodeFunctionData('transfer', [address, BigInt(amount)]);
  const log = ERC20_INTERFACE.encodeEventLog(ERC20_INTERFACE.getEvent('Transfer'), [`0x${'c'.repeat(40)}`, address, BigInt(amount)]);
  service.rpc = async (method) => {
    if (method === 'eth_chainId') return '0xaa36a7';
    if (method === 'eth_getTransactionByHash') return { chainId: '0xaa36a7', from: `0x${'c'.repeat(40)}`, to: TEST_USDT_ADDRESS, value: '0x0', input };
    return receiptStatus === 'pending' ? null : { transactionHash: hash, status: receiptStatus, blockNumber: '0x10', logs: [{ address: TEST_USDT_ADDRESS, topics: log.topics, data: log.data }] };
  };
  assert.equal((await service.verifyReceipt(hash)).status, 'confirmed');
  receiptStatus = '0x0'; assert.equal((await service.verifyReceipt(hash)).status, 'failed');
  receiptStatus = 'pending'; assert.equal((await service.verifyReceipt(hash)).status, 'pending');
  await assert.rejects(service.verifyReceipt('invalid'), /Invalid transaction hash/);
});
