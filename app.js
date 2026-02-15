const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const STRATEGIES = ["mobile", "desktop"];
const STORAGE_KEY = "pagespeed-tracker-state-v1";
const THEME_MODES = new Set(["auto", "light", "dark"]);
const FIXED_POLL_INTERVAL_SEC = 60;
const SCORING_MODEL_VERSION = "v10";
const TARGET_CI_HALF_WIDTH_POINTS = 2;
const SECONDARY_CI_HALF_WIDTH_POINTS = 1;
const MIN_STAT_SIG_SAMPLES = 10;
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
  pollIntervalSec: FIXED_POLL_INTERVAL_SEC,
  trackers: new Map(),
  trackerOrder: [],
  comparisonBaseUrl: null,
  showDetails: true,
  sort: {
    key: null,
    direction: null,
  },
  runDetail: null,
  themeMode: "auto",
};

const settingsForm = document.getElementById("settings-form");
const addUrlForm = document.getElementById("add-url-form");
const apiKeyInput = document.getElementById("api-key");
const urlInput = document.getElementById("url-input");
const shopifyPbSuggestion = document.getElementById("shopify-pb-suggestion");
const shopifyPbAction = document.getElementById("shopify-pb-action");
const urlCardsContainer = document.getElementById("url-cards");
const urlCardTemplate = document.getElementById("url-card-template");
const sortableHeaders = Array.from(document.querySelectorAll("#comparison-table th.sortable"));
const comparisonBody = document.getElementById("comparison-body");
const startAllButton = document.getElementById("start-all");
const stopAllButton = document.getElementById("stop-all");
const clearAllButton = document.getElementById("clear-all");
const toggleDetailsButton = document.getElementById("toggle-details");
const themeModeSelect = document.getElementById("theme-mode");
const runDetailBackdrop = document.getElementById("run-detail-backdrop");
const runDetailPanel = document.getElementById("run-detail-panel");
const runDetailCloseButton = document.getElementById("run-detail-close");
const runDetailContent = document.getElementById("run-detail-content");
const uiTooltip = document.getElementById("ui-tooltip");
const SORTABLE_KEYS = new Set(["url", "mode", "avgScore", "confidence", "samples", "fcp", "si", "lcp", "tbt", "cls"]);
const TOOLTIP_DELAY_MS = 250;
const TOOLTIP_HIDE_GRACE_MS = 120;
const REMOVE_CONFIRM_LOCKOUT_MS = 1000;
const REMOVE_CONFIRM_ARM_TTL_MS = 10000;
const DRAG_PREVIEW_SCALE = 0.25;
const DRAG_PREVIEW_OFFSET = 10;
const DRAG_PREVIEW_FADE_IN_MS = 90;
const DRAG_PREVIEW_FADE_OUT_MS = 140;
const ICON_BASELINE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 2h2v3.06A7.002 7.002 0 0 1 18.94 11H22v2h-3.06A7.002 7.002 0 0 1 13 18.94V22h-2v-3.06A7.002 7.002 0 0 1 5.06 13H2v-2h3.06A7.002 7.002 0 0 1 11 5.06V2Zm1 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z"/></svg>';

let tooltipAnchor = null;
let tooltipShowTimerId = null;
let tooltipHideTimerId = null;
let headerSyncRafId = null;
let draggedTrackerUrl = null;
let dragPreviewElement = null;
let dragPreviewBaseWidth = 0;
let dragPreviewAnimating = false;
let dragDidDrop = false;
let dragEndCleanupTimerId = null;
let transparentDragImage = null;
let pendingLabelEditUrl = null;
let suppressLabelBlurCommit = false;
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

if (runDetailBackdrop) {
  // Keep mounted so CSS opacity/visibility transitions can animate.
  runDetailBackdrop.hidden = false;
}

function getResolvedTheme(mode) {
  if (mode === "dark") {
    return "dark";
  }
  if (mode === "light") {
    return "light";
  }
  return systemThemeQuery.matches ? "dark" : "light";
}

function applyThemeMode() {
  const mode = THEME_MODES.has(state.themeMode) ? state.themeMode : "auto";
  const resolvedTheme = getResolvedTheme(mode);
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
  if (themeModeSelect && themeModeSelect.value !== mode) {
    themeModeSelect.value = mode;
  }
}

runDetailCloseButton?.addEventListener("click", () => {
  closeRunDetailPanel();
});
runDetailBackdrop?.addEventListener("click", () => {
  closeRunDetailPanel();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.runDetail) {
    closeRunDetailPanel();
  }
});
document.addEventListener("dragover", (event) => {
  updateDragPreviewPosition(event.clientX, event.clientY);
});
window.addEventListener("scroll", () => hideTooltip(), true);
window.addEventListener("resize", () => hideTooltip());
window.addEventListener("resize", () => scheduleHeaderHeightSync());
if (typeof systemThemeQuery.addEventListener === "function") {
  systemThemeQuery.addEventListener("change", () => {
    if (state.themeMode === "auto") {
      applyThemeMode();
      render();
    }
  });
} else if (typeof systemThemeQuery.addListener === "function") {
  systemThemeQuery.addListener(() => {
    if (state.themeMode === "auto") {
      applyThemeMode();
      render();
    }
  });
}
themeModeSelect?.addEventListener("change", () => {
  const requestedMode = themeModeSelect.value;
  if (!THEME_MODES.has(requestedMode)) {
    return;
  }
  state.themeMode = requestedMode;
  applyThemeMode();
  persistState();
  render();
});

document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const removeButton = target.closest(".remove");
  const removeCard = removeButton?.closest(".url-card[data-url]");
  const keepArmedUrl = removeCard?.dataset.url || null;
  if (disarmAllTrackerRemovals(keepArmedUrl)) {
    render();
  }
}, true);

for (const header of sortableHeaders) {
  header.tabIndex = 0;
  header.addEventListener("mousedown", (event) => {
    // Prevent sticky focus on click; focused sticky headers can trigger viewport jumps on rerender.
    event.preventDefault();
  });
  header.addEventListener("click", () => {
    toggleSort(header.dataset.sortKey);
    header.blur();
  });
  header.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    toggleSort(header.dataset.sortKey);
  });
}

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  syncConfigFromInputs();
});

addUrlForm.addEventListener("submit", (event) => {
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

  runWithViewTransition(() => {
    const tracker = createTracker(cleanedUrl);
    state.trackers.set(cleanedUrl, tracker);
    state.trackerOrder.push(cleanedUrl);
    startTracker(tracker, true);
    persistState();

    urlInput.value = "";
    updateShopifyPbSuggestion();
    render();
  });
});

urlInput?.addEventListener("input", () => {
  updateShopifyPbSuggestion();
});

shopifyPbAction?.addEventListener("click", (event) => {
  event.preventDefault();
  const withPb = addShopifyPbParam(urlInput.value.trim());
  if (!withPb) {
    return;
  }
  urlInput.value = withPb;
  updateShopifyPbSuggestion();
  urlInput.focus();
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
  state.trackerOrder = [];
  state.comparisonBaseUrl = null;
  closeRunDetailPanel();
  persistState();
  render();
});

toggleDetailsButton?.addEventListener("click", () => {
  runWithViewTransition(() => {
    state.showDetails = !state.showDetails;
    persistState();
    render();
  });
});

function syncConfigFromInputs() {
  const key = apiKeyInput.value.trim();

  if (!key) {
    window.alert("Google API key is required.");
    return false;
  }

  state.apiKey = key;
  state.pollIntervalSec = FIXED_POLL_INTERVAL_SEC;

  persistState();
  return true;
}

function createTracker(url) {
  return {
    url,
    label: "",
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
    pauseReason: null,
    autoPauseArmed: false,
    removeConfirmArmed: false,
    removeConfirmReadyAt: 0,
    removeConfirmLockTimerId: null,
    removeConfirmExpireTimerId: null,
  };
}

function startTracker(tracker, runImmediately = false) {
  if (tracker.running) {
    return;
  }

  tracker.running = true;
  tracker.pauseReason = null;
  tracker.autoPauseArmed = false;
  tracker.lastError = "";
  if (tracker.timerId) {
    clearTimeout(tracker.timerId);
    tracker.timerId = null;
  }

  if (tracker.inFlight) {
    // A request is already in flight: resuming should only re-enable auto-cycling.
    persistState();
    return;
  }

  tracker.phase = "queued";
  tracker.activeStrategy = null;

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
  tracker.pauseReason = null;
  tracker.lastError = "";

  if (tracker.timerId) {
    clearTimeout(tracker.timerId);
    tracker.timerId = null;
  }

  tracker.nextRunAt = null;
  if (!tracker.inFlight) {
    tracker.phase = "paused";
    tracker.activeStrategy = null;
  }
  persistState();
}

