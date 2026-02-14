const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const STRATEGIES = ["mobile", "desktop"];
const STORAGE_KEY = "pagespeed-tracker-state-v1";
const SCORING_MODEL_VERSION = "v10";
const LH_V10_CURVES = {
  mobile: {
    fcp: { weight: 0.10, median: 3000, p10: 1800 },
    si: { weight: 0.10, median: 5800, p10: 3387 },
    lcp: { weight: 0.25, median: 4000, p10: 2500 },
    tbt: { weight: 0.30, median: 600, p10: 200 },
    cls: { weight: 0.25, median: 0.25, p10: 0.1 },
  },
  desktop: {
    fcp: { weight: 0.10, median: 1600, p10: 934 },
    si: { weight: 0.10, median: 2300, p10: 1311 },
    lcp: { weight: 0.25, median: 2400, p10: 1200 },
    tbt: { weight: 0.30, median: 350, p10: 150 },
    cls: { weight: 0.25, median: 0.25, p10: 0.1 },
  },
};

const METRICS = [
  {
    key: "fcp",
    auditId: "first-contentful-paint",
    label: "FCP",
    higherIsBetter: false,
    format: (value) => `${(value / 1000).toFixed(2)}s`,
  },
  {
    key: "si",
    auditId: "speed-index",
    label: "SI",
    higherIsBetter: false,
    format: (value) => `${(value / 1000).toFixed(2)}s`,
  },
  {
    key: "lcp",
    auditId: "largest-contentful-paint",
    label: "LCP",
    higherIsBetter: false,
    format: (value) => `${(value / 1000).toFixed(2)}s`,
  },
  {
    key: "tbt",
    auditId: "total-blocking-time",
    label: "TBT",
    higherIsBetter: false,
    format: (value) => `${Math.round(value)}ms`,
  },
  {
    key: "cls",
    auditId: "cumulative-layout-shift",
    label: "CLS",
    higherIsBetter: false,
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

function internalErf(x) {
  const sign = x < 0 ? -1 : 1;
  const absoluteX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absoluteX);
  const y = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));
  return sign * (1 - y * Math.exp(-absoluteX * absoluteX));
}

function derivePodrFromP10(median, p10) {
  const u = Math.log(median);
  const shape = Math.abs(Math.log(p10) - u) / (Math.SQRT2 * 0.9061938024368232);
  const inner = -3 * shape - Math.sqrt(4 + shape * shape);
  return Math.exp(u + (shape / 2) * inner);
}

function quantileAtValue(curve, value) {
  const podr = curve.podr || derivePodrFromP10(curve.median, curve.p10);
  const location = Math.log(curve.median);
  const logRatio = Math.log(podr / curve.median);
  const shape = Math.sqrt(1 - 3 * logRatio - Math.sqrt((logRatio - 3) * (logRatio - 3) - 8)) / 2;
  const standardizedX = (Math.log(value) - location) / (Math.SQRT2 * shape);
  return (1 - internalErf(standardizedX)) / 2;
}

function metricContribution(strategy, metricKey, value) {
  const strategyCurves = LH_V10_CURVES[strategy];
  const curve = strategyCurves?.[metricKey];
  if (!curve || !Number.isFinite(value)) {
    return null;
  }

  const safeValue = Math.max(value, 0.000001);
  const quantile = quantileAtValue(curve, safeValue);
  const score = Math.max(0, Math.min(1, quantile)) * 100;
  const maxPoints = curve.weight * 100;
  return {
    score,
    points: (score / 100) * maxPoints,
    maxPoints,
  };
}

function formatPointValue(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const nearestInt = Math.round(value);
  if (Math.abs(value - nearestInt) < 0.05) {
    return String(nearestInt);
  }
  return value.toFixed(1);
}

function formatContributionText(strategy, metricKey, value) {
  const contribution = metricContribution(strategy, metricKey, value);
  if (!contribution) {
    return "(--/-- pts)";
  }
  return `(${formatPointValue(contribution.points)}/${formatPointValue(contribution.maxPoints)} pts)`;
}

function createMetricValueBlock(metric, value, percentile, strategy) {
  const block = document.createElement("span");
  block.className = "metric-cell";
  block.style.backgroundColor = percentileColor(percentile);

  const valueLine = document.createElement("span");
  valueLine.className = "metric-cell-value";
  valueLine.textContent = metric.format(value);
  block.append(valueLine);

  const pointsLine = document.createElement("span");
  pointsLine.className = "metric-cell-points";
  pointsLine.textContent = formatContributionText(strategy, metric.key, value);
  pointsLine.title = `${SCORING_MODEL_VERSION} metric contribution`;
  block.append(pointsLine);

  return block;
}

function mixColor(from, to, ratio) {
  const t = Math.max(0, Math.min(1, ratio));
  const red = Math.round(from[0] + (to[0] - from[0]) * t);
  const green = Math.round(from[1] + (to[1] - from[1]) * t);
  const blue = Math.round(from[2] + (to[2] - from[2]) * t);
  return `rgb(${red} ${green} ${blue})`;
}

