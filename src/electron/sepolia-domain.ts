import type { Decision } from './treasury-domain.js';

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com';
export const SEPOLIA_VERIFICATION_RPC_URL = 'https://public.1rpc.io/sepolia';
export const SEPOLIA_EXPLORER_URL = 'https://sepolia.etherscan.io/tx/';
export const WEI_PER_ETH = 10n ** 18n;

/** Versioned test-only limits. Test ETH has no implied fiat value. */
export const SEPOLIA_ETH_POLICY = Object.freeze({
  id: 'sepolia-native-eth-test-v1', version: 1, chainId: SEPOLIA_CHAIN_ID,
  asset: 'native-ETH' as const,
  maxTransferWei: 1_000_000_000_000_000n, // 0.001 ETH
  approvalThresholdWei: 500_000_000_000_000n, // 0.0005 ETH
  maxFeeWei: 100_000_000_000_000n, // 0.0001 ETH
});

export interface EthPolicyResult { outcome: Decision; reason: string }

export function parseEthToWei(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 60 || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) {
    throw new Error('Enter a non-negative ETH amount with at most 18 decimal places.');
  }
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

export function evaluateSepoliaEthTransfer(input: {
  chainId: number; asset: string; amountWei: bigint; feeWei: bigint | null;
  policy?: typeof SEPOLIA_ETH_POLICY | null;
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
import { getAddress } from 'ethers';