function triggerImmediateCycle(tracker) {
  if (tracker.inFlight) {
    return;
  }

  if (tracker.timerId) {
    clearTimeout(tracker.timerId);
    tracker.timerId = null;
  }
  tracker.nextRunAt = null;
  tracker.lastError = "";

  if (tracker.running) {
    runCycle(tracker);
    persistState();
    render();
    return;
  }

  // Paused case: run a single cycle, then remain paused.
  tracker.running = true;
  tracker.phase = "queued";
  tracker.activeStrategy = null;
  runCycle(tracker);
  stopTracker(tracker);
  render();
}

function removeTracker(url) {
  const tracker = state.trackers.get(url);
  if (!tracker) {
    return;
  }

  runWithViewTransition(() => {
    disarmTrackerRemoval(tracker);
    stopTracker(tracker);
    state.trackers.delete(url);
    state.trackerOrder = state.trackerOrder.filter((entryUrl) => entryUrl !== url);
    if (state.comparisonBaseUrl === url) {
      state.comparisonBaseUrl = null;
    }
    if (state.runDetail?.url === url) {
      closeRunDetailPanel();
    }
    persistState();
    render();
  });
}

function disarmTrackerRemoval(tracker, shouldRender = false) {
  if (!tracker) {
    return;
  }

  if (tracker.removeConfirmLockTimerId) {
    clearTimeout(tracker.removeConfirmLockTimerId);
    tracker.removeConfirmLockTimerId = null;
  }
  if (tracker.removeConfirmExpireTimerId) {
    clearTimeout(tracker.removeConfirmExpireTimerId);
    tracker.removeConfirmExpireTimerId = null;
  }

  tracker.removeConfirmArmed = false;
  tracker.removeConfirmReadyAt = 0;
  if (shouldRender) {
    render();
  }
}

function disarmAllTrackerRemovals(exceptUrl = null) {
  let changed = false;
  for (const tracker of state.trackers.values()) {
    if (exceptUrl && tracker.url === exceptUrl) {
      continue;
    }
    if (!tracker.removeConfirmArmed) {
      continue;
    }
    disarmTrackerRemoval(tracker);
    changed = true;
  }
  return changed;
}

function armTrackerRemoval(tracker) {
  if (!tracker) {
    return;
  }

  disarmAllTrackerRemovals(tracker.url);
  disarmTrackerRemoval(tracker);
  tracker.removeConfirmArmed = true;
  tracker.removeConfirmReadyAt = Date.now() + REMOVE_CONFIRM_LOCKOUT_MS;

  tracker.removeConfirmLockTimerId = setTimeout(() => {
    tracker.removeConfirmLockTimerId = null;
    if (!state.trackers.has(tracker.url) || !tracker.removeConfirmArmed) {
      return;
    }
    render();
  }, REMOVE_CONFIRM_LOCKOUT_MS);

  tracker.removeConfirmExpireTimerId = setTimeout(() => {
    if (!state.trackers.has(tracker.url) || !tracker.removeConfirmArmed) {
      return;
    }
    disarmTrackerRemoval(tracker, true);
  }, REMOVE_CONFIRM_ARM_TTL_MS);
}

function getOrderedTrackerUrls() {
  const known = new Set(state.trackers.keys());
  const ordered = [];

  for (const url of state.trackerOrder) {
    if (!known.has(url)) {
      continue;
    }
    ordered.push(url);
    known.delete(url);
  }

  for (const url of state.trackers.keys()) {
    if (known.has(url)) {
      ordered.push(url);
    }
  }

  return ordered;
}

function normalizeTrackerOrder() {
  state.trackerOrder = getOrderedTrackerUrls();
}

function getOrderedTrackers() {
  normalizeTrackerOrder();
  return state.trackerOrder
    .map((url) => state.trackers.get(url))
    .filter(Boolean);
}

function clearDragCardClasses() {
  for (const card of urlCardsContainer.querySelectorAll(".url-card")) {
    card.classList.remove("drop-target", "is-dragging", "dragging-active");
  }
}

function clearDropTargets() {
  for (const card of urlCardsContainer.querySelectorAll(".url-card.drop-target")) {
    card.classList.remove("drop-target");
  }
}

function getTransparentDragImage() {
  if (transparentDragImage) {
    return transparentDragImage;
  }
  const img = new Image();
  img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  transparentDragImage = img;
  return transparentDragImage;
}

function clearDragPreview() {
  if (dragEndCleanupTimerId) {
    clearTimeout(dragEndCleanupTimerId);
    dragEndCleanupTimerId = null;
  }
  if (dragPreviewElement) {
    dragPreviewElement.remove();
  }
  dragPreviewElement = null;
  dragPreviewBaseWidth = 0;
  dragPreviewAnimating = false;
}

function setGlobalDraggingCursor(isDragging) {
  document.body.classList.toggle("url-dragging", Boolean(isDragging));
}

