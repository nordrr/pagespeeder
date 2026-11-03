import { addAverageMarker, averageComparison, averageComparisonRows, confidenceBounds } from "./run-average.mjs";
import { findRunNavigationTarget } from "./run-navigation.mjs";
import { metricOpportunityRows } from "./metric-opportunity.mjs";

// Owns score-history rendering and the connected run-detail pane. Dependencies
// are passed in so the controller shares the app's current state and helpers.
export function createRunsController({
  state, runDetailPanel, runDetailCloseButton, runDetailContent,
  METRICS, SCORING_MODEL_VERSION, closeSvg, iconMarkup,
  buildRenderContext, getRunBackgroundColor, getMetricBackgroundColor, getSummaryBackgroundColor,
  createPaneProgress, metricContribution, formatPointValue,
  attachTooltipHandlers, updateConnectedEdgeShadow,
}) {
  let runDetailReturnFocusElement = null;

  document.addEventListener("keydown", (event) => {
    if (!state.runDetail || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const active = event.target;
    if (!(active instanceof Element) ||
        (!active.closest(".run-score-button, .run-row-close") && active !== runDetailCloseButton)) return;

    const tbody = document.querySelector(".score-history-body");
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll("tr"), (row) => {
      const mobile = row.querySelector('.run-score-button[data-mode="mobile"]');
      const desktop = row.querySelector('.run-score-button[data-mode="desktop"]');
      return { runNumber: Number((mobile || desktop)?.dataset.runNumber), mobile, desktop };
    });
    const target = findRunNavigationTarget(rows, state.runDetail.runNumber, state.runDetail.mode, event.key);
    event.preventDefault();
    if (!target) return;
    target.click();
    target.focus({ preventScroll: true });
    const scroller = target.closest(".score-history-scroll");
    const header = scroller?.querySelector("thead");
    if (scroller) {
      const bounds = target.getBoundingClientRect();
      const visibleTop = Math.max(scroller.getBoundingClientRect().top, header?.getBoundingClientRect().bottom ?? -Infinity);
      const visibleBottom = scroller.getBoundingClientRect().bottom;
      if (bounds.top < visibleTop) scroller.scrollTop -= visibleTop - bounds.top;
      else if (bounds.bottom > visibleBottom) scroller.scrollTop += bounds.bottom - visibleBottom;
    }
  });

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
      isPartial: Boolean((mobile && !desktop) || (!mobile && desktop)),
      pending: false,
    });
  }

  const shouldShowPending =
    (tracker.running || tracker.inFlight || tracker.runErrors.mobile || tracker.runErrors.desktop) &&
    mobileSamples.length === desktopSamples.length &&
    (tracker.phase === "waiting" ||
      tracker.phase === "queued" ||
      tracker.phase === "running" ||
      tracker.phase === "awaiting-google" ||
      tracker.runErrors.mobile || tracker.runErrors.desktop);

  if (shouldShowPending) {
    rows.unshift({
      runNumber: total + 1,
      timestamp: tracker.nextRunAt || Date.now(),
      mobile: null,
      desktop: null,
      isPartial: false,
      pending: true,
    });
  }

  return rows;
}

function getPendingStatus(tracker, rowData, mode) {
  const retrying = tracker.phase === "awaiting-google" && (tracker.activeStrategy === "both" || tracker.activeStrategy === mode);
  if ((rowData.pending || rowData.isPartial) && tracker.runErrors[mode] && !retrying) {
    return { kind: "error", text: "Failed", detail: `${mode}: ${tracker.runErrors[mode]}` };
  }
  if ((!tracker.running && !tracker.inFlight) || (!rowData.pending && !rowData.isPartial)) {
    return null;
  }

  if (tracker.phase === "awaiting-google") {
    if (tracker.activeStrategy === "both" || tracker.activeStrategy === mode) {
      return { kind: "google", text: "Google" };
    }
    return { kind: "queued", text: "Queued" };
  }

  if (tracker.phase === "running" || tracker.phase === "queued" || tracker.phase === "waiting") {
    return { kind: "timer", text: "Waiting" };
  }

  return null;
}

