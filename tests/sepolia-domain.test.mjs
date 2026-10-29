import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateSepoliaEthTransfer, parseEthToWei, formatWeiAsEth, validateEvmAddress,
  SEPOLIA_CHAIN_ID, SEPOLIA_ETH_POLICY,
} from '../dist/electron/sepolia-domain.js';

const evalTx = (overrides = {}) => evaluateSepoliaEthTransfer({ chainId: SEPOLIA_CHAIN_ID, asset: 'native-ETH', amountWei: 100_000_000_000_000n, feeWei: 20_000_000_000_000n, policy: SEPOLIA_ETH_POLICY, ...overrides });

test('ETH decimal conversion is exact in wei and enforces 18 decimal places', () => {
  assert.equal(parseEthToWei('0.000000000000000001'), 1n);
  assert.equal(parseEthToWei('0.001'), 1_000_000_000_000_000n);
  assert.equal(formatWeiAsEth(1n), '0.000000000000000001');
  assert.throws(() => parseEthToWei('0.0000000000000000001'));
  assert.throws(() => parseEthToWei('1e-3'));
  assert.throws(() => parseEthToWei('0'));
  assert.throws(() => parseEthToWei('9'.repeat(61)));
});

test('recipient validation accepts canonical EVM addresses and rejects malformed/checksum-invalid values', () => {
  assert.equal(validateEvmAddress(`0x${'a'.repeat(40)}`), '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa');
  assert.throws(() => validateEvmAddress('0x1234'));
  assert.throws(() => validateEvmAddress(`0x${'aA'.repeat(20)}`));
});

test('Sepolia ETH policy allows, requires approval, and hard-denies exact wei amounts', () => {
  assert.equal(evalTx().outcome, 'allow');
  assert.equal(evalTx({ amountWei: SEPOLIA_ETH_POLICY.approvalThresholdWei }).outcome, 'require_approval');
  assert.equal(evalTx({ amountWei: SEPOLIA_ETH_POLICY.maxTransferWei + 1n }).reason, 'TRANSFER_LIMIT_EXCEEDED');
  assert.equal(evalTx({ feeWei: SEPOLIA_ETH_POLICY.maxFeeWei + 1n }).reason, 'FEE_LIMIT_EXCEEDED');
});

test('missing fees, policies, chains, and assets fail closed', () => {
  assert.equal(evalTx({ feeWei: null }).reason, 'FEE_ESTIMATE_UNAVAILABLE');
  assert.equal(evalTx({ policy: null }).reason, 'ETH_TRANSFER_POLICY_MISSING');
  assert.equal(evalTx({ chainId: 1 }).reason, 'UNSUPPORTED_CHAIN');
  assert.equal(evalTx({ asset: 'erc20' }).reason, 'UNSUPPORTED_ASSET');
});