function updateDragPreviewPosition(clientX, clientY) {
  if (!dragPreviewElement || dragPreviewAnimating) {
    return;
  }
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return;
  }
  const x = clientX + DRAG_PREVIEW_OFFSET;
  const y = clientY + DRAG_PREVIEW_OFFSET;
  dragPreviewElement.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${DRAG_PREVIEW_SCALE})`;
}

function createDragPreview(card, clientX, clientY) {
  clearDragPreview();
  const rect = card.getBoundingClientRect();
  const preview = card.cloneNode(true);
  preview.classList.remove("drop-target", "is-dragging", "dragging-active", "is-editing-label");
  preview.classList.add("drag-preview");
  preview.style.viewTransitionName = "none";
  preview.style.width = `${rect.width}px`;
  preview.style.height = `${rect.height}px`;
  preview.style.transition = "none";
  dragPreviewElement = preview;
  dragPreviewBaseWidth = rect.width;
  document.body.append(preview);
  const startX = Number.isFinite(clientX) ? clientX : rect.left;
  const startY = Number.isFinite(clientY) ? clientY : rect.top;
  updateDragPreviewPosition(startX, startY);
  preview.style.opacity = "0";
  requestAnimationFrame(() => {
    if (!dragPreviewElement) {
      return;
    }
    dragPreviewElement.style.transition = `opacity ${DRAG_PREVIEW_FADE_IN_MS}ms ease-out`;
    dragPreviewElement.style.opacity = "0.92";
  });
}

function fadeOutDragPreview() {
  if (!dragPreviewElement) {
    clearDragPreview();
    return;
  }
  dragPreviewAnimating = true;

  let done = false;
  const finish = () => {
    if (done) {
      return;
    }
    done = true;
    clearDragPreview();
  };

  if (typeof dragPreviewElement.animate === "function") {
    const animation = dragPreviewElement.animate(
      [{ opacity: 0.92 }, { opacity: 0 }],
      { duration: DRAG_PREVIEW_FADE_OUT_MS, easing: "ease-out", fill: "forwards" },
    );
    animation.addEventListener("finish", finish, { once: true });
    animation.addEventListener("cancel", finish, { once: true });
    setTimeout(finish, DRAG_PREVIEW_FADE_OUT_MS + 80);
    return;
  }

  dragPreviewElement.style.transition = `opacity ${DRAG_PREVIEW_FADE_OUT_MS}ms ease-out`;
  dragPreviewElement.style.opacity = "0";
  dragPreviewElement.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, DRAG_PREVIEW_FADE_OUT_MS + 80);
}

function runWithViewTransition(update) {
  if (
    typeof document.startViewTransition === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    document.startViewTransition(() => {
      update();
    });
    return;
  }
  update();
}

function beginLabelEditing(url) {
  if (!url) {
    return false;
  }
  const tracker = state.trackers.get(url);
  if (!tracker) {
    return false;
  }
  const cards = Array.from(urlCardsContainer.querySelectorAll(".url-card[data-url]"));
  const card = cards.find((entry) => entry.dataset.url === url);
  if (!card) {
    return false;
  }

  for (const entry of cards) {
    if (entry !== card) {
      entry.classList.remove("is-editing-label");
    }
  }

  const labelInput = card.querySelector(".url-label-input");
  if (!labelInput) {
    return false;
  }

  card.classList.add("is-editing-label");
  labelInput.value = tracker.label || "";
  labelInput.focus();
  labelInput.select();
  return true;
}

function getActiveLabelEditState() {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) || !active.classList.contains("url-label-input")) {
    return null;
  }

  const card = active.closest(".url-card[data-url]");
  const url = card?.dataset.url;
  if (!url) {
    return null;
  }

  const value = active.value ?? "";
  const fallbackCaret = value.length;
  return {
    url,
    value,
    selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : fallbackCaret,
    selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : fallbackCaret,
  };
}

function restoreLabelEditState(editState) {
  if (!editState?.url) {
    return;
  }

  const cards = Array.from(urlCardsContainer.querySelectorAll(".url-card[data-url]"));
  const card = cards.find((entry) => entry.dataset.url === editState.url);
  const labelInput = card?.querySelector(".url-label-input");
  if (!card || !labelInput) {
    return;
  }

  card.classList.add("is-editing-label");
  labelInput.value = editState.value ?? "";
  labelInput.focus({ preventScroll: true });

  const length = labelInput.value.length;
  const start = Math.max(0, Math.min(length, editState.selectionStart ?? length));
  const end = Math.max(start, Math.min(length, editState.selectionEnd ?? start));
  labelInput.setSelectionRange(start, end);
}

function viewTransitionNameForUrl(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i += 1) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  }
  return `tracker-card-${Math.abs(hash)}`;
}

function reorderTracker(draggedUrl, targetUrl) {
  if (!draggedUrl || !targetUrl || draggedUrl === targetUrl) {
    return;
  }

  const order = getOrderedTrackerUrls();
  const draggedIndex = order.indexOf(draggedUrl);
  const targetIndex = order.indexOf(targetUrl);
  if (draggedIndex === -1 || targetIndex === -1) {
    return;
  }
  [order[draggedIndex], order[targetIndex]] = [order[targetIndex], order[draggedIndex]];

  runWithViewTransition(() => {
    state.trackerOrder = order;
    persistState();
    render();
  });
}

function hideTooltip() {
  if (tooltipShowTimerId) {
    clearTimeout(tooltipShowTimerId);
    tooltipShowTimerId = null;
  }
  if (tooltipHideTimerId) {
    clearTimeout(tooltipHideTimerId);
    tooltipHideTimerId = null;
  }
  if (!uiTooltip) {
    return;
  }
  uiTooltip.classList.remove("visible");
  uiTooltip.hidden = true;
  tooltipAnchor = null;
}

function isTooltipTarget(node) {
  return Boolean(node instanceof Element && node.closest("[data-tooltip]"));
}

function positionTooltip() {
  if (!uiTooltip || !tooltipAnchor) {
    return;
  }
  if (!tooltipAnchor.isConnected) {
    hideTooltip();
    return;
  }

  const rect = tooltipAnchor.getBoundingClientRect();
  const spacing = 8;
  const width = uiTooltip.offsetWidth;
  const height = uiTooltip.offsetHeight;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(6, Math.min(left, viewportWidth - width - 6));

  let top = rect.top - height - spacing;
  if (top < 6) {
    top = rect.bottom + spacing;
  }
  if (top + height > viewportHeight - 6) {
    top = Math.max(6, viewportHeight - height - 6);
  }

  uiTooltip.style.left = `${left}px`;
  uiTooltip.style.top = `${top}px`;
}

function showTooltipNow(text, anchor) {
  if (!uiTooltip || !text || !anchor || !anchor.isConnected) {
    return;
  }
  uiTooltip.textContent = text;
  tooltipAnchor = anchor;
  uiTooltip.hidden = false;
  positionTooltip();
  requestAnimationFrame(() => {
    if (uiTooltip) {
      uiTooltip.classList.add("visible");
    }
  });
}

function showTooltip(text, anchor, instant = false) {
  if (draggedTrackerUrl || dragPreviewElement) {
    hideTooltip();
    return;
  }
  if (!text || !anchor) {
    return;
  }

  if (tooltipHideTimerId) {
    clearTimeout(tooltipHideTimerId);
    tooltipHideTimerId = null;
  }

  const tooltipAlreadyVisible = Boolean(uiTooltip && !uiTooltip.hidden && uiTooltip.classList.contains("visible"));
  if (instant || tooltipAlreadyVisible) {
    if (tooltipShowTimerId) {
      clearTimeout(tooltipShowTimerId);
      tooltipShowTimerId = null;
    }
    showTooltipNow(text, anchor);
    return;
  }

  if (tooltipShowTimerId) {
    clearTimeout(tooltipShowTimerId);
  }
  tooltipShowTimerId = setTimeout(() => {
    tooltipShowTimerId = null;
    showTooltipNow(text, anchor);
  }, TOOLTIP_DELAY_MS);
}

function scheduleTooltipHide() {
  if (tooltipShowTimerId) {
    clearTimeout(tooltipShowTimerId);
    tooltipShowTimerId = null;
  }
  if (tooltipHideTimerId) {
    clearTimeout(tooltipHideTimerId);
  }
  tooltipHideTimerId = setTimeout(() => {
    tooltipHideTimerId = null;
    hideTooltip();
  }, TOOLTIP_HIDE_GRACE_MS);
}

function attachTooltipHandlers(element) {
  if (!element) {
    return;
  }

  const getText = () => element.dataset.tooltip || "";
  element.addEventListener("mouseenter", () => {
    showTooltip(getText(), element, false);
  });
  element.addEventListener("mouseleave", (event) => {
    if (isTooltipTarget(event.relatedTarget)) {
      return;
    }
    scheduleTooltipHide();
  });
  element.addEventListener("focus", () => {
    showTooltip(getText(), element, true);
  });
  element.addEventListener("blur", () => {
    scheduleTooltipHide();
  });
}

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
      const previousSample = tracker.history[strategy].at(-1) || null;
      if (!isDuplicateSample(previousSample, sample)) {
        tracker.history[strategy].push(sample);
      }
      tracker.lastError = "";
      persistState();
    } catch (error) {
      tracker.lastError = `${strategy}: ${error.message}`;
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
  if (tracker.running && shouldAutoPauseAtOnePoint(tracker)) {
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

function shouldAutoPauseAtOnePoint(tracker) {
  const threshold = SECONDARY_CI_HALF_WIDTH_POINTS;
  const mobileCi = summarize(tracker.history.mobile)?.ci95HalfWidth;
  const desktopCi = summarize(tracker.history.desktop)?.ci95HalfWidth;

  const hasAboveThreshold =
    (Number.isFinite(mobileCi) && mobileCi > threshold) ||
    (Number.isFinite(desktopCi) && desktopCi > threshold);
  if (hasAboveThreshold) {
    tracker.autoPauseArmed = true;
  }

  const bothWithinThreshold =
    Number.isFinite(mobileCi) &&
    Number.isFinite(desktopCi) &&
    mobileCi <= threshold &&
    desktopCi <= threshold;

  if (!tracker.autoPauseArmed || !bothWithinThreshold) {
    return false;
  }

  tracker.running = false;
  tracker.phase = "paused";
  tracker.activeStrategy = null;
  tracker.nextRunAt = null;
  tracker.pauseReason = "stat-sig-1";
  tracker.autoPauseArmed = false;
  return true;
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
  const lighthouseFetchTime = payload?.lighthouseResult?.fetchTime;

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
    lighthouseFetchTime: typeof lighthouseFetchTime === "string" ? lighthouseFetchTime : null,
    performanceScore: perfScore * 100,
    metrics,
  };
}

function sampleFingerprint(sample) {
  if (!sample || !sample.metrics || !Number.isFinite(sample.performanceScore)) {
    return "";
  }

  const parts = [String(sample.performanceScore)];
  for (const metric of METRICS) {
    const metricData = sample.metrics[metric.key];
    if (!metricData) {
      return "";
    }
    parts.push(String(metricData.value));
    parts.push(String(metricData.score));
  }
  return parts.join("|");
}

function isDuplicateSample(previousSample, nextSample) {
  if (!previousSample || !nextSample) {
    return false;
  }

  if (
    previousSample.lighthouseFetchTime &&
    nextSample.lighthouseFetchTime &&
    previousSample.lighthouseFetchTime === nextSample.lighthouseFetchTime
  ) {
    return true;
  }

  return sampleFingerprint(previousSample) === sampleFingerprint(nextSample);
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
    scoreStdDev: stdDevSample(scoreValues),
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

function parseUrlSafe(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isShopifyPreviewHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "shopifypreview.com" || host.endsWith(".shopifypreview.com");
}

function addShopifyPbParam(urlValue) {
  const url = parseUrlSafe(urlValue);
  if (!url || !isShopifyPreviewHost(url.hostname)) {
    return "";
  }
  url.searchParams.set("pb", "0");
  return url.toString();
}

function shouldSuggestShopifyPb(urlValue) {
  const url = parseUrlSafe(urlValue);
  if (!url || !isShopifyPreviewHost(url.hostname)) {
    return false;
  }
  return url.searchParams.get("pb") !== "0";
}

function updateShopifyPbSuggestion() {
  if (!shopifyPbSuggestion || !urlInput) {
    return;
  }
  const shouldShow = shouldSuggestShopifyPb(urlInput.value.trim());
  shopifyPbSuggestion.hidden = !shouldShow;
}

function normalizeUrl(value) {
  return parseUrlSafe(value)?.toString() || "";
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

function formatSignedNumber(value, fractionDigits = 1) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  const fixed = normalized.toFixed(fractionDigits);
  return normalized > 0 ? `+${fixed}` : fixed;
}

function formatDeltaPointsAndPercent(deltaPoints, baselinePoints) {
  if (!Number.isFinite(deltaPoints)) {
    return "";
  }
  const pointsLabel = `${formatSignedNumber(deltaPoints, 1)} pts`;
  if (!Number.isFinite(baselinePoints) || Math.abs(baselinePoints) < 0.000001) {
    return `${pointsLabel} (--%)`;
  }
  const deltaPercent = (deltaPoints / baselinePoints) * 100;
  return `${pointsLabel} (${formatSignedNumber(deltaPercent, 1)}%)`;
}

function contributionPointsForDisplay(strategy, metricKey, value) {
  const contribution = metricContribution(strategy, metricKey, value);
  if (!contribution) {
    return null;
  }
  const formatted = formatPointValue(contribution.points);
  const parsed = Number.parseFloat(formatted);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatContributionText(strategy, metricKey, value) {
  const contribution = metricContribution(strategy, metricKey, value);
  if (!contribution) {
    return { points: "--", outOf: "/--" };
  }
  return {
    points: formatPointValue(contribution.points),
    outOf: `/${formatPointValue(contribution.maxPoints)}`,
  };
}

function createMetricValueBlock(
  metric,
  value,
  percentile,
  strategy,
  withBackground = true,
  explicitTextColor = null,
  deltaText = "",
) {
  const block = document.createElement("span");
  block.className = "metric-cell";
  if (withBackground) {
    const background = percentileColor(percentile);
    block.style.backgroundColor = background;
    block.style.color = textColorForBackground(background);
  } else {
    block.classList.add("metric-cell-no-bg");
    if (explicitTextColor) {
      block.style.color = explicitTextColor;
    }
  }

  const contribution = formatContributionText(strategy, metric.key, value);

  const pointsLine = document.createElement("span");
  pointsLine.className = "metric-points-line";

  const pointsBig = document.createElement("span");
  pointsBig.className = "metric-points-big";
  pointsBig.textContent = contribution.points;
  pointsBig.title = `${SCORING_MODEL_VERSION} metric contribution`;

  const pointsSmall = document.createElement("span");
  pointsSmall.className = "metric-points-small";
  pointsSmall.textContent = contribution.outOf;

  pointsLine.append(pointsBig, pointsSmall);
  block.append(pointsLine);

  const valueLine = document.createElement("span");
  valueLine.className = "metric-raw-value";
  valueLine.textContent = metric.format(value);
  block.append(valueLine);

  if (deltaText) {
    const deltaLine = document.createElement("span");
    deltaLine.className = "metric-delta-value";
    deltaLine.textContent = deltaText;
    block.append(deltaLine);
  }

  return block;
}

function mixColor(from, to, ratio) {
  const t = Math.max(0, Math.min(1, ratio));
  const red = Math.round(from[0] + (to[0] - from[0]) * t);
  const green = Math.round(from[1] + (to[1] - from[1]) * t);
  const blue = Math.round(from[2] + (to[2] - from[2]) * t);
  return `rgb(${red} ${green} ${blue})`;
}

function parseColorToRgbArray(color) {
  if (!color || typeof color !== "string") {
    return null;
  }

  const trimmed = color.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const r = Number.parseInt(hex[0] + hex[0], 16);
      const g = Number.parseInt(hex[1] + hex[1], 16);
      const b = Number.parseInt(hex[2] + hex[2], 16);
      if ([r, g, b].every(Number.isFinite)) {
        return [r, g, b];
      }
      return null;
    }
    if (hex.length === 6) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      if ([r, g, b].every(Number.isFinite)) {
        return [r, g, b];
      }
      return null;
    }
    return null;
  }

  if (trimmed.startsWith("rgb")) {
    const components = trimmed.match(/[\d.]+/g);
    if (!components || components.length < 3) {
      return null;
    }
    const r = Number.parseFloat(components[0]);
    const g = Number.parseFloat(components[1]);
    const b = Number.parseFloat(components[2]);
    if ([r, g, b].every(Number.isFinite)) {
      return [Math.round(r), Math.round(g), Math.round(b)];
    }
  }

  return null;
}

function getPercentilePalette() {
  const isDark = document.documentElement.dataset.theme === "dark";
  const themeBgRaw = getComputedStyle(document.documentElement).getPropertyValue("--bg");
  const themeBg = parseColorToRgbArray(themeBgRaw);

  if (isDark) {
    return {
      low: [186, 86, 86],
      mid: themeBg || [11, 18, 32],
      high: [79, 165, 126],
    };
  }
  return {
    low: [223, 122, 114],
    mid: themeBg || [242, 244, 248],
    high: [99, 188, 147],
  };
}

function percentileColor(percentile) {
  if (!Number.isFinite(percentile)) {
    return "";
  }

  const { low, mid, high } = getPercentilePalette();
  const p = Math.max(0, Math.min(100, percentile));

  if (p <= 50) {
    return mixColor(low, mid, p / 50);
  }
  return mixColor(mid, high, (p - 50) / 50);
}

function relativeDeltaColor(delta, maxAbsDelta) {
  if (!Number.isFinite(delta)) {
    return "";
  }
  const { low, mid, high } = getPercentilePalette();
  if (!Number.isFinite(maxAbsDelta) || maxAbsDelta <= 0) {
    return mixColor(mid, mid, 0);
  }
  const ratio = Math.max(-1, Math.min(1, delta / maxAbsDelta));
  if (ratio >= 0) {
    return mixColor(mid, high, ratio);
  }
  return mixColor(mid, low, Math.abs(ratio));
}

function getSummaryBackgroundColor(mode, avgScore, renderContext) {
  const baselineSummary = renderContext.baselineSummariesByMode?.[mode] || null;
  if (baselineSummary && Number.isFinite(avgScore) && Number.isFinite(baselineSummary.avgScore)) {
    return relativeDeltaColor(
      avgScore - baselineSummary.avgScore,
      renderContext.deltaScales.summaryByMode?.[mode] || 0,
    );
  }
  const percentile = getPercentile(renderContext.scoreSummaryPopulationByMode[mode], avgScore, true);
  return percentileColor(percentile);
}

function getRunBackgroundColor(mode, score, renderContext) {
  const baselineSummary = renderContext.baselineSummariesByMode?.[mode] || null;
  if (baselineSummary && Number.isFinite(score) && Number.isFinite(baselineSummary.avgScore)) {
    return relativeDeltaColor(
      score - baselineSummary.avgScore,
      renderContext.deltaScales.runByMode?.[mode] || 0,
    );
  }
  const percentile = getPercentile(renderContext.runScorePopulationByMode[mode], score, true);
  return percentileColor(percentile);
}

function getMetricBackgroundColor(mode, metricKey, metricValue, renderContext) {
  const baselineSummary = renderContext.baselineSummariesByMode?.[mode] || null;
  const baselineMetric = baselineSummary?.metrics?.[metricKey] || null;
  if (baselineMetric) {
    const currentContribution = metricContribution(mode, metricKey, metricValue);
    const baselineContribution = metricContribution(mode, metricKey, baselineMetric.avgValue);
    if (currentContribution && baselineContribution) {
      return relativeDeltaColor(
        currentContribution.points - baselineContribution.points,
        renderContext.deltaScales.metricByMode?.[mode]?.[metricKey] || 0,
      );
    }
  }

  const pointsForColor = contributionPointsForDisplay(mode, metricKey, metricValue);
  const percentile = getPercentile(
    renderContext.metricPopulationsByMode[mode][metricKey],
    pointsForColor,
    true,
  );
  return percentileColor(percentile);
}

function parseRgbColor(color) {
  const match = color.match(/rgb\((\d+)\s+(\d+)\s+(\d+)\)/);
  if (!match) {
    return null;
  }
  return {
    r: Number.parseInt(match[1], 10),
    g: Number.parseInt(match[2], 10),
    b: Number.parseInt(match[3], 10),
  };
}

function textColorForBackground(color) {
  const parsed = parseRgbColor(color);
  if (!parsed) {
    return "#111827";
  }
  const luminance = (0.2126 * parsed.r + 0.7152 * parsed.g + 0.0722 * parsed.b) / 255;
  return luminance < 0.58 ? "#f8fafc" : "#111827";
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

function formatStrategyLabel(strategy) {
  if (strategy === "both") {
    return "mobile + desktop";
  }
  return strategy || "--";
}

function describeTrackerStatus(tracker) {
  if (tracker.phase === "awaiting-google") {
    if (!tracker.running) {
      return `Paused (awaiting ${formatStrategyLabel(tracker.activeStrategy)})`;
    }
    return `Running Google PageSpeed (${formatStrategyLabel(tracker.activeStrategy)})`;
  }

  if (!tracker.running) {
    if (tracker.pauseReason === "stat-sig-1") {
      return "Paused (reached stat sig ±1)";
    }
    return "Paused";
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
  const scoreSummaryPopulationByMode = {};
  const runScorePopulationByMode = {};
  const metricPopulationsByMode = {};

  for (const mode of STRATEGIES) {
    scoreSummaryPopulationByMode[mode] = [];
    runScorePopulationByMode[mode] = [];
    metricPopulationsByMode[mode] = {};
    for (const metric of METRICS) {
      metricPopulationsByMode[mode][metric.key] = [];
    }
  }

  for (const tracker of state.trackers.values()) {
    const modeSummaries = {};

    for (const mode of STRATEGIES) {
      const samples = tracker.history[mode];
      const summary = summarize(samples);
      modeSummaries[mode] = summary;

      for (const sample of samples) {
        if (Number.isFinite(sample.performanceScore)) {
          runScorePopulationByMode[mode].push(sample.performanceScore);
          scoreSummaryPopulationByMode[mode].push(sample.performanceScore);
        }
        for (const metric of METRICS) {
          const value = sample.metrics?.[metric.key]?.value;
          if (Number.isFinite(value)) {
            const points = contributionPointsForDisplay(mode, metric.key, value);
            if (Number.isFinite(points)) {
              metricPopulationsByMode[mode][metric.key].push(points);
            }
          }
        }
      }

      if (!summary) {
        continue;
      }
    }

    summariesByUrl.set(tracker.url, modeSummaries);
  }

  const baselineUrl =
    state.comparisonBaseUrl && summariesByUrl.has(state.comparisonBaseUrl) ? state.comparisonBaseUrl : null;
  const baselineSummariesByMode = baselineUrl ? (summariesByUrl.get(baselineUrl) || {}) : {};
  const deltaScales = {
    summaryByMode: {
      mobile: 0,
      desktop: 0,
    },
    runByMode: {
      mobile: 0,
      desktop: 0,
    },
    metricByMode: {
      mobile: {},
      desktop: {},
    },
  };
  for (const mode of STRATEGIES) {
    for (const metric of METRICS) {
      deltaScales.metricByMode[mode][metric.key] = 0;
    }
  }

  if (baselineUrl) {
    for (const tracker of state.trackers.values()) {
      const trackerSummaries = summariesByUrl.get(tracker.url) || {};
      for (const mode of STRATEGIES) {
        const baselineSummary = baselineSummariesByMode[mode];
        if (!baselineSummary || !Number.isFinite(baselineSummary.avgScore)) {
          continue;
        }

        const modeSummary = trackerSummaries[mode] || null;
        if (modeSummary && Number.isFinite(modeSummary.avgScore)) {
          deltaScales.summaryByMode[mode] = Math.max(
            deltaScales.summaryByMode[mode],
            Math.abs(modeSummary.avgScore - baselineSummary.avgScore),
          );
        }

        for (const sample of tracker.history[mode]) {
          if (!Number.isFinite(sample.performanceScore)) {
            continue;
          }
          deltaScales.runByMode[mode] = Math.max(
            deltaScales.runByMode[mode],
            Math.abs(sample.performanceScore - baselineSummary.avgScore),
          );
        }

        if (!modeSummary) {
          continue;
        }
        for (const metric of METRICS) {
          const modeMetric = modeSummary.metrics?.[metric.key];
          const baselineMetric = baselineSummary.metrics?.[metric.key];
          if (!modeMetric || !baselineMetric) {
            continue;
          }
          const currentContribution = metricContribution(mode, metric.key, modeMetric.avgValue);
          const baselineContribution = metricContribution(mode, metric.key, baselineMetric.avgValue);
          if (!currentContribution || !baselineContribution) {
            continue;
          }
          deltaScales.metricByMode[mode][metric.key] = Math.max(
            deltaScales.metricByMode[mode][metric.key],
            Math.abs(currentContribution.points - baselineContribution.points),
          );
        }
      }
    }
  }

  return {
    summariesByUrl,
    scoreSummaryPopulationByMode,
    runScorePopulationByMode,
    metricPopulationsByMode,
    baselineUrl,
    baselineSummariesByMode,
    deltaScales,
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
      isPartial: Boolean((mobile && !desktop) || (!mobile && desktop)),
      pending: false,
    });
  }

  const shouldShowPending =
    (tracker.running || tracker.inFlight) &&
    mobileSamples.length === desktopSamples.length &&
    (tracker.phase === "waiting" ||
      tracker.phase === "queued" ||
      tracker.phase === "running" ||
      tracker.phase === "awaiting-google");

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

  if (status.kind === "google") {
    const spinner = document.createElement("span");
    spinner.className = "run-spinner";
    wrapper.append(spinner);
  } else {
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
  cell.onclick = null;
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
  const background = getRunBackgroundColor(mode, score, renderContext);
  cell.className = mode === "mobile" ? "score-cell-mobile" : "score-cell-desktop";
  cell.style.backgroundColor = background;
  cell.style.color = textColorForBackground(background);
  cell.style.cursor = "pointer";
  cell.innerHTML = "";

  const openDetail = () => {
    openRunDetailPanel(tracker, mode, sample, rowData.runNumber);
  };
  cell.addEventListener("click", openDetail);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "run-score-button";
  button.textContent = score.toFixed(0);
  button.tabIndex = -1;

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
    runCell.textContent = rowData.pending ? `#${rowData.runNumber} next` : `#${rowData.runNumber}`;
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

