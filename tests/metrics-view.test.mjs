import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetricsView } from '../src/views/metrics.mjs';
import { METRICS } from '../src/metrics.mjs';
import { SCORING_MODEL_VERSION, metricContribution } from '../src/lighthouse-scoring.mjs';
import { summarize, getPercentile } from '../src/statistics.mjs';

function setup() {
  const state = { trackers: new Map(), colorMode: 'absolute', comparisonBaseUrl: null, autoPauseTarget: 2 };
  const document = { documentElement: { dataset: { theme: 'light' } } };
  return { state, document, view: createMetricsView({ state, document, METRICS, STRATEGIES: ['mobile', 'desktop'], MIN_STAT_SIG_SAMPLES: 10, SCORING_MODEL_VERSION, metricContribution, getPercentile, summarize, attachTooltipHandlers() {} }) };
}
function sample(performanceScore, value) {
  return { performanceScore, timestamp: 1, metrics: Object.fromEntries(METRICS.map(({ key }) => [key, { value, score: performanceScore }])) };
}

test('builds comparison populations and baseline scales from tracked samples', () => {
  const { state, view } = setup();
  state.trackers.set('base', { url: 'base', history: { mobile: [sample(80, 1000)], desktop: [sample(90, 800)] } });
  state.trackers.set('other', { url: 'other', history: { mobile: [sample(70, 2000)], desktop: [] } });
  state.comparisonBaseUrl = 'base';
  const context = view.buildRenderContext();
  assert.equal(context.baselineUrl, 'base');
  assert.equal(context.summariesByUrl.get('other').mobile.avgScore, 70);
  assert.deepEqual(context.scoreSummaryPopulationByMode.mobile, [80, 70]);
  assert.equal(context.deltaScales.summaryByMode.mobile, 10);
  assert.equal(context.deltaScales.runByMode.mobile, 10);
  assert.ok(context.deltaScales.metricByMode.mobile.fcp > 0);
  assert.equal(context.summariesByUrl.get('other').desktop, null);
});

test('score colors respond to mode, baseline and theme', () => {
  const { state, document, view } = setup();
  assert.equal(view.getSummaryBackgroundColor('mobile', 50, {}, 'bar'), 'rgb(225 100 100)');
  state.colorMode = 'relative';
  const context = { baselineSummariesByMode: { mobile: { avgScore: 80 } }, deltaScales: { summaryByMode: { mobile: 10 } } };
  assert.equal(view.getSummaryBackgroundColor('mobile', 90, context, 'bar'), 'rgb(50 166 124)');
  assert.equal(view.getSummaryBackgroundColor('mobile', 80, context, 'bar'), 'rgb(137 148 162)');
  document.documentElement.dataset.theme = 'dark';
  assert.equal(view.getSummaryBackgroundColor('mobile', 90, context, 'bar'), 'rgb(99 200 161)');
});

test('goal and baseline labels retain edge-case formatting', () => {
  const { state, view } = setup();
  assert.equal(view.formatGoalEstimate(null), '±2 in ? runs');
  assert.equal(view.formatGoalEstimate({ samples: 10, scoreStdDev: 0 }), '±2 reached');
  state.autoPauseTarget = null;
  assert.equal(view.formatGoalEstimate(null), 'Auto-pause off');
  assert.deepEqual(view.baselineDelta(2, 0), { label: '+2.0 pts vs baseline', detail: '+2.0 pts (--%) compared to baseline' });
  assert.equal(view.formatConfidence(null), 'Need 2+ samples');
});
