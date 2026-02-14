const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const STRATEGIES = ["mobile", "desktop"];
const STORAGE_KEY = "pagespeed-tracker-state-v1";

const METRICS = [
  {
    key: "fcp",
    auditId: "first-contentful-paint",
    label: "FCP",
    format: (value) => `${(value / 1000).toFixed(2)}s`,
  },
  {
    key: "si",
    auditId: "speed-index",
    label: "SI",
    format: (value) => `${(value / 1000).toFixed(2)}s`,
  },
  {
    key: "lcp",
    auditId: "largest-contentful-paint",
    label: "LCP",
    format: (value) => `${(value / 1000).toFixed(2)}s`,
  },
  {
    key: "tbt",
    auditId: "total-blocking-time",
    label: "TBT",
    format: (value) => `${Math.round(value)}ms`,
  },
  {
    key: "cls",
    auditId: "cumulative-layout-shift",
    label: "CLS",
    format: (value) => value.toFixed(3),
  },
];

const state = {
  apiKey: "",
  pollIntervalSec: 60,
  trackers: new Map(),
  sort: {
    key: null,
    direction: null,
  },
};

const setupForm = document.getElementById("setup-form");
const apiKeyInput = document.getElementById("api-key");
const pollIntervalInput = document.getElementById("poll-interval");
const urlInput = document.getElementById("url-input");
const urlCardsContainer = document.getElementById("url-cards");
const urlCardTemplate = document.getElementById("url-card-template");
const sortableHeaders = Array.from(document.querySelectorAll("#comparison-table th.sortable"));
const comparisonBody = document.getElementById("comparison-body");
const startAllButton = document.getElementById("start-all");
const stopAllButton = document.getElementById("stop-all");
const clearAllButton = document.getElementById("clear-all");
const SORTABLE_KEYS = new Set(["url", "mode", "avgScore", "confidence", "samples", "fcp", "si", "lcp", "tbt", "cls"]);

for (const header of sortableHeaders) {
  header.tabIndex = 0;
  header.addEventListener("click", () => {
    toggleSort(header.dataset.sortKey);
  });
  header.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    toggleSort(header.dataset.sortKey);
  });
}

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!syncConfigFromInputs()) {
    return;
  }

  const cleanedUrl = normalizeUrl(urlInput.value.trim());
  if (!cleanedUrl) {
    window.alert("Please enter a valid URL including protocol (https://...).");
    return;
  }

  if (state.trackers.has(cleanedUrl)) {
    window.alert("This URL is already being tracked.");
    return;
  }

  const tracker = createTracker(cleanedUrl);
  state.trackers.set(cleanedUrl, tracker);
  startTracker(tracker, true);
  persistState();

  urlInput.value = "";
  render();
});

startAllButton.addEventListener("click", () => {
  if (!syncConfigFromInputs()) {
    return;
  }

  for (const tracker of state.trackers.values()) {
    startTracker(tracker);
  }

  persistState();
  render();
});

stopAllButton.addEventListener("click", () => {
  for (const tracker of state.trackers.values()) {
    stopTracker(tracker);
  }

  persistState();
  render();
});

clearAllButton.addEventListener("click", () => {
  if (!window.confirm("Clear all URLs and collected data?")) {
    return;
  }

  for (const tracker of state.trackers.values()) {
    stopTracker(tracker);
  }

  state.trackers.clear();
  persistState();
  render();
});

function syncConfigFromInputs() {
  const key = apiKeyInput.value.trim();
  const interval = Number.parseInt(pollIntervalInput.value, 10);

  if (!key) {
    window.alert("Google API key is required.");
    return false;
  }

  if (!Number.isFinite(interval) || interval < 60) {
    window.alert("Poll interval must be 60 seconds or greater.");
    return false;
  }

  const intervalChanged = state.pollIntervalSec !== interval;
  state.apiKey = key;
  state.pollIntervalSec = interval;

  if (intervalChanged) {
    for (const tracker of state.trackers.values()) {
      if (tracker.running && !tracker.inFlight) {
        scheduleNext(tracker, interval * 1000);
      }
    }
  }

  persistState();
  return true;
}

function createTracker(url) {
  return {
    url,
    running: false,
    inFlight: false,
    timerId: null,
    nextRunAt: null,
    history: {
      mobile: [],
      desktop: [],
    },
    lastError: "",
    phase: "paused",
    activeStrategy: null,
    cooldownUntil: null,
  };
}

