// Owns score-history rendering and the connected run-detail pane. Dependencies
// are passed in so the controller shares the app's current state and helpers.
export function createRunsController({
  state, runDetailPanel, runDetailCloseButton, runDetailContent,
  METRICS, SCORING_MODEL_VERSION, closeSvg, iconMarkup,
  buildRenderContext, getRunBackgroundColor, getMetricBackgroundColor,
  createPaneProgress, metricContribution, formatPointValue,
  attachTooltipHandlers, updateConnectedEdgeShadow,
}) {
  let runDetailReturnFocusElement = null;

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
  pill.append(createPaneProgress(score, color), number);
  button.append(pill);
  button.setAttribute(
    "aria-label",
    `Open run ${rowData.runNumber} ${mode} score ${score.toFixed(0)} details`,
  );
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
    if (label === "Performance") item.append(createPaneProgress(runScore, runScoreColor));
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
      scoreCell.prepend(createPaneProgress(scoreValue, getMetricBackgroundColor(detail.mode, metric.key, metricData.value, colorContext, "bar")));
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
        pointsCell.prepend(createPaneProgress(percent, getMetricBackgroundColor(detail.mode, metric.key, metricData.value, colorContext, "bar")));
        pointsCell.dataset.tooltip = `${SCORING_MODEL_VERSION} weighted contribution to the 100-point performance score.`;
        pointsCell.title = pointsCell.dataset.tooltip;
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
