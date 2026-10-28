/** Pure treasury domain with no application runtime imports. */
export const CURRENCY_METADATA = {
  KES: { minorUnitExponent: 2, name: 'Kenyan shilling' },
  USD: { minorUnitExponent: 2, name: 'US dollar' },
  JPY: { minorUnitExponent: 0, name: 'Japanese yen' },
} as const;
export type CurrencyCode = keyof typeof CURRENCY_METADATA;
declare const minorUnitsBrand: unique symbol;
export type MinorUnits = number & { readonly [minorUnitsBrand]: true };
export interface Money { readonly currency: CurrencyCode; readonly minorUnits: MinorUnits }
export interface TreasuryBudget { readonly period: string; readonly cap: Money }
export interface SpendingLimits { readonly perTransaction: Money; readonly periodBudget?: TreasuryBudget }
export interface ProposedTransaction { readonly amount: Money; readonly description?: string }
export interface PolicyConfiguration {
  readonly id: string;
  readonly version: number;
  readonly currency: CurrencyCode;
  readonly perTransactionLimit: Money;
  readonly periodBudget: TreasuryBudget;
  readonly approvalThreshold: Money;
}
export type Decision = 'allow' | 'require_approval' | 'deny';
export type DecisionReasonCode = 'POLICY_MISSING' | 'POLICY_INVALID' | 'TRANSACTION_INVALID' | 'CURRENCY_MISMATCH' | 'PRIOR_SPENDING_INVALID' | 'HARD_TRANSACTION_LIMIT_EXCEEDED' | 'PERIOD_BUDGET_EXCEEDED' | 'APPROVAL_THRESHOLD_REACHED' | 'WITHIN_POLICY_LIMITS';
export interface PolicyEvaluationResult { readonly outcome: Decision; readonly reasonCodes: readonly DecisionReasonCode[]; readonly explanation: string }
export interface PolicyEvaluationInput { readonly transaction: ProposedTransaction; readonly policy: PolicyConfiguration | null | undefined; readonly priorSpending: Money }

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.hasOwn(CURRENCY_METADATA, value);
}

/** Parse a decimal user input exactly into integer minor units. Extra precision is rejected, never rounded. */
export function parseMoney(value: unknown, currency: unknown): Money {
  if (!isCurrencyCode(currency)) throw new Error('Unsupported currency code.');
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error('Enter a non-negative decimal amount using digits and an optional decimal point.');
  const exponent = CURRENCY_METADATA[currency].minorUnitExponent;
  const [whole = '', fraction = ''] = value.split('.');
  if (fraction.length > exponent) throw new Error(`${currency} supports at most ${exponent} decimal places; rounding is not performed.`);
  const minorText = `${whole}${fraction.padEnd(exponent, '0')}`;
  const minor = Number(minorText);
  if (!Number.isSafeInteger(minor)) throw new Error('Amount is too large to represent safely.');
  return { currency, minorUnits: minor as MinorUnits };
}

export function moneyFromMinorUnits(value: unknown, currency: unknown): Money {
  if (!isCurrencyCode(currency)) throw new Error('Unsupported currency code.');
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Minor units must be a non-negative safe integer.');
  return { currency, minorUnits: value as MinorUnits };
}

export function compareMoney(left: Money, right: Money): -1 | 0 | 1 {
  if (!left || !right || !isCurrencyCode(left.currency) || !isCurrencyCode(right.currency)) throw new Error('Invalid monetary value.');
  if (!Number.isSafeInteger(left.minorUnits) || !Number.isSafeInteger(right.minorUnits) || left.minorUnits < 0 || right.minorUnits < 0) throw new Error('Invalid minor-unit amount.');
  if (left.currency !== right.currency) throw new Error('Cannot compare amounts in different currencies.');
  return left.minorUnits < right.minorUnits ? -1 : left.minorUnits > right.minorUnits ? 1 : 0;
}

export function validatePolicy(policy: PolicyConfiguration | null | undefined): boolean {
  if (!policy || typeof policy !== 'object' || typeof policy.id !== 'string' || !policy.id || policy.version !== 1 || !isCurrencyCode(policy.currency)) return false;
  try {
    for (const money of [policy.perTransactionLimit, policy.approvalThreshold, policy.periodBudget?.cap]) {
      if (!money || money.currency !== policy.currency || !Number.isSafeInteger(money.minorUnits) || money.minorUnits < 0) return false;
    }
    return typeof policy.periodBudget.period === 'string' && policy.periodBudget.period.length > 0;
  } catch { return false; }
}

function result(outcome: Decision, code: DecisionReasonCode, explanation: string): PolicyEvaluationResult {
  return { outcome, reasonCodes: [code], explanation };
}

/** Precedence: malformed/missing policy and inputs, currency/data mismatch, hard limits, approval threshold, then allow. */
export function evaluatePolicy(input: PolicyEvaluationInput): PolicyEvaluationResult {
  if (!input?.policy) return result('deny', 'POLICY_MISSING', 'No policy is configured, so the proposal is denied.');
  if (!validatePolicy(input.policy)) return result('deny', 'POLICY_INVALID', 'The configured policy is invalid or unsupported, so the proposal is denied.');
  let amount: Money;
  try {
    amount = input.transaction?.amount;
    if (!amount || !isCurrencyCode(amount.currency) || !Number.isSafeInteger(amount.minorUnits) || amount.minorUnits < 0) throw new Error();
  } catch { return result('deny', 'TRANSACTION_INVALID', 'The proposed amount is invalid, so the proposal is denied.'); }
  if (amount.currency !== input.policy.currency) return result('deny', 'CURRENCY_MISMATCH', 'The proposal currency does not match the policy currency; no conversion is applied.');
  const prior = input.priorSpending;
  if (!prior || prior.currency !== input.policy.currency || !Number.isSafeInteger(prior.minorUnits) || prior.minorUnits < 0) return result('deny', 'PRIOR_SPENDING_INVALID', 'Prior spending is missing or invalid, so the budget decision fails closed.');
  const cap = input.policy.periodBudget.cap.minorUnits;
  const txLimit = input.policy.perTransactionLimit.minorUnits;
  if (amount.minorUnits > txLimit) return result('deny', 'HARD_TRANSACTION_LIMIT_EXCEEDED', 'The proposal exceeds the per-transaction hard limit.');
  if (prior.minorUnits > cap || amount.minorUnits > cap - prior.minorUnits) return result('deny', 'PERIOD_BUDGET_EXCEEDED', 'The proposal would exceed the period budget using the supplied prior-spending total.');
  if (amount.minorUnits >= input.policy.approvalThreshold.minorUnits) return result('require_approval', 'APPROVAL_THRESHOLD_REACHED', 'The proposal is within hard limits but meets the threshold for human approval.');
  return result('allow', 'WITHIN_POLICY_LIMITS', 'The proposal is within the configured limits based on supplied prior spending.');
}

/** Synthetic fixture for UI demonstration only; it is not stored history. */
export const DEMO_POLICY: PolicyConfiguration = {
  id: 'synthetic-procurement-v1', version: 1, currency: 'KES',
  perTransactionLimit: { currency: 'KES', minorUnits: 2_000_000 as MinorUnits },
  periodBudget: { period: 'example week', cap: { currency: 'KES', minorUnits: 6_000_000 as MinorUnits } },
  approvalThreshold: { currency: 'KES', minorUnits: 1_000_000 as MinorUnits },
};
export const DEMO_PRIOR_SPENDING: Money = { currency: 'KES', minorUnits: 2_400_000 as MinorUnits };