function startTracker(tracker, runImmediately = false) {
  tracker.running = true;
  tracker.lastError = "";
  tracker.phase = "queued";
  tracker.activeStrategy = null;
  tracker.cooldownUntil = null;
  if (tracker.timerId) {
    clearTimeout(tracker.timerId);
    tracker.timerId = null;
  }

  if (runImmediately) {
    runCycle(tracker);
    return;
  }

  if (!tracker.timerId && !tracker.inFlight) {
    scheduleNext(tracker, 0);
  }

  persistState();
}

function stopTracker(tracker) {
  tracker.running = false;
  tracker.lastError = "";
  tracker.phase = "paused";
  tracker.activeStrategy = null;
  tracker.cooldownUntil = null;

  if (tracker.timerId) {
    clearTimeout(tracker.timerId);
    tracker.timerId = null;
  }

  tracker.nextRunAt = null;
  persistState();
}

function removeTracker(url) {
  const tracker = state.trackers.get(url);
  if (!tracker) {
    return;
  }

  stopTracker(tracker);
  state.trackers.delete(url);
  persistState();
  render();
}

function scheduleNext(tracker, delayMs) {
  if (tracker.timerId) {
    clearTimeout(tracker.timerId);
  }

  tracker.nextRunAt = Date.now() + delayMs;
  tracker.phase = "waiting";
  tracker.activeStrategy = null;
  tracker.cooldownUntil = null;
  tracker.timerId = setTimeout(() => {
    tracker.timerId = null;
    runCycle(tracker);
  }, delayMs);
  persistState();
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
    render();
    persistState();
    return;
  }

  tracker.inFlight = true;
  tracker.lastError = "";
  tracker.phase = "running";
  tracker.activeStrategy = null;
  tracker.cooldownUntil = null;
  render();
  persistState();

  for (const strategy of STRATEGIES) {
    tracker.phase = "awaiting-google";
    tracker.activeStrategy = strategy;
    tracker.cooldownUntil = null;
    render();
    persistState();

    try {
      const sample = await fetchPsiSample(tracker.url, strategy, state.apiKey);
      tracker.history[strategy].push(sample);
      tracker.lastError = "";
      persistState();
    } catch (error) {
      tracker.lastError = `${strategy}: ${error.message}`;
      persistState();
    }

    tracker.phase = "cooldown";
    tracker.cooldownUntil = Date.now() + 1200;
    tracker.activeStrategy = strategy;
    render();
    persistState();
    await wait(1200);
  }

  tracker.inFlight = false;
  tracker.phase = "waiting";
  tracker.activeStrategy = null;
  tracker.cooldownUntil = null;

  if (tracker.running) {
    scheduleNext(tracker, state.pollIntervalSec * 1000);
  }

  render();
  persistState();
}

