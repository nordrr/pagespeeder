import test from 'node:test';
import assert from 'node:assert/strict';
import { METRICS } from '../src/metrics.mjs';
import { mean, stdDevSample, ci95, summarize, sampleFingerprint, isDuplicateSample, percentileRank, getPercentile } from '../src/statistics.mjs';

const sample = (performanceScore, timestamp, fetchTime = null) => ({
  performanceScore, timestamp, lighthouseFetchTime: fetchTime,
  metrics: Object.fromEntries(METRICS.map(({ key }, i) => [key, { value: performanceScore + i, score: performanceScore - i }])),
});

test('mean, sample standard deviation and confidence interval handle sample sizes', () => {
  assert.equal(mean([]), 0);
  assert.equal(stdDevSample([4]), 0);
  assert.equal(ci95([4]), null);
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(stdDevSample([1, 2, 3]), 1);
  assert.ok(Math.abs(ci95([1, 2, 3]) - 1.96 / Math.sqrt(3)) < 1e-12);
});

test('summary preserves metric averages, confidence and latest input timestamp', () => {
  assert.equal(summarize([]), null);
  const result = summarize([sample(70, 500), sample(90, 100)]);
  assert.equal(result.samples, 2);
  assert.equal(result.avgScore, 80);
  assert.equal(result.scoreStdDev, Math.sqrt(200));
  assert.equal(result.latestTimestamp, 100);
  assert.deepEqual(result.metrics.cls, { avgValue: 84, avgScore: 76, ci95Value: 19.6 });
  assert.equal(summarize([sample(70, 1)]).metrics.fcp.ci95Value, null);
});

test('duplicate detection uses fetch time or all metric values and scores', () => {
  const first = sample(80, 1, 'date');
  assert.equal(isDuplicateSample(first, sample(90, 2, 'date')), true);
  assert.equal(isDuplicateSample(first, sample(80, 2, 'another date')), true);
  assert.equal(isDuplicateSample(first, sample(81, 2)), false);
  assert.equal(isDuplicateSample(null, first), false);
  assert.equal(sampleFingerprint({ performanceScore: 80, metrics: {} }), '');
});

test('percentiles handle ties, singleton, absent populations and direction', () => {
  assert.equal(percentileRank([], 2), 0);
  assert.equal(percentileRank([3], 1), 100);
  assert.equal(percentileRank([1, 2, 2, 4], 2), 50);
  assert.equal(getPercentile([], 2), 50);
  assert.equal(getPercentile([1, 2, 3, 4], 1, false), 87.5);
  assert.equal(getPercentile([1], NaN), null);
});