function renderSummaryTile(tile, summary, mode, renderContext, options = {}) {
  const {
    baselineSummary = null,
    isBaselineCard = false,
  } = options;
  const scoreNode = tile.querySelector(".tile-score");
  const metaNode = tile.querySelector(".tile-meta");
  tile.style.backgroundColor = "";
  tile.style.borderColor = "";

  if (!summary) {
    scoreNode.textContent = "--";
    metaNode.innerHTML = "";
    const main = document.createElement("span");
    main.className = "tile-meta-main";
    main.textContent = "Need runs";
    const sub = document.createElement("span");
    sub.className = "tile-meta-sub";
    sub.textContent = "stat sig ±2: ~? runs\nstat sig ±1: ~? runs";
    metaNode.append(main, sub);
    return;
  }

  scoreNode.textContent = summary.avgScore.toFixed(1);
  const requiredRuns = summary.samples < 2
    ? null
    : Math.max(MIN_STAT_SIG_SAMPLES, Math.ceil(((1.96 * summary.scoreStdDev) / TARGET_CI_HALF_WIDTH_POINTS) ** 2));
  const requiredRunsTight = summary.samples < 2
    ? null
    : Math.max(MIN_STAT_SIG_SAMPLES, Math.ceil(((1.96 * summary.scoreStdDev) / SECONDARY_CI_HALF_WIDTH_POINTS) ** 2));
  const moreRuns = requiredRuns === null ? null : Math.max(0, requiredRuns - summary.samples);
  const moreRunsTight = requiredRunsTight === null ? null : Math.max(0, requiredRunsTight - summary.samples);
  const moreRunsLabel = moreRuns === 0 ? "✅" : `${moreRuns} more runs`;
  const moreRunsTightLabel = moreRunsTight === 0 ? "✅" : `${moreRunsTight} more runs`;
  let deltaLine = "";
  if (isBaselineCard) {
    deltaLine = "baseline";
  } else if (
    baselineSummary &&
    Number.isFinite(summary.avgScore) &&
    Number.isFinite(baselineSummary.avgScore)
  ) {
    const delta = summary.avgScore - baselineSummary.avgScore;
    deltaLine = formatDeltaPointsAndPercent(delta, baselineSummary.avgScore);
  }
  const mainLine = `${formatConfidence(summary.ci95HalfWidth)} (${summary.samples} runs)`;
  const subLine = requiredRuns === null || requiredRunsTight === null
    ? "stat sig ±2: ? more runs\nstat sig ±1: ? more runs"
    : `stat sig ±2: ${moreRunsLabel}\nstat sig ±1: ${moreRunsTightLabel}`;

  metaNode.innerHTML = "";
  const main = document.createElement("span");
  main.className = "tile-meta-main";
  main.textContent = mainLine;
  const sub = document.createElement("span");
  sub.className = "tile-meta-sub";
  sub.textContent = subLine;
  metaNode.append(main);
  if (deltaLine) {
    const deltaNode = document.createElement("span");
    deltaNode.className = "tile-meta-delta";
    deltaNode.textContent = deltaLine;
    metaNode.append(deltaNode);
  }
  metaNode.append(sub);

  tile.style.backgroundColor = getSummaryBackgroundColor(mode, summary.avgScore, renderContext);
  tile.style.borderColor = "#b8c6d9";
}

