import { AbiCoder, Interface, getAddress } from 'ethers';
import type { Decision } from './treasury-domain.js';

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';
export const SEPOLIA_VERIFICATION_RPC_URL = 'https://public.1rpc.io/sepolia';
export const SEPOLIA_EXPLORER_URL = 'https://sepolia.etherscan.io/tx/';
export const WEI_PER_ETH = 10n ** 18n;
export const TEST_USDT_ADDRESS = getAddress('0xd077A400968890Eacc75cdc901F0356c943e4fDb');
export const TEST_USDT_NAME = 'Tether USD';
export const TEST_USDT_SYMBOL = 'USD₮';
export const TEST_USDT_DECIMALS = 6;
export const TEST_USDT_UNITS = 10n ** 6n;
export const TEST_USDT_EXPLORER_URL = `https://sepolia.etherscan.io/token/${TEST_USDT_ADDRESS}`;
export const ERC20_INTERFACE = new Interface([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

/** Legacy policy retained only to interpret pre-switch native ETH activity records. */
export const SEPOLIA_ETH_POLICY = Object.freeze({
  id: 'sepolia-native-eth-test-v1', version: 1, chainId: SEPOLIA_CHAIN_ID,
  asset: 'native-ETH' as const,
  maxTransferWei: 1_000_000_000_000_000n,
  approvalThresholdWei: 500_000_000_000_000n,
  maxFeeWei: 100_000_000_000_000n,
});

export const SEPOLIA_TEST_USDT_POLICY = Object.freeze({
  id: 'sepolia-test-usdt-v1', version: 1, chainId: SEPOLIA_CHAIN_ID,
  asset: 'sepolia-test-USDt' as const,
  tokenAddress: TEST_USDT_ADDRESS,
  tokenDecimals: TEST_USDT_DECIMALS,
  maxTransferUnits: 100n * TEST_USDT_UNITS,
  approvalThresholdUnits: 50n * TEST_USDT_UNITS,
  maxFeeWei: 100_000_000_000_000n,
});

export function parseTestUsdt(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 48 || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    throw new Error('Enter a non-negative Sepolia test USD₮ amount with at most 6 decimal places.');
  }
  const [whole, fraction = ''] = value.split('.');
  const units = BigInt(whole!) * TEST_USDT_UNITS + BigInt(fraction.padEnd(TEST_USDT_DECIMALS, '0') || '0');
  if (units <= 0n) throw new Error('Test USD₮ transfer amount must be greater than zero.');
  return units;
}

export function formatTestUsdt(units: bigint): string {
  if (units < 0n) throw new Error('Test USD₮ amount cannot be negative.');
  const whole = units / TEST_USDT_UNITS;
  const fraction = (units % TEST_USDT_UNITS).toString().padStart(TEST_USDT_DECIMALS, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export interface TestUsdtPolicyResult { outcome: Decision; reason: string }

export function evaluateSepoliaTestUsdtTransfer(input: {
  chainId: number; asset: string; tokenAddress: string; amountBaseUnits: bigint; feeWei: bigint | null;
  policy?: typeof SEPOLIA_TEST_USDT_POLICY | null;
}): TestUsdtPolicyResult {
  if (!input.policy) return { outcome: 'deny', reason: 'TEST_USDT_POLICY_MISSING' };
  if (input.policy.version !== 1 || input.policy.id !== SEPOLIA_TEST_USDT_POLICY.id || input.policy.tokenAddress !== TEST_USDT_ADDRESS) return { outcome: 'deny', reason: 'TEST_USDT_POLICY_INVALID' };
  if (input.chainId !== SEPOLIA_CHAIN_ID) return { outcome: 'deny', reason: 'UNSUPPORTED_CHAIN' };
  if (input.asset !== 'sepolia-test-USDt' || input.tokenAddress.toLowerCase() !== TEST_USDT_ADDRESS.toLowerCase()) return { outcome: 'deny', reason: 'UNSUPPORTED_ASSET' };
  if (input.amountBaseUnits <= 0n) return { outcome: 'deny', reason: 'INVALID_AMOUNT' };
  if (input.feeWei === null || input.feeWei < 0n) return { outcome: 'deny', reason: 'FEE_ESTIMATE_UNAVAILABLE' };
  if (input.feeWei > input.policy.maxFeeWei) return { outcome: 'deny', reason: 'FEE_LIMIT_EXCEEDED' };
  if (input.amountBaseUnits > input.policy.maxTransferUnits) return { outcome: 'deny', reason: 'TRANSFER_LIMIT_EXCEEDED' };
  if (input.amountBaseUnits >= input.policy.approvalThresholdUnits) return { outcome: 'require_approval', reason: 'APPROVAL_THRESHOLD_REACHED' };
  return { outcome: 'allow', reason: 'WITHIN_SEPOLIA_TEST_USDT_POLICY' };
}

export function decodeTestUsdtTransfer(data: string, value: string): { recipient: string; amountBaseUnits: string } | null {
  try {
    if (BigInt(value) !== 0n) return null;
    const parsed = ERC20_INTERFACE.parseTransaction({ data, value: 0n });
    if (!parsed || parsed.name !== 'transfer') return null;
    return { recipient: getAddress(parsed.args[0]), amountBaseUnits: (parsed.args[1] as bigint).toString() };
  } catch { return null; }
}

export function testUsdtTransferLogMatches(
  log: { address?: string; topics?: string[]; data?: string }, from: string, recipient: string, amountBaseUnits: string,
): boolean {
  try {
    if (log.address?.toLowerCase() !== TEST_USDT_ADDRESS.toLowerCase() || !log.topics || log.topics.length !== 3 || !log.data) return false;
    if (log.topics[0] !== ERC20_INTERFACE.getEvent('Transfer')!.topicHash) return false;
    const [eventFrom, eventRecipient, value] = AbiCoder.defaultAbiCoder().decode(
      ['address', 'address', 'uint256'], `0x${log.topics[1]!.slice(2)}${log.topics[2]!.slice(2)}${log.data.slice(2)}`,
    );
    return getAddress(eventFrom).toLowerCase() === from.toLowerCase() &&
      getAddress(eventRecipient).toLowerCase() === recipient.toLowerCase() && (value as bigint).toString() === amountBaseUnits;
  } catch { return false; }
}

/** Legacy parsing helpers retained for existing native ETH fixtures. */
export function parseEthToWei(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 60 || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error('Enter a non-negative ETH amount with at most 18 decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const wei = BigInt(whole!) * WEI_PER_ETH + BigInt(fraction.padEnd(18, '0') || '0');
  if (wei <= 0n) throw new Error('Transfer amount must be greater than zero.');
  return wei;
}

export function formatWeiAsEth(value: bigint): string {
  if (value < 0n) throw new Error('Wei amount cannot be negative.');
  const whole = value / WEI_PER_ETH;
  const fraction = (value % WEI_PER_ETH).toString().padStart(18, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function validateEvmAddress(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('Enter a valid 20-byte EVM recipient address.');
  try { return getAddress(value); } catch { throw new Error('Recipient address checksum is invalid.'); }
}

export interface EthPolicyResult { outcome: Decision; reason: string }
export function evaluateSepoliaEthTransfer(input: {
  chainId: number; asset: string; amountWei: bigint; feeWei: bigint | null; policy?: typeof SEPOLIA_ETH_POLICY | null;
}): EthPolicyResult {
  if (!input.policy) return { outcome: 'deny', reason: 'ETH_TRANSFER_POLICY_MISSING' };
  if (input.policy.version !== 1 || input.policy.id !== SEPOLIA_ETH_POLICY.id) return { outcome: 'deny', reason: 'ETH_TRANSFER_POLICY_INVALID' };
  if (input.chainId !== SEPOLIA_CHAIN_ID) return { outcome: 'deny', reason: 'UNSUPPORTED_CHAIN' };
  if (input.asset !== 'native-ETH') return { outcome: 'deny', reason: 'UNSUPPORTED_ASSET' };
  if (input.amountWei <= 0n) return { outcome: 'deny', reason: 'INVALID_AMOUNT' };
  if (input.feeWei === null || input.feeWei < 0n) return { outcome: 'deny', reason: 'FEE_ESTIMATE_UNAVAILABLE' };
  if (input.feeWei > input.policy.maxFeeWei) return { outcome: 'deny', reason: 'FEE_LIMIT_EXCEEDED' };
  if (input.amountWei > input.policy.maxTransferWei) return { outcome: 'deny', reason: 'TRANSFER_LIMIT_EXCEEDED' };
  if (input.amountWei >= input.policy.approvalThresholdWei) return { outcome: 'require_approval', reason: 'APPROVAL_THRESHOLD_REACHED' };
  return { outcome: 'allow', reason: 'WITHIN_SEPOLIA_ETH_POLICY' };
}