function renderPendingCell(cell, status) {
  cell.className = "score-cell-pending";
  cell.style.backgroundColor = "";
  cell.style.color = "";
  cell.innerHTML = "";

  const wrapper = document.createElement("span");
  wrapper.className = "run-pending";
  if (status.kind === "error") {
    wrapper.classList.add("is-error");
    wrapper.title = status.detail;
    wrapper.setAttribute("aria-label", status.detail);
  }

  if (status.kind === "google") {
    const spinner = document.createElement("span");
    spinner.className = "run-spinner";
    wrapper.append(spinner);
  } else if (status.kind !== "error") {
    const hourglass = document.createElement("span");
    hourglass.className = "run-hourglass";
    hourglass.textContent = "⏳";
    wrapper.append(hourglass);
  }

  const text = document.createElement("span");
  text.className = "run-pending-text";
  text.textContent = status.text;
  wrapper.append(text);
  cell.append(wrapper);
}

function renderScoreCell(cell, sample, mode, renderContext, tracker, rowData) {
  cell.style.cursor = "";

  if (!sample) {
    const status = getPendingStatus(tracker, rowData, mode);
    if (status) {
      renderPendingCell(cell, status);
      return;
    }

    cell.className = "score-cell-empty";
    cell.style.backgroundColor = "";
    cell.style.color = "";
    cell.textContent = "--";
    return;
  }

  const score = sample.performanceScore;
  const summary = renderContext.summariesByUrl.get(tracker.url)?.[mode];
  const average = summary?.avgScore;
  const bounds = confidenceBounds(average, summary?.ci95HalfWidth);
  const color = getRunBackgroundColor(mode, score, renderContext, "bar");
  cell.className = mode === "mobile" ? "score-cell-mobile" : "score-cell-desktop";
  cell.style.backgroundColor = "";
  cell.style.color = "";
  cell.innerHTML = "";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "run-score-button";
  button.dataset.runNumber = rowData.runNumber;
  button.dataset.mode = mode;
  const selected = state.runDetail?.url === tracker.url && state.runDetail.runNumber === rowData.runNumber && state.runDetail.mode === mode;
  button.setAttribute("aria-pressed", String(selected));
  const pill = document.createElement("span");
  pill.className = "run-score-pill";
  const number = document.createElement("span");
  number.className = "run-score-number";
  number.textContent = score.toFixed(0);
  const progress = createPaneProgress(score, color);
  addAverageMarker(progress, average, bounds, getSummaryBackgroundColor(mode, average, renderContext, "bar"));
  pill.append(progress, number);
  button.append(pill);
  button.setAttribute(
    "aria-label",
    `Open run ${rowData.runNumber} ${mode} score ${score.toFixed(0)} details. ${averageComparison(score, average, "points", bounds)}`,
  );
  button.dataset.tooltip = averageComparison(score, average, "points", bounds);
  button.dataset.tooltipRows = JSON.stringify(averageComparisonRows(score, average, "points", bounds));
  attachTooltipHandlers(button);
  button.addEventListener("click", () => {
    openRunDetailPanel(tracker, mode, sample, rowData.runNumber, button);
  });

  cell.append(button);
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
    const close = document.createElement("button");
    close.type = "button";
    close.className = "run-row-close secondary";
    close.innerHTML = iconMarkup(closeSvg);
    close.setAttribute("aria-label", `Close run ${rowData.runNumber} details`);
    close.title = "Close run details";
    close.hidden = !(state.runDetail?.url === tracker.url && state.runDetail.runNumber === rowData.runNumber);
    close.addEventListener("click", closeRunDetailPanel);
    const runLabel = document.createElement("span");
    runLabel.textContent = rowData.pending ? `#${rowData.runNumber} next` : `#${rowData.runNumber}`;
    runCell.append(close, runLabel);
    row.append(runCell);

    const mobileCell = document.createElement("td");
    renderScoreCell(mobileCell, rowData.mobile, "mobile", renderContext, tracker, rowData);
    row.append(mobileCell);

    const desktopCell = document.createElement("td");
    renderScoreCell(desktopCell, rowData.desktop, "desktop", renderContext, tracker, rowData);
    row.append(desktopCell);

    tbody.append(row);
  }
}

function closeRunDetailPanel({ restoreFocus = true } = {}) {
  const returnFocus = restoreFocus ? runDetailReturnFocusElement : null;
  runDetailReturnFocusElement = null;
  state.runDetail = null;
  renderRunDetailPanel();
  document.querySelector("main").scrollTo({ left: 0, behavior: "instant" });
  document.querySelectorAll('.run-score-button[aria-pressed="true"]').forEach((button) => button.setAttribute("aria-pressed", "false"));
  syncRunRowCloseButtons();
  positionRunSelection();
  requestAnimationFrame(() => {
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
      returnFocus.focus({ preventScroll: true });
    }
  });
}