function renderMetricSummary(tbody, mobileSummary, desktopSummary, renderContext, options = {}) {
  const {
    baselineMobileSummary = null,
    baselineDesktopSummary = null,
    isBaselineCard = false,
  } = options;
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
      const mobileCellBackground = getMetricBackgroundColor(
        "mobile",
        metric.key,
        mobileMetric.avgValue,
        renderContext,
      );
      mobileCell.style.backgroundColor = mobileCellBackground;
      let mobileDeltaText = "";
      if (isBaselineCard) {
        mobileDeltaText = "baseline";
      } else {
        const baselineMobileMetric = baselineMobileSummary?.metrics?.[metric.key];
        if (baselineMobileMetric) {
          const mobileContribution = metricContribution("mobile", metric.key, mobileMetric.avgValue);
          const baselineMobileContribution = metricContribution("mobile", metric.key, baselineMobileMetric.avgValue);
          if (mobileContribution && baselineMobileContribution) {
            const deltaPoints = mobileContribution.points - baselineMobileContribution.points;
            mobileDeltaText = formatDeltaPointsAndPercent(deltaPoints, baselineMobileContribution.points);
          }
        }
      }
      mobileCell.append(
        createMetricValueBlock(
          metric,
          mobileMetric.avgValue,
          null,
          "mobile",
          false,
          null,
          mobileDeltaText,
        ),
      );
    }
    row.append(mobileCell);

    const desktopCell = document.createElement("td");
    const desktopMetric = desktopSummary?.metrics?.[metric.key];
    if (!desktopMetric) {
      desktopCell.textContent = "--";
    } else {
      const desktopCellBackground = getMetricBackgroundColor(
        "desktop",
        metric.key,
        desktopMetric.avgValue,
        renderContext,
      );
      desktopCell.style.backgroundColor = desktopCellBackground;
      let desktopDeltaText = "";
      if (isBaselineCard) {
        desktopDeltaText = "baseline";
      } else {
        const baselineDesktopMetric = baselineDesktopSummary?.metrics?.[metric.key];
        if (baselineDesktopMetric) {
          const desktopContribution = metricContribution("desktop", metric.key, desktopMetric.avgValue);
          const baselineDesktopContribution = metricContribution("desktop", metric.key, baselineDesktopMetric.avgValue);
          if (desktopContribution && baselineDesktopContribution) {
            const deltaPoints = desktopContribution.points - baselineDesktopContribution.points;
            desktopDeltaText = formatDeltaPointsAndPercent(deltaPoints, baselineDesktopContribution.points);
          }
        }
      }
      desktopCell.append(
        createMetricValueBlock(
          metric,
          desktopMetric.avgValue,
          null,
          "desktop",
          false,
          null,
          desktopDeltaText,
        ),
      );
    }
    row.append(desktopCell);

    tbody.append(row);
  }
}

