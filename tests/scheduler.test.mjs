import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrackerScheduler } from '../src/tracking/scheduler.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(t, fetchPsiSample, overrides = {}) {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalNow = Date.now;
  let now = 100000;
  const timers = [];
  globalThis.setTimeout = (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; };
  globalThis.clearTimeout = (timer) => { timer.cancelled = true; };
  Date.now = () => now;
  t.after(() => { globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout; Date.now = originalNow; });
  const state = { apiKey: 'test-key', pollIntervalSec: 60, autoPauseTarget: null, ...overrides };
  const tracker = {
    url: 'https://example.com', running: true, inFlight: false, historyVersion: 0,
    history: { mobile: [], desktop: [] }, runErrors: { mobile: '', desktop: '' },
    phase: 'queued', activeStrategy: null, nextRunAt: null, timerId: null, autoPauseArmed: true,
  };
  let renders = 0, saves = 0;
  const scheduler = createTrackerScheduler({
    state, strategies: ['mobile', 'desktop'], minSamples: 2,
    persistState: () => saves++, render: () => renders++, fetchPsiSample,
    isDuplicateSample: (previous, current) => previous?.id === current.id,
    summarize: (samples) => samples.length ? { samples: samples.length, ci95HalfWidth: 1 } : null,
  });
  return { state, tracker, scheduler, timers, setNow: (value) => { now = value; }, counts: () => [renders, saves] };
}

test('successful parallel cycle stores results and schedules from cycle start', async (t) => {
  const requests = [];
  const pending = { mobile: deferred(), desktop: deferred() };
  const { tracker, scheduler, timers, setNow } = setup(t, (url, strategy, key) => {
    requests.push([url, strategy, key]); return pending[strategy].promise;
  });
  const cycle = scheduler.runCycle(tracker);
  assert.deepEqual(requests, [['https://example.com', 'mobile', 'test-key'], ['https://example.com', 'desktop', 'test-key']]);
  assert.equal(tracker.activeStrategy, 'both');
  pending.mobile.resolve({ id: 'mobile-1' });
  await Promise.resolve();
  assert.equal(tracker.activeStrategy, 'desktop');
  assert.deepEqual(tracker.history.mobile, [{ id: 'mobile-1' }]);
  setNow(110000);
  pending.desktop.resolve({ id: 'desktop-1' });
  await cycle;
  assert.deepEqual(tracker.history.desktop, [{ id: 'desktop-1' }]);
  assert.equal(tracker.inFlight, false);
  assert.equal(tracker.phase, 'waiting');
  assert.equal(tracker.nextRunAt, 160000);
  assert.equal(timers[0].delay, 50000);
});

test('failed strategy records error and next cycle retries the shorter history', async (t) => {
  const calls = [];
  let fail = true;
  const { tracker, scheduler } = setup(t, async (_url, strategy) => {
    calls.push(strategy);
    if (strategy === 'desktop' && fail) throw new Error('quota exceeded');
    return { id: `${strategy}-sample` };
  });
  await scheduler.runCycle(tracker);
  assert.equal(tracker.runErrors.desktop, 'quota exceeded');
  assert.equal(tracker.runErrors.mobile, '');
  assert.equal(tracker.history.mobile.length, 1);
  assert.equal(tracker.history.desktop.length, 0);
  fail = false;
  await scheduler.runCycle(tracker);
  assert.deepEqual(calls, ['mobile', 'desktop', 'desktop']);
  assert.equal(tracker.runErrors.desktop, '');
  assert.equal(tracker.history.desktop.length, 1);
});

test('auto pause stops when both strategies reach the sample and confidence thresholds', async (t) => {
  const { tracker, scheduler, timers } = setup(t, async (_url, strategy) => ({ id: strategy }), { autoPauseTarget: 2 });
  tracker.history.mobile.push({ id: 'old-mobile' });
  tracker.history.desktop.push({ id: 'old-desktop' });
  await scheduler.runCycle(tracker);
  assert.equal(tracker.running, false);
  assert.equal(tracker.phase, 'paused');
  assert.equal(tracker.pauseReason, 'stat-sig-2');
  assert.equal(tracker.autoPauseArmed, false);
  assert.equal(tracker.nextRunAt, null);
  assert.equal(timers.length, 0);
});

test('auto pause does not trigger with too few samples or an unmet confidence threshold', async (t) => {
  const { tracker, scheduler, timers } = setup(t, async (_url, strategy) => ({ id: strategy }), { autoPauseTarget: 0.5 });
  await scheduler.runCycle(tracker);
  assert.equal(tracker.running, true);
  assert.equal(tracker.phase, 'waiting');
  tracker.history.mobile.push({ id: 'extra-mobile' });
  tracker.history.desktop.push({ id: 'extra-desktop' });
  await scheduler.runCycle(tracker);
  assert.equal(tracker.running, true);
  assert.equal(tracker.phase, 'waiting');
  assert.equal(timers.length, 2);
  assert.equal(timers[0].cancelled, true);
});

test('invalidated in-flight successes and errors do not modify cleared history or errors', async (t) => {
  const mobile = deferred(), desktop = deferred();
  const { tracker, scheduler } = setup(t, (_url, strategy) => strategy === 'mobile' ? mobile.promise : desktop.promise);
  const cycle = scheduler.runCycle(tracker);
  tracker.historyVersion++;
  tracker.running = false;
  tracker.runErrors = { mobile: '', desktop: '' };
  mobile.resolve({ id: 'stale' });
  desktop.reject(new Error('stale error'));
  await cycle;
  assert.deepEqual(tracker.history, { mobile: [], desktop: [] });
  assert.deepEqual(tracker.runErrors, { mobile: '', desktop: '' });
  assert.equal(tracker.inFlight, false);
  assert.equal(tracker.phase, 'paused');
  assert.equal(tracker.nextRunAt, null);
});
