import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateProposalInput } from '../dist/electron/validation.js';
import {
  CURRENCY_METADATA, DEMO_POLICY, DEMO_PRIOR_SPENDING, compareMoney,
  evaluatePolicy, moneyFromMinorUnits, parseMoney,
} from '../dist/electron/treasury-domain.js';

const money = (value) => parseMoney(value, 'KES');
const evaluate = (amount, policy = DEMO_POLICY, prior = DEMO_PRIOR_SPENDING) =>
  evaluatePolicy({ transaction: { amount }, policy, priorSpending: prior });

test('exact decimal conversion follows currency metadata without floating point', () => {
  assert.equal(CURRENCY_METADATA.JPY.minorUnitExponent, 0);
  assert.equal(parseMoney('12', 'JPY').minorUnits, 12);
  assert.equal(parseMoney('12.3', 'KES').minorUnits, 1230);
  assert.equal(parseMoney('12.34', 'USD').minorUnits, 1234);
  assert.throws(() => parseMoney('12.345', 'KES'), /rounding is not performed/);
});

test('allows a valid transaction below the approval threshold', () => {
  assert.equal(evaluate(money('5000')).outcome, 'allow');
});

test('transaction exactly at the hard limit is evaluated and requires approval at threshold', () => {
  const result = evaluate(money('20000'));
  assert.equal(result.outcome, 'require_approval');
  assert.equal(result.reasonCodes[0], 'APPROVAL_THRESHOLD_REACHED');
});

test('transaction above hard limit is denied before approval rules', () => {
  const result = evaluate(money('20000.01'));
  assert.equal(result.outcome, 'deny');
  assert.equal(result.reasonCodes[0], 'HARD_TRANSACTION_LIMIT_EXCEEDED');
});

test('period budget uses explicitly supplied prior spending; exact exhaustion is permitted', () => {
  const capPolicy = { ...DEMO_POLICY, perTransactionLimit: money('50000'), approvalThreshold: money('40000') };
  assert.equal(evaluate(money('36000'), capPolicy).outcome, 'allow');
  const over = evaluate(money('36000.01'), capPolicy);
  assert.equal(over.outcome, 'deny');
  assert.equal(over.reasonCodes[0], 'PERIOD_BUDGET_EXCEEDED');
});

test('zero is permitted at exact budget exhaustion because it adds no spending', () => {
  const exhausted = moneyFromMinorUnits(6_000_000, 'KES');
  assert.equal(evaluate(money('0'), DEMO_POLICY, exhausted).outcome, 'allow');
  assert.equal(evaluate(money('0')).outcome, 'allow');
  assert.equal(evaluate(money('0'), DEMO_POLICY, moneyFromMinorUnits(6_000_001, 'KES')).reasonCodes[0], 'PERIOD_BUDGET_EXCEEDED');
});

test('missing and malformed policy fail closed', () => {
  assert.equal(evaluate(money('100'), null).reasonCodes[0], 'POLICY_MISSING');
  assert.equal(evaluate(money('100'), { ...DEMO_POLICY, version: 99 }).reasonCodes[0], 'POLICY_INVALID');
});

test('rejects negative, malformed, unsafe, and over-precision monetary values', () => {
  for (const value of ['-1', '+1', '1e3', '1,000', '', ' 1', '01', '1.001']) assert.throws(() => parseMoney(value, 'KES'));
  assert.throws(() => parseMoney('9007199254740992', 'KES'), /safely/);
  assert.throws(() => moneyFromMinorUnits(-1, 'KES'));
  assert.throws(() => moneyFromMinorUnits(Number.MAX_SAFE_INTEGER + 1, 'KES'));
});

test('unsupported currencies and incompatible currency comparisons are rejected', () => {
  assert.throws(() => parseMoney('1', 'EUR'), /Unsupported/);
  assert.throws(() => compareMoney(money('1'), parseMoney('1', 'USD')), /different currencies/);
  assert.equal(evaluate(parseMoney('1', 'USD')).reasonCodes[0], 'CURRENCY_MISMATCH');
});

test('missing, negative, unsafe, and incompatible prior spending fail closed', () => {
  for (const priorSpending of [null, moneyFromMinorUnits(1, 'USD'), { currency: 'KES', minorUnits: -1 }, { currency: 'KES', minorUnits: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(evaluate(money('1'), DEMO_POLICY, priorSpending).reasonCodes[0], 'PRIOR_SPENDING_INVALID');
  }
});

test('identical inputs produce identical machine and human results', () => {
  const input = { transaction: { amount: money('9000') }, policy: DEMO_POLICY, priorSpending: DEMO_PRIOR_SPENDING };
  assert.deepEqual(evaluatePolicy(input), evaluatePolicy(input));
});

test('policy engine has no QVAC/model dependency or model text parameter', async () => {
  const source = await readFile(new URL('../src/electron/treasury-domain.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:from|require\s*\()\s*['"][^'"]*qvac/i);
  assert.match(source, /evaluatePolicy\(input: PolicyEvaluationInput\)/);
});

test('renderer policy boundary accepts only amount and currency; main selects the fixed fixture', async () => {
  assert.deepEqual(validateProposalInput({ amount: '8000', currency: 'KES' }), { amount: '8000', currency: 'KES' });
  for (const value of [null, {}, { amount: '1', currency: 'KES', outcome: 'allow' }, { amount: 1, currency: 'KES' }]) {
    assert.throws(() => validateProposalInput(value));
  }
  const main = await readFile(new URL('../src/electron/main.ts', import.meta.url), 'utf8');
  assert.match(main, /ipcMain\.handle\(IPC\.evaluateProposal/);
  assert.match(main, /policy: DEMO_POLICY,[\s\S]*priorSpending: DEMO_PRIOR_SPENDING/);
  assert.match(main, /result: evaluatePolicy\(/);
});