function getAllRunScorePopulation() {
  const values = [];
  for (const tracker of state.trackers.values()) {
    for (const mode of STRATEGIES) {
      for (const sample of tracker.history[mode]) {
        if (Number.isFinite(sample.performanceScore)) {
          values.push(sample.performanceScore);
        }
      }
    }
  }
  return values;
}

function closeRunDetailPanel() {
  state.runDetail = null;
  renderRunDetailPanel();
}

function openRunDetailPanel(tracker, mode, sample, runNumber) {
  state.runDetail = {
    url: tracker.url,
    label: tracker.label || "",
    mode,
    sample,
    runNumber,
  };
  renderRunDetailPanel();
}

function renderRunDetailPanel() {
  if (!runDetailPanel || !runDetailBackdrop || !runDetailContent) {
    return;
  }

  if (!state.runDetail) {
    document.body.classList.remove("run-detail-open");
    runDetailPanel.setAttribute("aria-hidden", "true");
    runDetailContent.innerHTML = "";
    const placeholder = document.createElement("p");
    placeholder.className = "placeholder";
    placeholder.textContent = "Click any score in Score Runs to inspect that single run.";
    runDetailContent.append(placeholder);
    return;
  }

  document.body.classList.add("run-detail-open");
  runDetailPanel.setAttribute("aria-hidden", "false");
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

  const scorePopulation = getAllRunScorePopulation();
  const runScore = detail.sample.performanceScore;
  const runPercentile = getPercentile(scorePopulation, runScore, true);
  const runScoreBackground = percentileColor(runPercentile);

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
      dd.style.backgroundColor = runScoreBackground;
      dd.style.color = textColorForBackground(runScoreBackground);
      dd.className = "run-detail-score";
    }
    item.append(dt, dd);
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
      scoreCell.style.backgroundColor = percentileColor(scoreValue);
      scoreCell.style.color = textColorForBackground(scoreCell.style.backgroundColor);
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
        pointsCell.style.backgroundColor = percentileColor(percent);
        pointsCell.style.color = textColorForBackground(pointsCell.style.backgroundColor);
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
  runDetailContent.append(metricTable);
}

function syncUrlCardHeaderHeights() {
  const headers = Array.from(urlCardsContainer.querySelectorAll(".url-card > header"));
  const identities = Array.from(urlCardsContainer.querySelectorAll(".url-identity"));
  const cards = Array.from(urlCardsContainer.querySelectorAll(".url-card[data-url]"));
  if (!identities.length) {
    return;
  }

  // Clear legacy header equalization first.
  for (const header of headers) {
    header.style.minHeight = "";
  }
  for (const identity of identities) {
    identity.style.minHeight = "";
  }

  const isMobileLayout = window.matchMedia("(max-width: 720px)").matches;
  if (isMobileLayout) {
    return;
  }

  const visibleCards = cards.filter((card) => card.offsetParent !== null);
  if (visibleCards.length < 2) {
    return;
  }
  const firstRowTop = Math.round(visibleCards[0].getBoundingClientRect().top);
  const hasMultiColumnRow = visibleCards
    .slice(1)
    .some((card) => Math.abs(Math.round(card.getBoundingClientRect().top) - firstRowTop) <= 1);
  if (!hasMultiColumnRow) {
    return;
  }

  const visibleIdentities = identities.filter((identity) => identity.offsetParent !== null);
  if (!visibleIdentities.length) {
    return;
  }

  const maxHeight = Math.max(
    ...visibleIdentities.map((identity) => Math.ceil(identity.getBoundingClientRect().height)),
  );

  for (const identity of visibleIdentities) {
    identity.style.minHeight = `${maxHeight}px`;
  }
}

