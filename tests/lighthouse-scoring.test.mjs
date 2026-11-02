import test from 'node:test';
import assert from 'node:assert/strict';
import { LH_V10_CURVES, metricContribution, quantileAtValue } from '../src/lighthouse-scoring.mjs';

const closeTo = (actual, expected, tolerance = 0.001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('Lighthouse curves give approximately 50 at median and 90 at p10', () => {
  for (const [strategy, curves] of Object.entries(LH_V10_CURVES)) {
    for (const [key, curve] of Object.entries(curves)) {
      const median = metricContribution(strategy, key, curve.median);
      const p10 = metricContribution(strategy, key, curve.p10);
      closeTo(median.score, 50);
      closeTo(p10.score, 90);
      closeTo(median.points, curve.weight * 50);
      assert.equal(median.maxPoints, curve.weight * 100);
      assert.ok(metricContribution(strategy, key, curve.p10 / 2).score > p10.score);
    }
  }
});

test('invalid inputs return null and non-positive values are clamped', () => {
  assert.equal(metricContribution('tablet', 'fcp', 500), null);
  assert.equal(metricContribution('mobile', 'unknown', 500), null);
  assert.equal(metricContribution('mobile', 'fcp', Infinity), null);
  assert.deepEqual(metricContribution('mobile', 'fcp', -1), metricContribution('mobile', 'fcp', 0));
});

test('explicit point of diminishing returns overrides derived curve', () => {
  const curve = LH_V10_CURVES.mobile.fcp;
  assert.notEqual(quantileAtValue({ ...curve, podr: 500 }, 2000), quantileAtValue(curve, 2000));
});
