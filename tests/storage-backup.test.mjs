import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, persistState, hydrateState } from '../src/storage.mjs';
import { createBackup, validateBackup } from '../src/backup.mjs';
import { METRICS } from '../src/metrics.mjs';

const STRATEGIES = ['mobile', 'desktop'];
const parseUrlSafe = value => { try { return new URL(value); } catch { return null; } };
const normalizeUrl = value => parseUrlSafe(value)?.toString() || '';
const validation = { normalizeUrl, parseUrlSafe, STRATEGIES, METRICS };
const sample = () => ({ timestamp: 123, performanceScore: 80, lighthouseFetchTime: 'date', metrics: Object.fromEntries(METRICS.map(({key}) => [key, {value: 1, score: 90}])) });
const site = (url = 'https://example.com') => ({ url, label: 'Example', history: {mobile: [sample()], desktop: []} });
const tracker = url => ({url, label: '', history: {mobile: [], desktop: []}, runErrors: {mobile: '', desktop: ''}});

function context(raw) {
  const state = { apiKey: '', pollIntervalSec: 60, autoPauseTarget: 2, improvementPercentages: [25, 50], themeMode: 'auto', colorMode: 'absolute', glimmDev: {}, showDetails: true, sort: {key: null, direction: null}, trackers: new Map(), trackerOrder: [], comparisonBaseUrl: null };
  const values = new Map(raw === undefined ? [] : [[STORAGE_KEY, raw]]);
  const storage = {getItem: k => values.get(k), setItem: (k,v) => values.set(k,v)};
  const normalizeTrackerOrder = () => {
    const known = new Set(state.trackers.keys());
    state.trackerOrder = [...state.trackerOrder.filter(url => known.delete(url)), ...known];
  };
  return { state, storage, values, apiKeyInput: {}, autoPauseTargetInput: {}, FIXED_POLL_INTERVAL_SEC: 60, THEME_MODES: new Set(['auto','light','dark']), SORTABLE_KEYS: new Set(['url']), STRATEGIES, normalizeUrl, createTracker: tracker, normalizeTrackerOrder, hydrateGlimmDevState: settings => Object.assign(state.glimmDev, settings) };
}

test('backup preserves ordered histories and conditionally includes the key', () => {
  const state = {comparisonBaseUrl: 'https://example.com/', apiKey: 'secret'};
  const backup = createBackup(state, [site()], false, new Date('2026-01-02T03:04:05Z'));
  assert.equal(backup.exportedAt, '2026-01-02T03:04:05.000Z');
  assert.equal('apiKey' in backup, false);
  assert.equal(createBackup(state, [site()], true).apiKey, 'secret');
  const result = validateBackup({...backup, apiKey: ' secret '}, validation);
  assert.equal(result.sites[0].url, 'https://example.com/');
  assert.equal(result.apiKey, 'secret');
  assert.deepEqual(result.sites[0].history.mobile[0], sample());
});

test('backup rejects normalized duplicate URLs, bad baselines and invalid metrics', () => {
  const good = {format: 'pagespeeder-backup', version: 1, baselineUrl: null, sites: [site()]};
  assert.throws(() => validateBackup({...good, sites: [site(), site('https://example.com/')]}, validation), /duplicate site/);
  assert.throws(() => validateBackup({...good, baselineUrl: 'https://other.example'}, validation), /invalid baseline/);
  const bad = site(); bad.history.mobile[0].metrics.fcp.score = 101;
  assert.throws(() => validateBackup({...good, sites: [bad]}, validation), /invalid run metrics/);
  assert.throws(() => validateBackup({...good, apiKey: '  '}, validation), /invalid API key/);
});

test('storage migrates legacy errors and cooldown while preserving saved running state', () => {
  const saved = { apiKey: 'key', pollIntervalSec: 123, autoPauseTarget: null, themeMode: 'dark', colorMode: 'relative', showDetails: false, sort: {key:'url', direction:'asc'}, trackers: [{url:'https://example.com', label:'  Site  ', history:{mobile:[sample()]}, lastError:'Mobile: failed', running:true, phase:'cooldown', autoPauseArmed:true}, {url:'https://example.com/'}], trackerOrder: ['https://example.com', 'https://missing.test'], comparisonBaseUrl:'https://example.com' };
  const c = context(JSON.stringify(saved)); hydrateState(c);
  const item = c.state.trackers.get('https://example.com/');
  assert.equal(c.state.trackers.size, 1);
  assert.equal(item.label, 'Site'); assert.equal(item.runErrors.mobile, 'failed');
  assert.equal(item.lastError, ''); assert.equal(item.phase, 'waiting'); assert.equal(item.running, true);
  assert.equal(c.state.pollIntervalSec, 60); assert.equal(c.state.showDetails, true);
  assert.equal(c.autoPauseTargetInput.value, 'off'); assert.equal(c.apiKeyInput.value, 'key');
  assert.deepEqual(c.state.trackerOrder, ['https://example.com/']);
  assert.equal(c.state.comparisonBaseUrl, 'https://example.com/');
  persistState(c);
  const written = JSON.parse(c.values.get(STORAGE_KEY));
  assert.equal(written.trackers[0].running, true);
  assert.deepEqual(written.trackers[0].history.mobile, saved.trackers[0].history.mobile);
});

test('storage failures are reported without escaping to callers', () => {
  const errors = [];
  const c = context('{broken'); c.warn = (...args) => errors.push(args);
  hydrateState(c);
  c.storage.setItem = () => { throw new Error('quota'); };
  persistState(c);
  assert.deepEqual(errors.map(e => e[0]), ['Failed to load saved state', 'Failed to persist state']);
});

test('improvement percentages persist and invalid saved values retain defaults', () => {
  const c = context();
  c.state.improvementPercentages = [10, 70];
  persistState(c);
  const restored = context(c.values.get(STORAGE_KEY));
  hydrateState(restored);
  assert.deepEqual(restored.state.improvementPercentages, [10, 70]);
  for (const invalid of [[0, 50], [25, 100], [25, '50'], [25], null]) {
    const bad = context(JSON.stringify({ improvementPercentages: invalid }));
    hydrateState(bad);
    assert.deepEqual(bad.state.improvementPercentages, [25, 50]);
  }
});
