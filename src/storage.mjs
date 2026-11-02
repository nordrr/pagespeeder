export const STORAGE_KEY = "pagespeed-tracker-state-v1";

export function serializeTracker(tracker) {
  return {
    url: tracker.url,
    label: tracker.label || "",
    running: tracker.running,
    history: tracker.history,
    lastError: tracker.lastError,
    runErrors: tracker.runErrors,
    phase: tracker.phase,
    activeStrategy: tracker.activeStrategy,
    pauseReason: tracker.pauseReason,
    autoPauseArmed: tracker.autoPauseArmed === true,
  };
}

export function persistState({ state, normalizeTrackerOrder, storage, storageKey = STORAGE_KEY, warn = console.warn }) {
  try {
    normalizeTrackerOrder();
    const payload = {
      apiKey: state.apiKey,
      pollIntervalSec: state.pollIntervalSec,
      autoPauseTarget: state.autoPauseTarget,
      themeMode: state.themeMode,
      colorMode: state.colorMode,
      glimmDev: state.glimmDev,
      comparisonBaseUrl: state.comparisonBaseUrl,
      showDetails: state.showDetails,
      trackers: Array.from(state.trackers.values()).map(serializeTracker),
      trackerOrder: state.trackerOrder,
      sort: state.sort,
    };
    storage.setItem(storageKey, JSON.stringify(payload));
  } catch (error) {
    warn("Failed to persist state", error);
  }
}

export function hydrateState({ state, storage, storageKey = STORAGE_KEY, apiKeyInput, autoPauseTargetInput, FIXED_POLL_INTERVAL_SEC, THEME_MODES, SORTABLE_KEYS, STRATEGIES, normalizeUrl, createTracker, normalizeTrackerOrder, hydrateGlimmDevState, warn = console.warn }) {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return;
    }

    if (typeof parsed.apiKey === "string") {
      state.apiKey = parsed.apiKey;
      apiKeyInput.value = parsed.apiKey;
    }
    state.pollIntervalSec = FIXED_POLL_INTERVAL_SEC;
    if ([1, 2, 3, 4, 5, null].includes(parsed.autoPauseTarget)) state.autoPauseTarget = parsed.autoPauseTarget;
    autoPauseTargetInput.value = state.autoPauseTarget === null ? "off" : String(state.autoPauseTarget);

    if (typeof parsed.themeMode === "string" && THEME_MODES.has(parsed.themeMode)) {
      state.themeMode = parsed.themeMode;
    }
    if (parsed.colorMode === "absolute" || parsed.colorMode === "relative") {
      state.colorMode = parsed.colorMode;
    }
    if (parsed.glimmDev && typeof parsed.glimmDev === "object") {
      hydrateGlimmDevState(parsed.glimmDev);
    }
    // Site details are always visible in the selected site's panel.
    state.showDetails = true;

    if (parsed.sort && typeof parsed.sort === "object") {
      const sortKey = typeof parsed.sort.key === "string" ? parsed.sort.key : null;
      const sortDirection = parsed.sort.direction === "asc" || parsed.sort.direction === "desc"
        ? parsed.sort.direction
        : null;
      if (sortKey && sortDirection && SORTABLE_KEYS.has(sortKey)) {
        state.sort.key = sortKey;
        state.sort.direction = sortDirection;
      }
    }

    if (Array.isArray(parsed.trackers)) {
      for (const stored of parsed.trackers) {
        if (!stored || typeof stored.url !== "string") {
          continue;
        }
        const url = normalizeUrl(stored.url);
        if (!url || state.trackers.has(url)) {
          continue;
        }

        const tracker = createTracker(url);
        tracker.label = typeof stored.label === "string" ? stored.label.trim() : "";
        tracker.history = {
          mobile: Array.isArray(stored.history?.mobile) ? stored.history.mobile : [],
          desktop: Array.isArray(stored.history?.desktop) ? stored.history.desktop : [],
        };
        const legacyError = typeof stored.lastError === "string" ? stored.lastError : "";
        const legacyRunError = /^(mobile|desktop):\s*(.*)$/i.exec(legacyError);
        tracker.lastError = legacyRunError ? "" : legacyError;
        for (const strategy of STRATEGIES) {
          tracker.runErrors[strategy] = typeof stored.runErrors?.[strategy] === "string"
            ? stored.runErrors[strategy]
            : legacyRunError?.[1].toLowerCase() === strategy ? legacyRunError[2] : "";
        }
        tracker.running = stored.running === true;
        tracker.phase = typeof stored.phase === "string" ? stored.phase : (tracker.running ? "queued" : "paused");
        if (tracker.phase === "cooldown") {
          tracker.phase = tracker.running ? "waiting" : "paused";
        }
        tracker.activeStrategy =
          typeof stored.activeStrategy === "string" ? stored.activeStrategy : null;
        tracker.pauseReason = /^stat-sig-[1-5]$/.test(stored.pauseReason || "") ? stored.pauseReason : null;
        tracker.autoPauseArmed = stored.autoPauseArmed === true;

        state.trackers.set(url, tracker);
      }
    }

    if (Array.isArray(parsed.trackerOrder)) {
      state.trackerOrder = parsed.trackerOrder
        .map((value) => normalizeUrl(String(value || "").trim()))
        .filter(Boolean);
    }
    normalizeTrackerOrder();
    if (typeof parsed.comparisonBaseUrl === "string") {
      const baseUrl = normalizeUrl(parsed.comparisonBaseUrl);
      state.comparisonBaseUrl = baseUrl && state.trackers.has(baseUrl) ? baseUrl : null;
    }
  } catch (error) {
    warn("Failed to load saved state", error);
  }
}