function openRunDetailPanel(tracker, mode, sample, runNumber, returnFocus = null) {
  const wasOpen = Boolean(state.runDetail);
  const main = document.querySelector("main");
  runDetailReturnFocusElement = returnFocus instanceof HTMLElement
    ? returnFocus
    : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  state.runDetail = {
    url: tracker.url,
    label: tracker.label || "",
    mode,
    sample,
    runNumber,
  };
  renderRunDetailPanel();
  if (!wasOpen && window.matchMedia("(min-width: 901px)").matches) {
    const openedDetail = state.runDetail;
    let settled = false;
    const revealRunPane = () => {
      if (settled) return;
      settled = true;
      main.removeEventListener("transitionend", onTransitionEnd);
      if (state.runDetail !== openedDetail) return;
      const slot = document.getElementById("run-detail-slot");
      const target = Math.max(0, slot.offsetLeft + slot.offsetWidth - main.clientWidth);
      if (target > main.scrollLeft) main.scrollTo({ left: target, behavior: document.body.classList.contains("keyboard-input") || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    };
    const onTransitionEnd = (event) => {
      if (event.target === main && event.propertyName === "grid-template-columns") revealRunPane();
    };
    main.addEventListener("transitionend", onTransitionEnd);
    setTimeout(revealRunPane, 320);
  }
  document.querySelectorAll('.run-score-button[aria-pressed="true"]').forEach((button) => button.setAttribute("aria-pressed", "false"));
  returnFocus?.setAttribute("aria-pressed", "true");
  syncRunRowCloseButtons();
  positionRunSelection();
  requestAnimationFrame(() => {
    if (!wasOpen) {
      runDetailCloseButton?.focus({ preventScroll: true });
      if (window.matchMedia("(max-width: 900px)").matches) {
        runDetailPanel?.scrollIntoView({ block: "nearest", behavior: "instant" });
      }
    }
  });
}

function syncRunRowCloseButtons() {
  document.querySelectorAll(".score-history-body tr").forEach((row) => {
    const close = row.querySelector(".run-row-close");
    if (close) close.hidden = !row.querySelector('.run-score-button[aria-pressed="true"]');
  });
}

function renderRunDetailPanel(renderContext = null) {
  if (!runDetailPanel || !runDetailContent) {
    return;
  }

  if (!state.runDetail) {
    document.body.classList.remove("run-detail-open");
    document.querySelector(".site-library").inert = document.body.classList.contains("comparison-active");
    runDetailPanel.setAttribute("aria-hidden", "true");
    runDetailPanel.inert = true;
    return;
  }

  document.body.classList.add("run-detail-open");
  document.querySelector(".site-library").inert = false;
  runDetailPanel.setAttribute("aria-hidden", "false");
  runDetailPanel.inert = false;
  runDetailContent.innerHTML = "";

  const detail = state.runDetail;

  const title = document.createElement("h3");
  title.className = "run-detail-title";
  title.textContent = detail.label || "Unlabeled URL";
  runDetailContent.append(title);

  const urlLine = document.createElement("p");
  urlLine.className = "run-detail-url";
  urlLine.textContent = detail.url;
  runDetailContent.append(urlLine);

  const runScore = detail.sample.performanceScore;
  const colorContext = renderContext || buildRenderContext();
  const runScoreColor = getRunBackgroundColor(detail.mode, runScore, colorContext, "bar");
  const summary = colorContext.summariesByUrl.get(detail.url)?.[detail.mode];

  const legend = document.createElement("p");
  legend.className = "run-average-legend";
  legend.innerHTML = '<span class="run-average-legend-mark" aria-hidden="true"></span> Site average and 95% range';
  runDetailContent.append(legend);

  const metaGrid = document.createElement("dl");
  metaGrid.className = "run-detail-meta-grid";
  const metaItems = [
    ["Run", `#${detail.runNumber}`],
    ["Mode", detail.mode],
    ["Time", new Date(detail.sample.timestamp).toLocaleString()],
    ["Performance", runScore.toFixed(1)],
  ];
  for (const [label, value] of metaItems) {
    const item = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (label === "Performance") {
      dd.className = "run-detail-score";
    }
    item.append(dt, dd);
    if (label === "Performance") {
      const progress = createPaneProgress(runScore, runScoreColor);
      const bounds = confidenceBounds(summary?.avgScore, summary?.ci95HalfWidth);
      addAverageMarker(progress, summary?.avgScore, bounds, getSummaryBackgroundColor(detail.mode, summary?.avgScore, colorContext, "bar"));
      const comparison = averageComparison(runScore, summary?.avgScore, "points", bounds);
      if (comparison) { item.dataset.tooltip = comparison; item.dataset.tooltipRows = JSON.stringify(averageComparisonRows(runScore, summary?.avgScore, "points", bounds)); item.setAttribute("aria-label", `Performance ${value}. ${comparison}`); attachTooltipHandlers(item); }
      item.append(progress);
    }
    metaGrid.append(item);
  }
  runDetailContent.append(metaGrid);

  const metricTable = document.createElement("table");
  metricTable.className = "run-detail-metric-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>Metric</th><th>Value</th><th>LH Score</th><th>Points</th></tr>";
  metricTable.append(head);
  const body = document.createElement("tbody");

  for (const metric of METRICS) {
    const metricData = detail.sample.metrics[metric.key];
    const metricAverage = summary?.metrics?.[metric.key];
    const averageColor = getMetricBackgroundColor(detail.mode, metric.key, metricAverage?.avgValue, colorContext, "bar");
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = metric.label;
    row.append(nameCell);

    const valueCell = document.createElement("td");
    valueCell.textContent = metricData ? metric.format(metricData.value) : "--";
    valueCell.className = "run-detail-num";
    row.append(valueCell);

    const scoreCell = document.createElement("td");
    if (metricData && Number.isFinite(metricData.score)) {
      const scoreValue = Math.max(0, Math.min(100, metricData.score));
      scoreCell.textContent = scoreValue.toFixed(0);
      const progress = createPaneProgress(scoreValue, getMetricBackgroundColor(detail.mode, metric.key, metricData.value, colorContext, "bar"));
      const bounds = confidenceBounds(metricAverage?.avgScore, metricAverage?.ci95Score);
      addAverageMarker(progress, metricAverage?.avgScore, bounds, averageColor);
      const comparison = averageComparison(scoreValue, metricAverage?.avgScore, "points", bounds);
      if (comparison) { scoreCell.dataset.tooltip = comparison; scoreCell.dataset.tooltipRows = JSON.stringify(averageComparisonRows(scoreValue, metricAverage?.avgScore, "points", bounds)); scoreCell.setAttribute("aria-label", `${metric.label} Lighthouse score ${scoreValue.toFixed(0)}. ${comparison}`); attachTooltipHandlers(scoreCell); }
      scoreCell.prepend(progress);
    } else {
      scoreCell.textContent = "--";
    }
    scoreCell.className = "run-detail-num";
    row.append(scoreCell);

    const pointsCell = document.createElement("td");
    if (metricData) {
      const contribution = metricContribution(detail.mode, metric.key, metricData.value);
      if (contribution) {
        pointsCell.textContent = `${formatPointValue(contribution.points)} / ${formatPointValue(contribution.maxPoints)}`;
        const percent = (contribution.points / contribution.maxPoints) * 100;
        const progress = createPaneProgress(percent, getMetricBackgroundColor(detail.mode, metric.key, metricData.value, colorContext, "bar"));
        const averageContribution = metricContribution(detail.mode, metric.key, metricAverage?.avgValue);
        let pointBounds = null;
        if (averageContribution && Number.isFinite(metricAverage?.ci95Value)) {
          const low = metricContribution(detail.mode, metric.key, metricAverage.avgValue + metricAverage.ci95Value);
          const high = metricContribution(detail.mode, metric.key, Math.max(0, metricAverage.avgValue - metricAverage.ci95Value));
          if (low && high) pointBounds = { low: low.points, high: high.points };
        }
        if (averageContribution) addAverageMarker(progress, averageContribution.score, pointBounds && {
          low: pointBounds.low / averageContribution.maxPoints * 100,
          high: pointBounds.high / averageContribution.maxPoints * 100,
        }, averageColor);
        pointsCell.prepend(progress);
        const comparison = averageComparison(contribution.points, averageContribution?.points, "points", pointBounds);
        pointsCell.dataset.tooltip = `Weighted points use Google's Lighthouse ${SCORING_MODEL_VERSION} scoring; estimates assume other metrics stay the same.`;
        pointsCell.dataset.tooltipIntro = comparison
          ? `Lighthouse ${SCORING_MODEL_VERSION} estimates hold other metrics constant; site averages use the average measured value.`
          : pointsCell.dataset.tooltip;
        const tooltipRows = [["This run", `${formatPointValue(contribution.points)} / ${formatPointValue(contribution.maxPoints)} points`]];
        if (comparison) {
          tooltipRows.push(...averageComparisonRows(contribution.points, averageContribution?.points, "points", pointBounds).map(([label, value]) => [label === "This run" ? "Difference" : label, value]));
        }
        tooltipRows.push(...metricOpportunityRows(metric, detail.mode, metricData.value));
        pointsCell.dataset.tooltipRows = JSON.stringify(tooltipRows);
        if (comparison) pointsCell.setAttribute("aria-label", `${metric.label} ${formatPointValue(contribution.points)} of ${formatPointValue(contribution.maxPoints)} points. ${comparison}, calculated from the average measured value.`);
        attachTooltipHandlers(pointsCell);
      } else {
        pointsCell.textContent = "--";
      }
    } else {
      pointsCell.textContent = "--";
    }
    pointsCell.className = "run-detail-num";
    row.append(pointsCell);

    body.append(row);
  }

  metricTable.append(body);
  const metricWrap = document.createElement("div");
  metricWrap.className = "run-detail-table-wrap";
  metricWrap.append(metricTable);
  runDetailContent.append(metricWrap);
}

function positionRunSelection() {
  const scroller = document.querySelector(".score-history-scroll");
  const selection = scroller?.querySelector(".run-selection");
  const shadow = scroller?.querySelector(".run-selection-shadow");
  const row = scroller?.querySelector('.run-score-button[aria-pressed="true"]')?.closest("tr");
  if (!selection) return;
  if (!row || !state.runDetail) { selection.hidden = true; if (shadow) shadow.hidden = true; return; }
  const rowBounds = row.getBoundingClientRect();
  const scrollBounds = scroller.getBoundingClientRect();
  selection.style.height = `${rowBounds.height}px`;
  selection.style.transform = `translateY(${rowBounds.top - scrollBounds.top + scroller.scrollTop}px)`;
  selection.hidden = false;
  if (shadow) {
    shadow.style.height = selection.style.height;
    shadow.style.transform = selection.style.transform;
    shadow.hidden = false;
  }
  syncRunSeam(selection);
}

function syncRunSeam(selection) {
  if (selection.hidden || !selection.isConnected) return;
  const slot = document.getElementById("score-history-slot");
  const rowBounds = selection.getBoundingClientRect();
  const slotBounds = slot.getBoundingClientRect();
  const detailSlot = document.getElementById("run-detail-slot");
  const detailBounds = detailSlot.getBoundingClientRect();
  const scroller = selection.closest(".score-history-scroll");
  const scrollBounds = scroller.getBoundingClientRect();
  const headerBottom = scroller.querySelector("thead th").getBoundingClientRect().bottom;
  const visibleTop = Math.max(scrollBounds.top, headerBottom);
  const visibleBottom = scrollBounds.bottom;
  const coverTop = Math.max(rowBounds.top - 18, visibleTop);
  const coverBottom = Math.min(rowBounds.bottom + 18, visibleBottom);
  detailSlot.style.setProperty("--run-seam-top", `${coverTop - detailBounds.top}px`);
  detailSlot.style.setProperty("--run-seam-height", `${Math.max(0, coverBottom - coverTop)}px`);
  slot.style.setProperty("--run-clip-top", `${Math.max(0, visibleTop - slotBounds.top)}px`);
  slot.style.setProperty("--run-clip-bottom", `${Math.max(0, slotBounds.bottom - visibleBottom)}px`);
  updateConnectedEdgeShadow(slot, rowBounds.top - slotBounds.top, rowBounds.bottom - slotBounds.top, rowBounds.left - slotBounds.left);
}

function followRunSeam(selection) {
  syncRunSeam(selection);
  if (selection.isConnected && selection.getAnimations().some((animation) => animation.playState === "running")) {
    requestAnimationFrame(() => followRunSeam(selection));
  }
}

  return { renderScoreHistory, closeRunDetailPanel, openRunDetailPanel,
    renderRunDetailPanel, positionRunSelection, followRunSeam };
}
