import test from 'node:test';
import assert from 'node:assert/strict';
import { METRICS } from '../src/metrics.mjs';
import { describeMetricScenario, formatDisplayedReduction, metricImprovementScenarios, rankMetricOpportunities } from '../src/views/metric-opportunity.mjs';
import { metricContribution, metricImprovementExample } from '../src/lighthouse-scoring.mjs';

test('ranks available metrics by modeled score gain for each device', () => {
  const summary = { metrics: { fcp: { avgValue: 3000 }, lcp: { avgValue: 20000 }, tbt: { avgValue: 600 }, cls: { avgValue: 0.01 } } };
  for (const mode of ['mobile', 'desktop']) {
    const result = rankMetricOpportunities(METRICS, mode, summary);
    assert.equal(result[0].metric.key, 'tbt');
    assert.ok(result.every((item, index) => index === 0 || result[index - 1].gain >= item.gain));
    assert.equal(result[0].gain, metricImprovementExample(mode, 'tbt', 600).gain);
    assert.equal(result.length, METRICS.length);
    assert.equal(result.find(item => item.metric.key === 'lcp').status, 'available');
    assert.equal(result.find(item => item.metric.key === 'cls').status, 'near-maximum');
    assert.equal(result.find(item => item.metric.key === 'si').status, 'unavailable');
  }
  assert.deepEqual(rankMetricOpportunities(METRICS, 'mobile', null), []);
  assert.equal(rankMetricOpportunities(METRICS, 'mobile', { metrics: { fcp: { avgValue: 0 } } }).find(item => item.metric.key === 'fcp').status, 'maximum');
});

test('scenario explanations use the selected mode average and estimated gain', () => {
  const metric = METRICS.find(item => item.key === 'tbt');
  const scenario = { fraction: 0.25, target: 483, gain: 4.04 };
  assert.equal(describeMetricScenario(metric, 644, scenario, 48.4, 'mobile'), 'Reducing TBT by 25% to 483ms (161ms lower) could add about 4.0 points, bringing the estimated mobile average to 52.4, assuming other metrics stay the same.');
  assert.match(describeMetricScenario(metric, 644, { ...scenario, gain: 0.01 }, null, 'desktop'), /less than 0.1 points, assuming/);
});

test('calculates both improvement scenarios from the original value and device curve', () => {
  const metric = METRICS.find(item => item.key === 'lcp');
  for (const mode of ['mobile', 'desktop']) {
    const scenarios = metricImprovementScenarios(metric, mode, 8400);
    assert.deepEqual(scenarios.map(({ target, reduction }) => [target, reduction]), [[6300, 2100], [4200, 4200]]);
    for (const scenario of scenarios) {
      assert.ok(Math.abs(scenario.gain - (metricContribution(mode, 'lcp', scenario.target).points - metricContribution(mode, 'lcp', 8400).points)) < 1e-8);
    }
  }
  assert.deepEqual(metricImprovementScenarios(metric, 'mobile', 0), []);
  assert.deepEqual(metricImprovementScenarios(metric, 'mobile', 8400, [10, 40]).map(item => item.target), [7560, 5040]);
  const customRank = rankMetricOpportunities(METRICS, 'mobile', { metrics: { lcp: { avgValue: 8400 } } }, [10, 40]);
  assert.equal(customRank.find(item => item.metric.key === 'lcp').gain, metricImprovementScenarios(metric, 'mobile', 8400, [10, 40])[0].gain);
  assert.equal(formatDisplayedReduction(metric, 8400, 6300), '2.10s');
  assert.equal(formatDisplayedReduction(METRICS.find(item => item.key === 'tbt'), 433.7, 325.275), '109ms');
  assert.equal(formatDisplayedReduction(METRICS.find(item => item.key === 'cls'), 0.104, 0.078), '0.026');
});
