import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTreasuryCosts } from '../dist/electron/treasury-cost.js';

const quote = (label, destinationAmount, sourceFee = '0', sourceAmount = '100') => ({ label, sourceAmount, destinationAmount, sourceFee });

test('compares quotes with exact decimal arithmetic and ranks effective cost', () => {
  const result = compareTreasuryCosts({ sourceAmount: '100', referenceRate: '130.5', quotes: [quote('A', '12850', '0.5'), quote('B', '12920', '1.2')] });
  assert.deepEqual(result.map((row) => [row.label, row.effectiveCostDestination]), [['A', '265.25'], ['B', '286.6']]);
});

test('fee and sub-cent decimal precision are included without floating-point rounding', () => {
  const result = compareTreasuryCosts({ sourceAmount: '1.000001', referenceRate: '1.00000001', quotes: [quote('A', '1.000001', '0.000001', '1.000001'), quote('B', '1', '0', '1.000001')] });
  assert.equal(result.find((row) => row.label === 'A').effectiveCostDestination, '0.000001');
  assert.equal(result.find((row) => row.label === 'B').effectiveCostDestination, '0.000001');
});

test('rejects invalid decimal inputs, mismatched amounts, duplicate labels, and insufficient rows', () => {
  assert.throws(() => compareTreasuryCosts({ sourceAmount: '1e2', referenceRate: '2', quotes: [quote('A', '1'), quote('B', '1')] }));
  assert.throws(() => compareTreasuryCosts({ sourceAmount: '100', referenceRate: '2', quotes: [quote('A', '1'), quote('B', '1', '0', '99')] }));
  assert.throws(() => compareTreasuryCosts({ sourceAmount: '100', referenceRate: '2', quotes: [quote('same', '1'), quote('SAME', '1')] }));
  assert.throws(() => compareTreasuryCosts({ sourceAmount: '100', referenceRate: '2', quotes: [quote('A', '1')] }));
  assert.throws(() => compareTreasuryCosts({ sourceAmount: '100', referenceRate: '2', quotes: [quote('A', '1.1234567'), quote('B', '1')] }));
});

test('preserves negative estimated cost instead of silently clamping it', () => {
  const result = compareTreasuryCosts({ sourceAmount: '1', referenceRate: '2', quotes: [quote('A', '3', '0', '1'), quote('B', '2', '0', '1')] });
  assert.equal(result[0].effectiveCostDestination, '-1');
});
