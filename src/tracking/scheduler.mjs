export function createTrackerScheduler({ state, strategies: STRATEGIES, minSamples: MIN_STAT_SIG_SAMPLES, persistState, render, fetchPsiSample, isDuplicateSample, summarize }) {
function scheduleNext(tracker, delayMs) {
  if (tracker.timerId) {
    clearTimeout(tracker.timerId);
  }

  tracker.nextRunAt = Date.now() + delayMs;
  tracker.phase = "waiting";
  tracker.activeStrategy = null;
  tracker.timerId = setTimeout(() => {
    tracker.timerId = null;
    runCycle(tracker);
  }, delayMs);
  persistState();
}

function getStrategiesForCycle(tracker) {
  const mobileCount = tracker.history.mobile.length;
  const desktopCount = tracker.history.desktop.length;

  if (mobileCount > desktopCount) {
    return ["desktop"];
  }

  if (desktopCount > mobileCount) {
    return ["mobile"];
  }

  return [...STRATEGIES];
}

async function runCycle(tracker) {
  if (!tracker.running || tracker.inFlight) {
    return;
  }

  if (!state.apiKey) {
    tracker.lastError = "Missing API key.";
    tracker.running = false;
    tracker.phase = "paused";
    tracker.activeStrategy = null;
    tracker.pauseReason = null;
    render();
    persistState();
    return;
  }

  tracker.inFlight = true;
  tracker.lastError = "";
  tracker.phase = "running";
  tracker.activeStrategy = null;
  const cycleStartedAt = Date.now();
  const historyVersion = tracker.historyVersion;
  render();
  persistState();

  const cycleStrategies = getStrategiesForCycle(tracker);
  const pendingStrategies = new Set(cycleStrategies);
  if (pendingStrategies.size > 0) {
    tracker.phase = "awaiting-google";
    tracker.activeStrategy = pendingStrategies.size > 1 ? "both" : cycleStrategies[0];
    render();
    persistState();
  }

  const strategyRuns = cycleStrategies.map((strategy) => (async () => {
    try {
      const sample = await fetchPsiSample(tracker.url, strategy, state.apiKey);
      if (tracker.historyVersion !== historyVersion) return;
      const previousSample = tracker.history[strategy].at(-1) || null;
      if (!isDuplicateSample(previousSample, sample)) {
        tracker.history[strategy].push(sample);
      }
      tracker.runErrors[strategy] = "";
      persistState();
    } catch (error) {
      if (tracker.historyVersion !== historyVersion) return;
      tracker.runErrors[strategy] = error.message;
      persistState();
    } finally {
      pendingStrategies.delete(strategy);
      if (pendingStrategies.size > 0) {
        const [remainingStrategy] = pendingStrategies;
        tracker.phase = "awaiting-google";
        tracker.activeStrategy = pendingStrategies.size > 1 ? "both" : remainingStrategy;
        render();
        persistState();
      }
    }
  })());

  await Promise.all(strategyRuns);

  tracker.inFlight = false;
  if (tracker.running && shouldAutoPause(tracker)) {
    render();
    persistState();
    return;
  }

  if (tracker.running) {
    tracker.phase = "waiting";
    tracker.activeStrategy = null;
    const targetNextRunAt = cycleStartedAt + state.pollIntervalSec * 1000;
    const delayMs = Math.max(0, targetNextRunAt - Date.now());
    scheduleNext(tracker, delayMs);
  } else {
    tracker.phase = "paused";
    tracker.activeStrategy = null;
    tracker.nextRunAt = null;
  }

  render();
  persistState();
}

function shouldAutoPause(tracker) {
  const threshold = state.autoPauseTarget;
  const mobile = summarize(tracker.history.mobile);
  const desktop = summarize(tracker.history.desktop);
  if (threshold === null || !mobile || !desktop || mobile.samples < MIN_STAT_SIG_SAMPLES || desktop.samples < MIN_STAT_SIG_SAMPLES ||
      !Number.isFinite(mobile.ci95HalfWidth) || !Number.isFinite(desktop.ci95HalfWidth) ||
      mobile.ci95HalfWidth > threshold || desktop.ci95HalfWidth > threshold) {
    return false;
  }

  tracker.running = false;
  tracker.phase = "paused";
  tracker.activeStrategy = null;
  tracker.nextRunAt = null;
  tracker.pauseReason = `stat-sig-${threshold}`;
  tracker.autoPauseArmed = false;
  return true;
}


  return { scheduleNext, runCycle };
}