function scheduleHeaderHeightSync() {
  if (headerSyncRafId !== null) {
    cancelAnimationFrame(headerSyncRafId);
  }
  headerSyncRafId = requestAnimationFrame(() => {
    headerSyncRafId = null;
    syncUrlCardHeaderHeights();
  });
}

function render() {
  const labelEditState = getActiveLabelEditState();
  suppressLabelBlurCommit = Boolean(labelEditState);
  const active = document.activeElement;
  if (active instanceof Element && active.matches("#comparison-table th.sortable")) {
    active.blur();
  }
  try {
    if (toggleDetailsButton) {
      toggleDetailsButton.textContent = state.showDetails ? "Hide Details" : "Show Details";
      toggleDetailsButton.setAttribute("aria-label", state.showDetails ? "Hide Details" : "Show Details");
    }
    const renderContext = buildRenderContext();
    renderCards(renderContext);
    renderComparisonTable(renderContext);
    renderRunDetailPanel();
    if (labelEditState) {
      restoreLabelEditState(labelEditState);
    }
    refreshLiveStatusText();
    scheduleHeaderHeightSync();
  } finally {
    suppressLabelBlurCommit = false;
  }
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

  const baseUrl = state.comparisonBaseUrl;
  const baseSummaries = baseUrl ? (renderContext.summariesByUrl.get(baseUrl) || null) : null;

  for (const tracker of getOrderedTrackers()) {
    const card = urlCardTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.url = tracker.url;
    card.style.viewTransitionName = viewTransitionNameForUrl(tracker.url);
    card.classList.toggle("comparison-base", state.comparisonBaseUrl === tracker.url);

    const title = card.querySelector(".url-card-title");
    const dragHandle = card.querySelector(".drag-handle");
    const labelLine = card.querySelector(".url-label-line");
    const urlLine = card.querySelector(".url-title-url");
    const labelInput = card.querySelector(".url-label-input");
    const meta = card.querySelector(".url-card-meta");
    const toggleButton = card.querySelector(".toggle-run");
    const runNowButton = card.querySelector(".run-now");
    const setBaselineButton = card.querySelector(".set-baseline");
    const removeButton = card.querySelector(".remove");
    const scoreHistoryScroll = card.querySelector(".score-history-scroll");
    const scoreHistoryBody = card.querySelector(".score-history-body");
    const metricSummaryBody = card.querySelector(".metric-summary-body");
    const metricSummaryTable = card.querySelector(".metric-summary-table");
    const scoreHistorySection = card.querySelector(".score-history-section");
    const mobileTile = card.querySelector(".summary-tile[data-mode='mobile']");
    const desktopTile = card.querySelector(".summary-tile[data-mode='desktop']");
    const errorText = card.querySelector(".error-text");

    const hasLabel = Boolean(tracker.label && tracker.label.trim());
    labelLine.textContent = hasLabel ? tracker.label : "Add a label";
    urlLine.textContent = tracker.url;
    title.classList.toggle("no-label", !hasLabel);
    title.dataset.tooltip = hasLabel ? "Edit label" : "Add label";
    attachTooltipHandlers(title);

    title.addEventListener("pointerdown", () => {
      pendingLabelEditUrl = tracker.url;
    });
    title.addEventListener("click", (event) => {
      event.preventDefault();
      pendingLabelEditUrl = null;
      beginLabelEditing(tracker.url);
    });

    if (dragHandle) {
      dragHandle.dataset.tooltip = "Drag to reorder";
      attachTooltipHandlers(dragHandle);
      dragHandle.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      dragHandle.addEventListener("mousedown", (event) => {
        event.stopPropagation();
      });
      dragHandle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
      });
      dragHandle.addEventListener("dragstart", (event) => {
        if (dragEndCleanupTimerId) {
          clearTimeout(dragEndCleanupTimerId);
          dragEndCleanupTimerId = null;
        }
        hideTooltip();
        dragDidDrop = false;
        draggedTrackerUrl = tracker.url;
        setGlobalDraggingCursor(true);
        card.classList.add("is-dragging", "dragging-active");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", tracker.url);
          event.dataTransfer.setDragImage(getTransparentDragImage(), 0, 0);
        }
        createDragPreview(card, event.clientX, event.clientY);
      });
      dragHandle.addEventListener("dragend", () => {
        hideTooltip();
        setGlobalDraggingCursor(false);
        draggedTrackerUrl = null;
        if (dragDidDrop || dragPreviewAnimating) {
          clearDropTargets();
          return;
        }
        if (dragEndCleanupTimerId) {
          clearTimeout(dragEndCleanupTimerId);
        }
        // Some browsers fire dragend before drop; allow drop to win first.
        dragEndCleanupTimerId = setTimeout(() => {
          dragEndCleanupTimerId = null;
          if (dragDidDrop || dragPreviewAnimating) {
            return;
          }
          clearDragCardClasses();
          clearDragPreview();
        }, 60);
      });
    }

    let didCancelLabelEdit = false;
    const commitLabel = () => {
      if (didCancelLabelEdit) {
        return;
      }
      const resumeEditUrl = pendingLabelEditUrl;
      pendingLabelEditUrl = null;
      tracker.label = labelInput.value.trim();
      persistState();
      render();
      if (resumeEditUrl && resumeEditUrl !== tracker.url) {
        requestAnimationFrame(() => {
          beginLabelEditing(resumeEditUrl);
        });
      }
    };
    const cancelLabel = () => {
      didCancelLabelEdit = true;
      const resumeEditUrl = pendingLabelEditUrl;
      pendingLabelEditUrl = null;
      card.classList.remove("is-editing-label");
      render();
      if (resumeEditUrl && resumeEditUrl !== tracker.url) {
        requestAnimationFrame(() => {
          beginLabelEditing(resumeEditUrl);
        });
      }
    };

    labelInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitLabel();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancelLabel();
      }
    });
    labelInput.addEventListener("blur", () => {
      if (suppressLabelBlurCommit) {
        return;
      }
      commitLabel();
    });

    meta.textContent = `Status: ${describeTrackerStatus(tracker)}`;

    const iconPlay = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    const iconPause = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>';
    const iconRunNow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>';
    const iconTrash = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/></svg>';

    toggleButton.classList.toggle("is-running", tracker.running);
    toggleButton.classList.toggle("is-paused", !tracker.running);
    toggleButton.innerHTML = tracker.running ? iconPause : iconPlay;
    toggleButton.setAttribute("aria-label", tracker.running ? "Pause" : "Resume");
    toggleButton.dataset.tooltip = tracker.running ? "Pause" : "Resume";
    attachTooltipHandlers(toggleButton);
    toggleButton.addEventListener("click", () => {
      if (tracker.running) {
        stopTracker(tracker);
      } else {
        startTracker(tracker, true);
      }
      render();
    });

    runNowButton.disabled = tracker.inFlight;
    runNowButton.innerHTML = iconRunNow;
    runNowButton.setAttribute("aria-label", tracker.running ? "Run now" : "Run once");
    runNowButton.dataset.tooltip = tracker.running ? "Run now" : "Run once";
    attachTooltipHandlers(runNowButton);
    runNowButton.addEventListener("click", () => {
      if (!syncConfigFromInputs()) {
        return;
      }
      triggerImmediateCycle(tracker);
    });

    const isBaseCard = state.comparisonBaseUrl === tracker.url;
    if (setBaselineButton) {
      setBaselineButton.innerHTML = ICON_BASELINE;
      setBaselineButton.classList.toggle("is-active", isBaseCard);
      setBaselineButton.setAttribute("aria-label", isBaseCard ? "Clear comparison baseline" : "Set as comparison baseline");
      setBaselineButton.dataset.tooltip = isBaseCard ? "Clear comparison baseline" : "Set as comparison baseline";
      attachTooltipHandlers(setBaselineButton);
      setBaselineButton.addEventListener("click", () => {
        runWithViewTransition(() => {
          state.comparisonBaseUrl = isBaseCard ? null : tracker.url;
          persistState();
          render();
        });
      });
    }

    removeButton.innerHTML = iconTrash;
    removeButton.setAttribute("aria-label", "Remove");
    const removeLocked = tracker.removeConfirmArmed && Date.now() < tracker.removeConfirmReadyAt;
    removeButton.classList.toggle("remove-confirm", tracker.removeConfirmArmed);
    removeButton.disabled = removeLocked;
    removeButton.dataset.tooltip = tracker.removeConfirmArmed ? "Really remove?" : "Remove";
    removeButton.setAttribute("aria-label", tracker.removeConfirmArmed ? "Really remove?" : "Remove");
    attachTooltipHandlers(removeButton);
    removeButton.addEventListener("click", () => {
      if (!tracker.removeConfirmArmed) {
        hideTooltip();
        armTrackerRemoval(tracker);
        render();
        return;
      }
      if (Date.now() < tracker.removeConfirmReadyAt) {
        return;
      }
      removeTracker(tracker.url);
    });

    card.addEventListener("dragover", (event) => {
      if (!draggedTrackerUrl || draggedTrackerUrl === tracker.url) {
        return;
      }
      event.preventDefault();
      clearDropTargets();
      card.classList.add("drop-target");
    });

    card.addEventListener("dragenter", (event) => {
      if (!draggedTrackerUrl || draggedTrackerUrl === tracker.url) {
        return;
      }
      event.preventDefault();
      clearDropTargets();
      card.classList.add("drop-target");
    });

    card.addEventListener("dragleave", (event) => {
      if (!(event.relatedTarget instanceof Node) || !card.contains(event.relatedTarget)) {
        card.classList.remove("drop-target");
      }
    });

    card.addEventListener("drop", (event) => {
      event.preventDefault();
      const draggedUrl = draggedTrackerUrl || event.dataTransfer?.getData("text/plain");
      if (!draggedUrl || draggedUrl === tracker.url) {
        clearDragCardClasses();
        clearDragPreview();
        dragDidDrop = false;
        return;
      }

      dragDidDrop = true;
      if (dragEndCleanupTimerId) {
        clearTimeout(dragEndCleanupTimerId);
        dragEndCleanupTimerId = null;
      }
      draggedTrackerUrl = null;
      clearDropTargets();
      fadeOutDragPreview();
      reorderTracker(draggedUrl, tracker.url);
    });

    const summaries = renderContext.summariesByUrl.get(tracker.url) || {};
    const mobileSummary = summaries.mobile || null;
    const desktopSummary = summaries.desktop || null;
    renderSummaryTile(mobileTile, mobileSummary, "mobile", renderContext, {
      baselineSummary: baseSummaries?.mobile || null,
      isBaselineCard: isBaseCard,
    });
    renderSummaryTile(desktopTile, desktopSummary, "desktop", renderContext, {
      baselineSummary: baseSummaries?.desktop || null,
      isBaselineCard: isBaseCard,
    });
    if (metricSummaryTable) {
      metricSummaryTable.hidden = !state.showDetails;
    }
    if (scoreHistorySection) {
      scoreHistorySection.hidden = !state.showDetails;
    }
    if (state.showDetails) {
      renderMetricSummary(metricSummaryBody, mobileSummary, desktopSummary, renderContext, {
        baselineMobileSummary: baseSummaries?.mobile || null,
        baselineDesktopSummary: baseSummaries?.desktop || null,
        isBaselineCard: isBaseCard,
      });
      renderScoreHistory(scoreHistoryBody, tracker, renderContext);
    }
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
        label: tracker.label || "",
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
    urlCell.className = "comparison-url-cell";

    const urlContent = document.createElement("div");
    urlContent.className = "comparison-url-content";

    const urlText = document.createElement("div");
    urlText.className = "comparison-url-text";
    if (rowData.label) {
      const labelBig = document.createElement("span");
      labelBig.className = "comparison-url-label";
      labelBig.textContent = rowData.label;
      const urlSmall = document.createElement("span");
      urlSmall.className = "comparison-url-small";
      urlSmall.textContent = rowData.url;
      urlText.append(labelBig, urlSmall);
    } else {
      const urlOnly = document.createElement("span");
      urlOnly.className = "comparison-url-only";
      urlOnly.textContent = rowData.url;
      urlText.append(urlOnly);
    }

    const isBaseRow = state.comparisonBaseUrl === rowData.url;
    const tableBaselineButton = document.createElement("button");
    tableBaselineButton.type = "button";
    tableBaselineButton.className = "comparison-baseline-btn set-baseline icon-btn secondary";
    tableBaselineButton.innerHTML = ICON_BASELINE;
    tableBaselineButton.classList.toggle("is-active", isBaseRow);
    tableBaselineButton.setAttribute(
      "aria-label",
      isBaseRow ? "Clear comparison baseline" : "Set as comparison baseline",
    );
    tableBaselineButton.dataset.tooltip = isBaseRow
      ? "Clear comparison baseline"
      : "Set as comparison baseline";
    attachTooltipHandlers(tableBaselineButton);
    tableBaselineButton.addEventListener("click", (event) => {
      event.preventDefault();
      runWithViewTransition(() => {
        state.comparisonBaseUrl = isBaseRow ? null : rowData.url;
        persistState();
        render();
      });
    });

    urlContent.append(urlText, tableBaselineButton);
    urlCell.append(urlContent);
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

    const scoreAvgCell = document.createElement("td");
    scoreAvgCell.className = "comparison-color-cell comparison-score-cell";
    scoreAvgCell.style.backgroundColor = getSummaryBackgroundColor(rowData.mode, rowData.summary.avgScore, renderContext);
    scoreAvgCell.textContent = rowData.summary.avgScore.toFixed(1);
    row.append(scoreAvgCell);

    const confidenceCell = document.createElement("td");
    confidenceCell.textContent = formatConfidence(rowData.summary.ci95HalfWidth);
    row.append(confidenceCell);

    const samplesCell = document.createElement("td");
    samplesCell.textContent = String(rowData.summary.samples);
    row.append(samplesCell);

    for (const metric of METRICS) {
      const metricCell = document.createElement("td");
      metricCell.className = "comparison-color-cell";
      const metricResult = rowData.summary.metrics[metric.key];
      metricCell.style.backgroundColor = getMetricBackgroundColor(
        rowData.mode,
        metric.key,
        metricResult.avgValue,
        renderContext,
      );
      const bubble = createMetricValueBlock(
        metric,
        metricResult.avgValue,
        null,
        rowData.mode,
        false,
      );
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
  scheduleHeaderHeightSync();
}