function percentileColor(percentile) {
  if (!Number.isFinite(percentile)) {
    return "";
  }

  const low = [223, 122, 114];
  const mid = [232, 226, 222];
  const high = [99, 188, 147];
  const p = Math.max(0, Math.min(100, percentile));

  if (p <= 50) {
    return mixColor(low, mid, p / 50);
  }
  return mixColor(mid, high, (p - 50) / 50);
}

function getPercentile(population, value, higherIsBetter = true) {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (!Array.isArray(population) || population.length === 0) {
    return 50;
  }

  const raw = percentileRank(population, value);
  return higherIsBetter ? raw : 100 - raw;
}

function scoreCell(text, percentile) {
  const span = document.createElement("span");
  span.className = "cell-colored";
  span.style.backgroundColor = percentileColor(percentile);
  span.textContent = text;
  if (Number.isFinite(percentile)) {
    span.title = `Percentile: ${Math.round(percentile)}`;
  }
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

function buildRenderContext() {
  const summariesByUrl = new Map();
  const scoreSummaryPopulation = [];
  const runScorePopulation = [];
  const metricPopulations = {};

  for (const metric of METRICS) {
    metricPopulations[metric.key] = [];
  }

  for (const tracker of state.trackers.values()) {
    const modeSummaries = {};

    for (const mode of STRATEGIES) {
      const samples = tracker.history[mode];
      const summary = summarize(samples);
      modeSummaries[mode] = summary;

      for (const sample of samples) {
        if (Number.isFinite(sample.performanceScore)) {
          runScorePopulation.push(sample.performanceScore);
        }
      }

      if (!summary) {
        continue;
      }

      scoreSummaryPopulation.push(summary.avgScore);
      for (const metric of METRICS) {
        const value = summary.metrics[metric.key]?.avgValue;
        if (Number.isFinite(value)) {
          metricPopulations[metric.key].push(value);
        }
      }
    }

    summariesByUrl.set(tracker.url, modeSummaries);
  }

  return {
    summariesByUrl,
    scoreSummaryPopulation,
    runScorePopulation,
    metricPopulations,
  };
}

function buildScoreRows(tracker, limit = 200) {
  const mobileSamples = tracker.history.mobile;
  const desktopSamples = tracker.history.desktop;
  const total = Math.max(mobileSamples.length, desktopSamples.length);
  const rows = [];

  for (let index = total - 1; index >= 0 && rows.length < limit; index -= 1) {
    const mobile = mobileSamples[index] || null;
    const desktop = desktopSamples[index] || null;
    const timestamp = Math.max(mobile?.timestamp || 0, desktop?.timestamp || 0);
    rows.push({
      runNumber: index + 1,
      timestamp,
      mobile,
      desktop,
    });
  }

  return rows;
}

function renderScoreCell(cell, sample, mode, renderContext) {
  if (!sample) {
    cell.className = "score-cell-empty";
    cell.style.backgroundColor = "";
    cell.textContent = "--";
    return;
  }

  const score = sample.performanceScore;
  const percentile = getPercentile(renderContext.runScorePopulation, score, true);
  cell.className = mode === "mobile" ? "score-cell-mobile" : "score-cell-desktop";
  cell.style.backgroundColor = percentileColor(percentile);
  cell.textContent = score.toFixed(0);
}

function renderScoreHistory(tbody, tracker, renderContext) {
  tbody.innerHTML = "";
  const rows = buildScoreRows(tracker);
  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.className = "placeholder";
    cell.textContent = "No runs yet.";
    row.append(cell);
    tbody.append(row);
    return;
  }

  for (const rowData of rows) {
    const row = document.createElement("tr");
    const runCell = document.createElement("td");
    runCell.className = "score-history-run";
    runCell.textContent = `#${rowData.runNumber} ${formatTimestamp(rowData.timestamp)}`;
    row.append(runCell);

    const mobileCell = document.createElement("td");
    renderScoreCell(mobileCell, rowData.mobile, "mobile", renderContext);
    row.append(mobileCell);

    const desktopCell = document.createElement("td");
    renderScoreCell(desktopCell, rowData.desktop, "desktop", renderContext);
    row.append(desktopCell);

    tbody.append(row);
  }
}

function renderSummaryTile(tile, summary, renderContext) {
  const scoreNode = tile.querySelector(".tile-score");
  const metaNode = tile.querySelector(".tile-meta");
  tile.style.backgroundColor = "";
  tile.style.borderColor = "";

  if (!summary) {
    scoreNode.textContent = "--";
    metaNode.textContent = "Need runs";
    return;
  }

  const percentile = getPercentile(renderContext.scoreSummaryPopulation, summary.avgScore, true);
  scoreNode.textContent = summary.avgScore.toFixed(1);
  metaNode.textContent = `${formatConfidence(summary.ci95HalfWidth)} • ${summary.samples} runs • ${formatTimestamp(summary.latestTimestamp)}`;
  tile.style.backgroundColor = percentileColor(percentile);
  tile.style.borderColor = "#b8c6d9";
}

