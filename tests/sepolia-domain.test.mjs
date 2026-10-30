import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateSepoliaEthTransfer, parseEthToWei, formatWeiAsEth, validateEvmAddress,
  SEPOLIA_CHAIN_ID, SEPOLIA_ETH_POLICY,
  parseTestUsdt, formatTestUsdt, evaluateSepoliaTestUsdtTransfer, SEPOLIA_TEST_USDT_POLICY, TEST_USDT_ADDRESS, decodeTestUsdtTransfer, ERC20_INTERFACE, testUsdtTransferLogMatches,
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

test('test USD₮ uses exact six decimal units and enforces token identity and limits', () => {
  assert.equal(parseTestUsdt('1.000001'), 1_000_001n);
  assert.equal(formatTestUsdt(1_000_001n), '1.000001');
  assert.throws(() => parseTestUsdt('0.0000001'));
  const input = { chainId: SEPOLIA_CHAIN_ID, asset: 'sepolia-test-USDt', tokenAddress: TEST_USDT_ADDRESS, amountBaseUnits: 2_000_000n, feeWei: 10n, policy: SEPOLIA_TEST_USDT_POLICY };
  assert.equal(evaluateSepoliaTestUsdtTransfer(input).outcome, 'allow');
  assert.equal(evaluateSepoliaTestUsdtTransfer({ ...input, amountBaseUnits: SEPOLIA_TEST_USDT_POLICY.approvalThresholdUnits }).outcome, 'require_approval');
  assert.equal(evaluateSepoliaTestUsdtTransfer({ ...input, tokenAddress: `0x${'1'.repeat(40)}` }).reason, 'UNSUPPORTED_ASSET');
  assert.equal(evaluateSepoliaTestUsdtTransfer({ ...input, amountBaseUnits: SEPOLIA_TEST_USDT_POLICY.maxTransferUnits + 1n }).reason, 'TRANSFER_LIMIT_EXCEEDED');
});

test('test USD₮ receipt helpers recognize only zero-value ERC-20 transfer shape and exact event', () => {
  const data = ERC20_INTERFACE.encodeFunctionData('transfer', [`0x${'a'.repeat(40)}`, 123456n]);
  assert.deepEqual(decodeTestUsdtTransfer(data, '0x0'), { recipient: '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa', amountBaseUnits: '123456' });
  assert.equal(decodeTestUsdtTransfer(data, '0x1'), null);
  const event = ERC20_INTERFACE.encodeEventLog(ERC20_INTERFACE.getEvent('Transfer'), [`0x${'b'.repeat(40)}`, `0x${'a'.repeat(40)}`, 123456n]);
  assert.equal(testUsdtTransferLogMatches({ address: TEST_USDT_ADDRESS, topics: event.topics, data: event.data }, `0x${'b'.repeat(40)}`, `0x${'a'.repeat(40)}`, '123456'), true);
});