setInterval(() => {
  refreshLiveStatusText();
}, 1000);

function serializeTracker(tracker) {
  return {
    url: tracker.url,
    label: tracker.label || "",
    running: tracker.running,
    history: tracker.history,
    lastError: tracker.lastError,
    phase: tracker.phase,
    activeStrategy: tracker.activeStrategy,
    pauseReason: tracker.pauseReason,
    autoPauseArmed: tracker.autoPauseArmed === true,
  };
}

function persistState() {
  try {
    normalizeTrackerOrder();
    const payload = {
      apiKey: state.apiKey,
      pollIntervalSec: state.pollIntervalSec,
      themeMode: state.themeMode,
      comparisonBaseUrl: state.comparisonBaseUrl,
      showDetails: state.showDetails,
      trackers: Array.from(state.trackers.values()).map(serializeTracker),
      trackerOrder: state.trackerOrder,
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
    state.pollIntervalSec = FIXED_POLL_INTERVAL_SEC;

    if (typeof parsed.themeMode === "string" && THEME_MODES.has(parsed.themeMode)) {
      state.themeMode = parsed.themeMode;
    }
    if (typeof parsed.showDetails === "boolean") {
      state.showDetails = parsed.showDetails;
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
        tracker.label = typeof stored.label === "string" ? stored.label.trim() : "";
        tracker.history = {
          mobile: Array.isArray(stored.history?.mobile) ? stored.history.mobile : [],
          desktop: Array.isArray(stored.history?.desktop) ? stored.history.desktop : [],
        };
        tracker.lastError = typeof stored.lastError === "string" ? stored.lastError : "";
        tracker.running = stored.running === true;
        tracker.phase = typeof stored.phase === "string" ? stored.phase : (tracker.running ? "queued" : "paused");
        if (tracker.phase === "cooldown") {
          tracker.phase = tracker.running ? "waiting" : "paused";
        }
        tracker.activeStrategy =
          typeof stored.activeStrategy === "string" ? stored.activeStrategy : null;
        tracker.pauseReason =
          stored.pauseReason === "stat-sig-1" ? "stat-sig-1" : null;
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
    console.warn("Failed to load saved state", error);
  }
}

hydrateState();
applyThemeMode();
updateShopifyPbSuggestion();
for (const tracker of state.trackers.values()) {
  if (tracker.running) {
    startTracker(tracker);
  }
}

render();