function renderMetricSummary(tbody, mobileSummary, desktopSummary, renderContext) {
  tbody.innerHTML = "";

  for (const metric of METRICS) {
    const row = document.createElement("tr");
    const labelCell = document.createElement("td");
    labelCell.textContent = metric.label;
    row.append(labelCell);

    const mobileCell = document.createElement("td");
    const mobileMetric = mobileSummary?.metrics?.[metric.key];
    if (!mobileMetric) {
      mobileCell.textContent = "--";
    } else {
      const percentile = getPercentile(
        renderContext.metricPopulations[metric.key],
        mobileMetric.avgValue,
        metric.higherIsBetter,
      );
      mobileCell.append(createMetricValueBlock(metric, mobileMetric.avgValue, percentile, "mobile"));
    }
    row.append(mobileCell);

    const desktopCell = document.createElement("td");
    const desktopMetric = desktopSummary?.metrics?.[metric.key];
    if (!desktopMetric) {
      desktopCell.textContent = "--";
    } else {
      const percentile = getPercentile(
        renderContext.metricPopulations[metric.key],
        desktopMetric.avgValue,
        metric.higherIsBetter,
      );
      desktopCell.append(createMetricValueBlock(metric, desktopMetric.avgValue, percentile, "desktop"));
    }
    row.append(desktopCell);

    tbody.append(row);
  }
}

function render() {
  const renderContext = buildRenderContext();
  renderCards(renderContext);
  renderComparisonTable(renderContext);
  refreshLiveStatusText();
}

function renderCards(renderContext) {
  const scrollByUrl = new Map();
  for (const existingCard of urlCardsContainer.querySelectorAll(".url-card[data-url]")) {
    const url = existingCard.dataset.url;
    const scroller = existingCard.querySelector(".score-history-scroll");
    if (url && scroller) {
      scrollByUrl.set(url, scroller.scrollTop);
    }
  }

  urlCardsContainer.innerHTML = "";

  if (!state.trackers.size) {
    const empty = document.createElement("p");
    empty.className = "placeholder";
    empty.textContent = "No URLs are being tracked.";
    urlCardsContainer.append(empty);
    return;
  }

  for (const tracker of state.trackers.values()) {
    const card = urlCardTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.url = tracker.url;

    const title = card.querySelector(".url-card-title");
    const meta = card.querySelector(".url-card-meta");
    const toggleButton = card.querySelector(".toggle-run");
    const runNowButton = card.querySelector(".run-now");
    const removeButton = card.querySelector(".remove");
    const scoreHistoryScroll = card.querySelector(".score-history-scroll");
    const scoreHistoryBody = card.querySelector(".score-history-body");
    const metricSummaryBody = card.querySelector(".metric-summary-body");
    const mobileTile = card.querySelector(".summary-tile[data-mode='mobile']");
    const desktopTile = card.querySelector(".summary-tile[data-mode='desktop']");
    const errorText = card.querySelector(".error-text");

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

    const summaries = renderContext.summariesByUrl.get(tracker.url) || {};
    const mobileSummary = summaries.mobile || null;
    const desktopSummary = summaries.desktop || null;
    renderSummaryTile(mobileTile, mobileSummary, renderContext);
    renderSummaryTile(desktopTile, desktopSummary, renderContext);
    renderMetricSummary(metricSummaryBody, mobileSummary, desktopSummary, renderContext);
    renderScoreHistory(scoreHistoryBody, tracker, renderContext);
    errorText.textContent = tracker.lastError;

    urlCardsContainer.append(card);
    if (scoreHistoryScroll && scrollByUrl.has(tracker.url)) {
      scoreHistoryScroll.scrollTop = scrollByUrl.get(tracker.url);
    }
  }
}

function renderComparisonTable(renderContext) {
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
        summary: renderContext.summariesByUrl.get(tracker.url)?.[mode] || null,
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

    const scorePercentile = getPercentile(renderContext.scoreSummaryPopulation, rowData.summary.avgScore, true);
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
      const percentile = getPercentile(
        renderContext.metricPopulations[metric.key],
        metricResult.avgValue,
        metric.higherIsBetter,
      );
      const bubble = createMetricValueBlock(metric, metricResult.avgValue, percentile, rowData.mode);
      metricCell.append(bubble);
      row.append(metricCell);
    }

    comparisonBody.append(row);
  }
}

function refreshLiveStatusText() {
  for (const card of urlCardsContainer.querySelectorAll(".url-card[data-url]")) {
    const url = card.dataset.url;
    const tracker = state.trackers.get(url);
    const meta = card.querySelector(".url-card-meta");
    if (!tracker || !meta) {
      continue;
    }
    meta.textContent = `Status: ${describeTrackerStatus(tracker)}`;
  }
}

setInterval(() => {
  refreshLiveStatusText();
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