async function fetchPsiSample(url, strategy, apiKey) {
  const params = new URLSearchParams({
    url,
    key: apiKey,
    strategy,
    category: "performance",
  });

  const response = await fetch(`${PSI_ENDPOINT}?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  const perfScore = payload?.lighthouseResult?.categories?.performance?.score;
  const audits = payload?.lighthouseResult?.audits;

  if (typeof perfScore !== "number" || !audits) {
    throw new Error("Unexpected API response shape.");
  }

  const metrics = {};

  for (const metric of METRICS) {
    const audit = audits[metric.auditId];
    if (!audit || typeof audit.numericValue !== "number") {
      throw new Error(`Metric ${metric.label} missing from response.`);
    }

    metrics[metric.key] = {
      value: audit.numericValue,
      score: typeof audit.score === "number" ? audit.score * 100 : 0,
    };
  }

  return {
    timestamp: Date.now(),
    performanceScore: perfScore * 100,
    metrics,
  };
}

function summarize(samples) {
  if (!samples.length) {
    return null;
  }

  const scoreValues = samples.map((sample) => sample.performanceScore);
  const metricSummary = {};

  for (const metric of METRICS) {
    const values = samples.map((sample) => sample.metrics[metric.key].value);
    const scores = samples.map((sample) => sample.metrics[metric.key].score);
    metricSummary[metric.key] = {
      avgValue: mean(values),
      avgScore: mean(scores),
    };
  }

  return {
    samples: samples.length,
    avgScore: mean(scoreValues),
    ci95HalfWidth: ci95(scoreValues),
    latestTimestamp: samples[samples.length - 1].timestamp,
    metrics: metricSummary,
  };
}

function mean(values) {
  if (!values.length) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function stdDevSample(values) {
  if (values.length < 2) {
    return 0;
  }

  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function ci95(values) {
  if (values.length < 2) {
    return null;
  }

  const standardDeviation = stdDevSample(values);
  const standardError = standardDeviation / Math.sqrt(values.length);
  return 1.96 * standardError;
}

function normalizeUrl(value) {
  try {
    return new URL(value).toString();
  } catch {
    return "";
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function scoreColor(score) {
  const bounded = Math.max(0, Math.min(100, score));
  const hue = Math.round((bounded / 100) * 120);
  return `hsl(${hue} 65% 80%)`;
}

function scoreCell(text, percentile) {
  const span = document.createElement("span");
  span.className = "cell-colored";
  span.style.backgroundColor = scoreColor(percentile);
  span.textContent = text;
  span.title = `Percentile: ${Math.round(percentile)}`;
  return span;
}

function formatConfidence(ciValue) {
  if (ciValue === null) {
    return "Need 2+ samples";
  }

  return `±${ciValue.toFixed(1)} pts`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "--";
  }

  return new Date(timestamp).toLocaleTimeString();
}

function formatCountdown(timestamp) {
  if (!timestamp) {
    return "--";
  }

  const secondsLeft = Math.max(0, Math.round((timestamp - Date.now()) / 1000));
  return `${secondsLeft}s`;
}

function describeTrackerStatus(tracker) {
  if (!tracker.running) {
    return "Paused";
  }

  if (tracker.phase === "awaiting-google") {
    return `Waiting for Google PageSpeed result (${tracker.activeStrategy})`;
  }

  if (tracker.phase === "cooldown") {
    return `Cooldown between requests: ${formatCountdown(tracker.cooldownUntil)}`;
  }

  if (tracker.phase === "running") {
    return "Cycle started";
  }

  if (tracker.phase === "queued") {
    return "Queued to run";
  }

  if (tracker.nextRunAt) {
    return `Waiting for next run: ${formatCountdown(tracker.nextRunAt)}`;
  }

  return "Waiting";
}

function percentileRank(values, value) {
  if (!values.length) {
    return 0;
  }
  if (values.length === 1) {
    return 100;
  }

  let lower = 0;
  let equal = 0;

  for (const current of values) {
    if (current < value) {
      lower += 1;
    } else if (current === value) {
      equal += 1;
    }
  }

  return ((lower + 0.5 * equal) / values.length) * 100;
}

function toggleSort(key) {
  if (!SORTABLE_KEYS.has(key)) {
    return;
  }

  if (state.sort.key !== key) {
    state.sort.key = key;
    state.sort.direction = "asc";
  } else if (state.sort.direction === "asc") {
    state.sort.direction = "desc";
  } else if (state.sort.direction === "desc") {
    state.sort.key = null;
    state.sort.direction = null;
  } else {
    state.sort.direction = "asc";
  }

  persistState();
  render();
}

function updateSortHeaderIndicators() {
  for (const header of sortableHeaders) {
    header.classList.remove("sort-asc", "sort-desc");
    if (header.dataset.sortKey === state.sort.key) {
      header.classList.add(state.sort.direction === "desc" ? "sort-desc" : "sort-asc");
    }
  }
}

function compareNullableValues(aValue, bValue) {
  const aMissing = aValue === null || aValue === undefined;
  const bMissing = bValue === null || bValue === undefined;
  if (aMissing && bMissing) {
    return 0;
  }
  if (aMissing) {
    return 1;
  }
  if (bMissing) {
    return -1;
  }
  if (typeof aValue === "string" && typeof bValue === "string") {
    return aValue.localeCompare(bValue);
  }
  return aValue - bValue;
}

function sortRows(rowsData) {
  if (!state.sort.key || !state.sort.direction) {
    return rowsData;
  }

  const directionFactor = state.sort.direction === "desc" ? -1 : 1;
  const sorted = [...rowsData];
  sorted.sort((a, b) => {
    const result = compareNullableValues(a.sortValues[state.sort.key], b.sortValues[state.sort.key]);
    return result * directionFactor;
  });
  return sorted;
}

function buildRunEntries(tracker) {
  const entries = [];
  for (const mode of STRATEGIES) {
    for (const sample of tracker.history[mode]) {
      entries.push({
        mode,
        sample,
      });
    }
  }
  entries.sort((a, b) => b.sample.timestamp - a.sample.timestamp);
  return entries.slice(0, 200);
}

function renderRunLog(container, tracker) {
  container.innerHTML = "";
  const entries = buildRunEntries(tracker);

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "run-log-empty";
    empty.textContent = "No runs yet.";
    container.append(empty);
    return;
  }

  for (const entry of entries) {
    const wrapper = document.createElement("article");
    wrapper.className = "run-entry";

    const header = document.createElement("div");
    header.className = "run-entry-header";

    const left = document.createElement("span");
    left.className = "run-entry-mode";
    left.textContent = `${entry.mode} • ${formatTimestamp(entry.sample.timestamp)}`;

    const right = document.createElement("span");
    right.className = "run-entry-score";
    right.textContent = `Score ${entry.sample.performanceScore.toFixed(1)}`;

    header.append(left, right);
    wrapper.append(header);

    const metrics = document.createElement("div");
    metrics.className = "run-entry-metrics";
    metrics.textContent = METRICS.map((metric) => {
      const value = entry.sample.metrics[metric.key]?.value;
      if (typeof value !== "number") {
        return `${metric.label}: --`;
      }
      return `${metric.label}: ${metric.format(value)}`;
    }).join(" • ");

    wrapper.append(metrics);
    container.append(wrapper);
  }
}

function render() {
  renderCards();
  renderComparisonTable();
}

function renderCards() {
  urlCardsContainer.innerHTML = "";

  if (!state.trackers.size) {
    const empty = document.createElement("p");
    empty.className = "placeholder";
    empty.textContent = "No URLs are being tracked.";
    urlCardsContainer.append(empty);
    return;
  }

  for (const tracker of state.trackers.values()) {
    const fragment = urlCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".url-card");
    const title = fragment.querySelector(".url-card-title");
    const meta = fragment.querySelector(".url-card-meta");
    const toggleButton = fragment.querySelector(".toggle-run");
    const runNowButton = fragment.querySelector(".run-now");
    const removeButton = fragment.querySelector(".remove");
    const runLog = fragment.querySelector(".run-log");
    const errorText = fragment.querySelector(".error-text");

    title.textContent = tracker.url;

    meta.textContent = `Status: ${describeTrackerStatus(tracker)}`;

    toggleButton.textContent = tracker.running ? "Pause" : "Resume";
    toggleButton.addEventListener("click", () => {
      if (tracker.running) {
        stopTracker(tracker);
      } else {
        startTracker(tracker, true);
      }
      render();
    });

    runNowButton.disabled = tracker.inFlight;
    runNowButton.addEventListener("click", () => {
      if (!syncConfigFromInputs()) {
        return;
      }
      startTracker(tracker, true);
    });

    removeButton.addEventListener("click", () => removeTracker(tracker.url));

    for (const mode of STRATEGIES) {
      const panel = card.querySelector(`[data-mode='${mode}']`);
      const scoreNode = panel.querySelector(".score");
      const confidenceNode = panel.querySelector(".confidence");
      const samplesNode = panel.querySelector(".samples");
      const lastRunNode = panel.querySelector(".last-run");
      const summary = summarize(tracker.history[mode]);

      if (!summary) {
        scoreNode.textContent = "--";
        confidenceNode.textContent = "--";
        samplesNode.textContent = "0";
        lastRunNode.textContent = "--";
        continue;
      }

      scoreNode.textContent = summary.avgScore.toFixed(1);
      scoreNode.style.backgroundColor = scoreColor(summary.avgScore);
      scoreNode.style.padding = "2px 8px";
      scoreNode.style.borderRadius = "6px";

      confidenceNode.textContent = formatConfidence(summary.ci95HalfWidth);
      samplesNode.textContent = String(summary.samples);
      lastRunNode.textContent = formatTimestamp(summary.latestTimestamp);
    }

    renderRunLog(runLog, tracker);
    errorText.textContent = tracker.lastError;
    urlCardsContainer.append(fragment);
  }
}

function renderComparisonTable() {
  updateSortHeaderIndicators();
  comparisonBody.innerHTML = "";

  if (!state.trackers.size) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 10;
    cell.className = "placeholder";
    cell.textContent = "No URLs yet. Add one above to begin tracking.";
    row.append(cell);
    comparisonBody.append(row);
    return;
  }

  const rowsData = [];
  for (const tracker of state.trackers.values()) {
    for (const mode of STRATEGIES) {
      rowsData.push({
        id: `${tracker.url}|${mode}`,
        url: tracker.url,
        mode,
        summary: summarize(tracker.history[mode]),
        sortValues: {
          url: tracker.url.toLowerCase(),
          mode,
          avgScore: null,
          confidence: null,
          samples: null,
          fcp: null,
          si: null,
          lcp: null,
          tbt: null,
          cls: null,
        },
      });
    }
  }

  for (const rowData of rowsData) {
    if (!rowData.summary) {
      continue;
    }
    rowData.sortValues.avgScore = rowData.summary.avgScore;
    rowData.sortValues.confidence = rowData.summary.ci95HalfWidth;
    rowData.sortValues.samples = rowData.summary.samples;
    for (const metric of METRICS) {
      rowData.sortValues[metric.key] = rowData.summary.metrics[metric.key].avgValue;
    }
  }

  const sortedRows = sortRows(rowsData);

  const scorePopulation = rowsData
    .filter((rowData) => rowData.summary)
    .map((rowData) => rowData.summary.avgScore);

  const metricPopulations = {};
  for (const metric of METRICS) {
    metricPopulations[metric.key] = rowsData
      .filter((rowData) => rowData.summary)
      .map((rowData) => rowData.summary.metrics[metric.key].avgScore);
  }

  for (const rowData of sortedRows) {
    const row = document.createElement("tr");

    const urlCell = document.createElement("td");
    urlCell.textContent = rowData.url;
    row.append(urlCell);

    const modeCell = document.createElement("td");
    modeCell.textContent = rowData.mode;
    row.append(modeCell);

    if (!rowData.summary) {
      for (let i = 0; i < 8; i += 1) {
        const cell = document.createElement("td");
        cell.textContent = "--";
        row.append(cell);
      }
      comparisonBody.append(row);
      continue;
    }

    const scorePercentile = percentileRank(scorePopulation, rowData.summary.avgScore);
    const scoreAvgCell = document.createElement("td");
    scoreAvgCell.append(scoreCell(rowData.summary.avgScore.toFixed(1), scorePercentile));
    row.append(scoreAvgCell);

    const confidenceCell = document.createElement("td");
    confidenceCell.textContent = formatConfidence(rowData.summary.ci95HalfWidth);
    row.append(confidenceCell);

    const samplesCell = document.createElement("td");
    samplesCell.textContent = String(rowData.summary.samples);
    row.append(samplesCell);

    for (const metric of METRICS) {
      const metricCell = document.createElement("td");
      const metricResult = rowData.summary.metrics[metric.key];
      const percentile = percentileRank(metricPopulations[metric.key], metricResult.avgScore);
      const bubble = scoreCell(metric.format(metricResult.avgValue), percentile);
      metricCell.append(bubble);
      row.append(metricCell);
    }

    comparisonBody.append(row);
  }
}

setInterval(() => {
  render();
}, 1000);

function serializeTracker(tracker) {
  return {
    url: tracker.url,
    running: tracker.running,
    history: tracker.history,
    lastError: tracker.lastError,
    phase: tracker.phase,
    activeStrategy: tracker.activeStrategy,
    cooldownUntil: tracker.cooldownUntil,
  };
}

function persistState() {
  try {
    const payload = {
      apiKey: state.apiKey,
      pollIntervalSec: state.pollIntervalSec,
      trackers: Array.from(state.trackers.values()).map(serializeTracker),
      sort: state.sort,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Failed to persist state", error);
  }
}

function hydrateState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

    if (Number.isFinite(parsed.pollIntervalSec) && parsed.pollIntervalSec >= 60) {
      state.pollIntervalSec = parsed.pollIntervalSec;
      pollIntervalInput.value = String(parsed.pollIntervalSec);
    }

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
        tracker.history = {
          mobile: Array.isArray(stored.history?.mobile) ? stored.history.mobile : [],
          desktop: Array.isArray(stored.history?.desktop) ? stored.history.desktop : [],
        };
        tracker.lastError = typeof stored.lastError === "string" ? stored.lastError : "";
        tracker.running = stored.running === true;
        tracker.phase = typeof stored.phase === "string" ? stored.phase : (tracker.running ? "queued" : "paused");
        tracker.activeStrategy =
          typeof stored.activeStrategy === "string" ? stored.activeStrategy : null;
        tracker.cooldownUntil =
          Number.isFinite(stored.cooldownUntil) ? stored.cooldownUntil : null;

        state.trackers.set(url, tracker);
      }
    }
  } catch (error) {
    console.warn("Failed to load saved state", error);
  }
}

hydrateState();
for (const tracker of state.trackers.values()) {
  if (tracker.running) {
    startTracker(tracker);
  }
}

render();
