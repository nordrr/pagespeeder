const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const STRATEGIES = ["mobile", "desktop"];

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
};

const setupForm = document.getElementById("setup-form");
const apiKeyInput = document.getElementById("api-key");
const pollIntervalInput = document.getElementById("poll-interval");
const urlInput = document.getElementById("url-input");
const urlCardsContainer = document.getElementById("url-cards");
const urlCardTemplate = document.getElementById("url-card-template");
const comparisonBody = document.getElementById("comparison-body");
const startAllButton = document.getElementById("start-all");
const stopAllButton = document.getElementById("stop-all");
const clearAllButton = document.getElementById("clear-all");

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

  render();
});

stopAllButton.addEventListener("click", () => {
  for (const tracker of state.trackers.values()) {
    stopTracker(tracker);
  }

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
  };
}

function startTracker(tracker, runImmediately = false) {
  tracker.running = true;
  tracker.lastError = "";
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
}

function stopTracker(tracker) {
  tracker.running = false;
  tracker.lastError = "";

  if (tracker.timerId) {
    clearTimeout(tracker.timerId);
    tracker.timerId = null;
  }

  tracker.nextRunAt = null;
}

function removeTracker(url) {
  const tracker = state.trackers.get(url);
  if (!tracker) {
    return;
  }

  stopTracker(tracker);
  state.trackers.delete(url);
  render();
}

function scheduleNext(tracker, delayMs) {
  if (tracker.timerId) {
    clearTimeout(tracker.timerId);
  }

  tracker.nextRunAt = Date.now() + delayMs;
  tracker.timerId = setTimeout(() => {
    tracker.timerId = null;
    runCycle(tracker);
  }, delayMs);
}

async function runCycle(tracker) {
  if (!tracker.running || tracker.inFlight) {
    return;
  }

  if (!state.apiKey) {
    tracker.lastError = "Missing API key.";
    tracker.running = false;
    render();
    return;
  }

  tracker.inFlight = true;
  tracker.lastError = "";
  render();

  for (const strategy of STRATEGIES) {
    try {
      const sample = await fetchPsiSample(tracker.url, strategy, state.apiKey);
      tracker.history[strategy].push(sample);
      tracker.lastError = "";
    } catch (error) {
      tracker.lastError = `${strategy}: ${error.message}`;
    }

    await wait(1200);
  }

  tracker.inFlight = false;

  if (tracker.running) {
    scheduleNext(tracker, state.pollIntervalSec * 1000);
  }

  render();
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
    const errorText = fragment.querySelector(".error-text");

    title.textContent = tracker.url;

    const status = tracker.inFlight ? "Running now" : tracker.running ? "Active" : "Paused";
    meta.textContent = `${status} • Next cycle: ${formatCountdown(tracker.nextRunAt)}`;

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

    errorText.textContent = tracker.lastError;
    urlCardsContainer.append(fragment);
  }
}

function renderComparisonTable() {
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
      });
    }
  }

  const scorePopulation = rowsData
    .filter((rowData) => rowData.summary)
    .map((rowData) => rowData.summary.avgScore);

  const metricPopulations = {};
  for (const metric of METRICS) {
    metricPopulations[metric.key] = rowsData
      .filter((rowData) => rowData.summary)
      .map((rowData) => rowData.summary.metrics[metric.key].avgScore);
  }

  for (const rowData of rowsData) {
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

render();
