import { normalizeEnteredUrl } from "./src/url-input.mjs";
import { createApiKeyController } from "./src/ui/api-key.mjs";
import { createBackupControls } from "./src/ui/backup-controls.mjs";
import { createMetricsView } from "./src/views/metrics.mjs";
import { createInitialState, FIXED_POLL_INTERVAL_SEC, GLIMM_DEV_SETTINGS_VERSION, MIN_STAT_SIG_SAMPLES, STRATEGIES, THEME_MODES } from "./src/state.mjs";
import { createSiteDetailsView } from "./src/views/site-details.mjs";
import { createSitesView } from "./src/views/sites.mjs";
import { createThemeController } from "./src/ui/theme.mjs";
import { createComparisonView } from "./src/views/comparison.mjs";
import { createRunsController } from "./src/views/runs.mjs";
import { persistState as persistStoredState, hydrateState as hydrateStoredState } from "./src/storage.mjs";
import { validateBackup as validateBackupData, createBackup } from "./src/backup.mjs";
import { METRICS } from "./src/metrics.mjs";
import { summarize, getPercentile } from "./src/statistics.mjs";
import { SCORING_MODEL_VERSION, metricContribution } from "./src/lighthouse-scoring.mjs";
import { fetchPsiSample, isDuplicateSample } from "./src/tracking/pagespeed.mjs";
import { createTooltipController } from "./src/ui/tooltips.mjs";
import { mountImprovementControls } from "./src/ui/improvement-controls.mjs";
import { createTrackerScheduler } from "./src/tracking/scheduler.mjs";
import { createConnectedEdgeShadow, updateConnectedEdgeShadow } from "./src/ui/connected-edges.mjs";
import { createWorkspaceNavigation } from "./src/ui/navigation.mjs";
import playSvg from "lucide-static/icons/play.svg?raw";
import pauseSvg from "lucide-static/icons/pause.svg?raw";
import zapSvg from "lucide-static/icons/zap.svg?raw";
import targetSvg from "lucide-static/icons/target.svg?raw";
import trashSvg from "lucide-static/icons/trash-2.svg?raw";
import dashboardSvg from "lucide-static/icons/layout-dashboard.svg?raw";
import chartSvg from "lucide-static/icons/chart-no-axes-column-increasing.svg?raw";
import monitorSvg from "lucide-static/icons/monitor.svg?raw";
import sunSvg from "lucide-static/icons/sun.svg?raw";
import moonSvg from "lucide-static/icons/moon.svg?raw";
import closeSvg from "lucide-static/icons/x.svg?raw";
import ellipsisSvg from "lucide-static/icons/ellipsis.svg?raw";
import settingsSvg from "lucide-static/icons/settings.svg?raw";

const iconMarkup = (svg) => svg.replace("<svg", '<svg aria-hidden="true"');
for (const [selector, icon] of [
  ['.workspace-tab[data-view="sites"] svg', dashboardSvg],
  ['.workspace-tab[data-view="comparison"] svg', chartSvg],
  ['.workspace-tab[data-view="settings"] svg', settingsSvg],
  ['.theme-mode-button[data-theme-mode="auto"] svg', monitorSvg],
  ['.theme-mode-button[data-theme-mode="light"] svg', sunSvg],
  ['.theme-mode-button[data-theme-mode="dark"] svg', moonSvg],
  ['[data-setting-theme="auto"] svg', monitorSvg],
  ['[data-setting-theme="light"] svg', sunSvg],
  ['[data-setting-theme="dark"] svg', moonSvg],
  ['#api-key-dialog-close svg', closeSvg],
]) {
  const original = document.querySelector(selector);
  if (original) original.outerHTML = iconMarkup(icon);
}

const state = createInitialState();

const settingsForm = document.getElementById("settings-form");
const addUrlForm = document.getElementById("add-url-form");
const apiKeyInput = document.getElementById("api-key");
// API keys are not login passwords; use visual masking where supported to avoid password autofill.
if (CSS.supports("-webkit-text-security", "disc")) apiKeyInput.type = "text";
const urlInput = document.getElementById("url-input");
const shopifyPbSuggestion = document.getElementById("shopify-pb-suggestion");
const shopifyPbAction = document.getElementById("shopify-pb-action");
const urlCardsContainer = document.getElementById("url-cards");
const urlCardTemplate = document.getElementById("url-card-template");
const sortableHeaders = Array.from(document.querySelectorAll("#comparison-table th.sortable"));
const comparisonBody = document.getElementById("comparison-body");
const startAllButton = document.getElementById("start-all");
const stopAllButton = document.getElementById("stop-all");
const clearRunsButton = document.getElementById("clear-runs");
const colorModeButton = document.getElementById("color-mode");
const deleteAllSitesButton = document.getElementById("delete-all-sites");
const bulkActionDialog = document.getElementById("bulk-action-dialog");
const bulkActionForm = document.getElementById("bulk-action-form");
const bulkActionTitle = document.getElementById("bulk-action-title");
const bulkActionDescription = document.getElementById("bulk-action-description");
const bulkActionConfirm = document.getElementById("bulk-action-confirm");
const toggleDetailsButton = document.getElementById("toggle-details");
const themeModeButtons = Array.from(document.querySelectorAll(".theme-mode-button[data-theme-mode]"));
const settingsThemeButtons = Array.from(document.querySelectorAll("[data-setting-theme]"));
const settingsThemeOptions = document.getElementById("settings-theme-options");
const autoPauseTargetInput = document.getElementById("auto-pause-target");
const glimmDevPanel = document.getElementById("glimm-dev-panel");
const glimmDevFields = Array.from(document.querySelectorAll("[data-glimm-setting]"));
const glimmDevPreviewButton = document.getElementById("glimm-dev-preview");
const glimmDevAutoplayButton = document.getElementById("glimm-dev-autoplay");
const openSettingsButton = document.getElementById("open-settings");
const apiKeyStatus = document.getElementById("api-key-status");
const setupHint = document.getElementById("setup-hint");
const apiKeyDialog = document.getElementById("api-key-dialog");
const apiKeyIntro = document.getElementById("api-key-intro");
const apiKeyDialogCloseButton = document.getElementById("api-key-dialog-close");
const skipSetupButton = document.getElementById("skip-setup");
const clearApiKeyButton = document.getElementById("clear-api-key");
const saveApiKeyButton = settingsForm?.querySelector('button[type="submit"]');
const runDetailPanel = document.getElementById("run-detail-panel");
const runDetailCloseButton = document.getElementById("run-detail-close");
const runDetailContent = document.getElementById("run-detail-content");
runDetailCloseButton.innerHTML = iconMarkup(closeSvg);
document.getElementById("run-detail-slot").append(runDetailPanel);
const uiTooltip = document.getElementById("ui-tooltip");
const SORTABLE_KEYS = new Set(["url", "mode", "avgScore", "confidence", "samples", "fcp", "si", "lcp", "tbt", "cls"]);
const REMOVE_CONFIRM_LOCKOUT_MS = 1000;
const REMOVE_CONFIRM_ARM_TTL_MS = 10000;
const DRAG_PREVIEW_SCALE = 0.25;
const DRAG_PREVIEW_OFFSET = 10;
const DRAG_PREVIEW_FADE_IN_MS = 90;
const DRAG_PREVIEW_FADE_OUT_MS = 140;
const ICON_BASELINE = iconMarkup(targetSvg);

let draggedTrackerUrl = null;
let dragPreviewElement = null;
let dragPreviewBaseWidth = 0;
let dragPreviewAnimating = false;
let dragDidDrop = false;
let dragEndCleanupTimerId = null;
let transparentDragImage = null;
let pendingLabelEditUrl = null;
let selectedSiteUrl = null;
let openSiteMenuUrl = null;
let suppressLabelBlurCommit = false;
let skipLabelEditRestoreOnNextRender = false;
let pendingBulkAction = null;
let pendingSiteRemovalUrl = null;
let pendingImport = null;
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
const { hideTooltip, attachTooltipHandlers } = createTooltipController({
  uiTooltip,
  isDragging: () => Boolean(draggedTrackerUrl || dragPreviewElement),
});
const { formatPointValue, baselineDelta, setBaselineDeltaLabel, createMetricValueBlock,
  addConfidenceRange, createPaneProgress, addMetricProgress, getSummaryBackgroundColor,
  getRunBackgroundColor, getMetricBackgroundColor, formatConfidence, buildRenderContext,
  renderSummaryTile, formatGoalEstimate, renderMetricSummary } = createMetricsView({
  state, document, METRICS, STRATEGIES, MIN_STAT_SIG_SAMPLES, SCORING_MODEL_VERSION,
  metricContribution, getPercentile, summarize, attachTooltipHandlers,
});
const { hasApiKey, openApiKeyDialog, closeApiKeyDialog, ensureApiKeyConfigured, updateApiKeyUi } = createApiKeyController({
  state, settingsForm, apiKeyInput, apiKeyDialog, apiKeyIntro, apiKeyDialogCloseButton,
  skipSetupButton, clearApiKeyButton, saveApiKeyButton, openSettingsButton, apiKeyStatus,
  setupHint, FIXED_POLL_INTERVAL_SEC, persistState, render, addTrackerAndStart,
});
const { scheduleNext, runCycle } = createTrackerScheduler({
  state, strategies: STRATEGIES, minSamples: MIN_STAT_SIG_SAMPLES,
  persistState, render, fetchPsiSample, isDuplicateSample, summarize,
});
const { renderScoreHistory, closeRunDetailPanel, openRunDetailPanel, renderRunDetailPanel,
  positionRunSelection, followRunSeam } = createRunsController({
  state, runDetailPanel, runDetailCloseButton, runDetailContent, METRICS, SCORING_MODEL_VERSION,
  closeSvg, iconMarkup, buildRenderContext, getRunBackgroundColor, getMetricBackgroundColor,
  getSummaryBackgroundColor, createPaneProgress, metricContribution, formatPointValue, attachTooltipHandlers,
  updateConnectedEdgeShadow,
});



const { applyThemeMode, positionSettingsThemeIndicator, setThemeModeWithSweep,
  updateGlimmDevSetting, previewGlimmThemeSweep, syncGlimmDevPanel,
  scheduleGlimmAutoplay, hydrateGlimmDevState } = createThemeController({
  state, THEME_MODES, GLIMM_DEV_SETTINGS_VERSION, systemThemeQuery,
  themeModeButtons, settingsThemeButtons, settingsThemeOptions, glimmDevFields,
  glimmDevAutoplayButton, persistState, render,
});

runDetailCloseButton?.addEventListener("click", () => {
  closeRunDetailPanel();
});
colorModeButton.dataset.tooltip = document.getElementById("color-mode-description").textContent;
colorModeButton.dataset.tooltipRows = JSON.stringify([
  ["Absolute", "Color by score"],
  ["Relative", "Compare sites or baseline"],
]);
attachTooltipHandlers(colorModeButton);
themeModeButtons.forEach(attachTooltipHandlers);
colorModeButton.addEventListener("click", () => {
  state.colorMode = state.colorMode === "absolute" ? "relative" : "absolute";
  persistState();
  render();
  colorModeButton.focus({ preventScroll: true });
});
document.addEventListener("keydown", (event) => {
  document.body.classList.add("keyboard-input");
  if (event.key === "Escape" && !state.runDetail) {
    const openMenu = document.querySelector(".site-menu[open]");
    if (openMenu) {
      openMenu.open = false;
      openSiteMenuUrl = null;
      openMenu.querySelector("summary")?.focus();
    }
  }
  if (!state.runDetail) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeRunDetailPanel();
    return;
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
for (const button of themeModeButtons) {
  button.addEventListener("click", () => {
    const requestedMode = button.dataset.themeMode;
    if (!THEME_MODES.has(requestedMode)) return;
    setThemeModeWithSweep(requestedMode);
  });
}
for (const button of settingsThemeButtons) {
  button.addEventListener("click", () => setThemeModeWithSweep(button.dataset.settingTheme));
}
autoPauseTargetInput.addEventListener("change", () => {
  state.autoPauseTarget = autoPauseTargetInput.value === "off" ? null : Number(autoPauseTargetInput.value);
  persistState();
  render();
});
function updateImprovementPercentage(index, value) {
  state.improvementPercentages[index] = value;
  persistState();
  window.dispatchEvent(new Event("improvement-settings-change"));
  urlCardsContainer.querySelector(".url-card")?.dispatchEvent(new Event("improvement-settings-change"));
}
for (const field of glimmDevFields) {
  field.addEventListener("input", () => updateGlimmDevSetting(field));
  field.addEventListener("change", () => updateGlimmDevSetting(field));
}
glimmDevPreviewButton?.addEventListener("click", () => {
  previewGlimmThemeSweep();
});
glimmDevAutoplayButton?.addEventListener("click", () => {
  state.glimmDev.autoplay = !state.glimmDev.autoplay;
  syncGlimmDevPanel();
  scheduleGlimmAutoplay();
  persistState();
  if (state.glimmDev.autoplay) {
    previewGlimmThemeSweep();
  }
});

document.addEventListener("pointerdown", (event) => {
  document.body.classList.remove("keyboard-input");
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  if (!target.closest(".site-menu")) {
    document.querySelectorAll(".site-menu[open]").forEach((menu) => { menu.open = false; });
    openSiteMenuUrl = null;
  }
  let changed = false;
  const removeButton = target.closest(".remove");
  const removeCard = removeButton?.closest(".url-card[data-url], .site-row[data-url]");
  const keepArmedUrl = removeCard?.dataset.url || null;
  if (disarmAllTrackerRemovals(keepArmedUrl)) {
    changed = true;
  }
  if (changed) {
    render();
  }
}, true);

const { renderComparisonTable, initSortHeaders } = createComparisonView({
  state, sortableHeaders, comparisonBody, SORTABLE_KEYS, STRATEGIES, METRICS, ICON_BASELINE,
  persistState, render, attachTooltipHandlers, runWithViewTransition, createPaneProgress,
  getSummaryBackgroundColor, formatConfidence, getMetricBackgroundColor, createMetricValueBlock,
  addMetricProgress, document,
});
initSortHeaders();

addUrlForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const cleanedUrl = normalizeEnteredUrl(urlInput.value);
  if (!cleanedUrl) {
    window.alert("Please enter a valid HTTP or HTTPS URL.");
    return;
  }
  urlInput.value = cleanedUrl;

  if (state.trackers.has(cleanedUrl)) {
    window.alert("This URL is already being tracked.");
    return;
  }

  if (!hasApiKey()) {
    openApiKeyDialog({ pendingUrl: cleanedUrl });
    return;
  }

  addTrackerAndStart(cleanedUrl);
});

function addTrackerAndStart(cleanedUrl) {
  if (!cleanedUrl || state.trackers.has(cleanedUrl)) {
    if (state.trackers.has(cleanedUrl)) {
      window.alert("This URL is already being tracked.");
    }
    return;
  }

  runWithViewTransition(() => {
    const tracker = createTracker(cleanedUrl);
    state.trackers.set(cleanedUrl, tracker);
    selectedSiteUrl = cleanedUrl;
    if (!document.body.classList.contains("comparison-active")) setWorkspaceView("sites");
    state.trackerOrder.push(cleanedUrl);
    startTracker(tracker, true);
    persistState();

    urlInput.value = "";
    updateShopifyPbSuggestion();
    render();
  });
}

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
  if (!ensureApiKeyConfigured()) {
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

function openBulkActionDialog(action) {
  pendingSiteRemovalUrl = null;
  pendingBulkAction = action;
  const clearRuns = action === "clear-runs";
  bulkActionTitle.textContent = clearRuns ? "Clear all runs?" : "Delete all sites?";
  bulkActionDescription.textContent = clearRuns
    ? "Remove all saved run history and scores. Your sites, labels, and baseline stay in place. Running sites continue on schedule; results already in progress are discarded."
    : "Delete every tracked site and its run history. Tracking will end. Your API key and appearance settings stay in this browser.";
  bulkActionConfirm.textContent = clearRuns ? "Clear Runs" : "Delete All Sites";
  bulkActionDialog.showModal();
  document.getElementById("bulk-action-cancel").focus();
}

function openRemoveSiteDialog(tracker) {
  hideTooltip();
  pendingBulkAction = "remove-site";
  pendingSiteRemovalUrl = tracker.url;
  bulkActionTitle.textContent = `Remove ${tracker.label || tracker.url}?`;
  bulkActionDescription.textContent = "Tracking will end, and saved run history will be lost.";
  bulkActionConfirm.textContent = "Remove Site";
  bulkActionDialog.showModal();
  document.getElementById("bulk-action-cancel").focus();
}

clearRunsButton.addEventListener("click", () => openBulkActionDialog("clear-runs"));
deleteAllSitesButton.addEventListener("click", () => openBulkActionDialog("delete-sites"));
document.getElementById("bulk-action-cancel").addEventListener("click", () => bulkActionDialog.close());
bulkActionDialog.addEventListener("close", () => { pendingBulkAction = null; pendingSiteRemovalUrl = null; pendingImport = null; });
bulkActionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const action = pendingBulkAction;
  if (!action) return;
  if (action === "remove-site") {
    const url = pendingSiteRemovalUrl;
    bulkActionDialog.close();
    if (url) removeTracker(url);
    return;
  }
  if (action === "import-data") {
    const backup = pendingImport;
    if (!backup) return;
    for (const tracker of state.trackers.values()) {
      tracker.historyVersion += 1;
      stopTracker(tracker);
    }
    if (state.runDetail) closeRunDetailPanel();
    state.trackers = new Map(backup.sites.map((site) => {
      const tracker = createTracker(site.url);
      tracker.label = site.label;
      tracker.history = site.history;
      return [site.url, tracker];
    }));
    state.trackerOrder = backup.sites.map((site) => site.url);
    state.comparisonBaseUrl = backup.baselineUrl;
    if (backup.apiKey !== undefined) state.apiKey = backup.apiKey;
    selectedSiteUrl = state.trackerOrder[0] || null;
    bulkActionDialog.close();
    persistState();
    render();
    document.getElementById("data-status").textContent = `Imported ${backup.sites.length} ${backup.sites.length === 1 ? "site" : "sites"}. Tracking is paused.`;
    return;
  }
  for (const tracker of state.trackers.values()) {
    tracker.historyVersion += 1;
    if (action === "clear-runs") {
      tracker.history = { mobile: [], desktop: [] };
      tracker.runErrors = { mobile: "", desktop: "" };
      tracker.autoPauseArmed = false;
      tracker.pauseReason = null;
    } else {
      disarmTrackerRemoval(tracker);
      stopTracker(tracker);
    }
  }
  if (action === "delete-sites") {
    state.trackers.clear();
    state.trackerOrder = [];
    state.comparisonBaseUrl = null;
    selectedSiteUrl = null;
  }
  if (state.runDetail) closeRunDetailPanel();
  bulkActionDialog.close();
  persistState();
  render();
});

function validateBackup(data) {
  return validateBackupData(data, { normalizeUrl, parseUrlSafe, STRATEGIES, METRICS });
}

createBackupControls({ state, hasApiKey, createBackup, validateBackup, getOrderedTrackers,
  setPendingImport: (backup) => { pendingImport = backup; pendingBulkAction = "import-data"; },
  bulkActionTitle, bulkActionDescription, bulkActionConfirm, bulkActionDialog,
});

toggleDetailsButton?.addEventListener("click", () => {
  runWithViewTransition(() => {
    state.showDetails = !state.showDetails;
    persistState();
    render();
  });
});

function createTracker(url) {
  return {
    url,
    label: "",
    running: false,
    inFlight: false,
    historyVersion: 0,
    timerId: null,
    nextRunAt: null,
    history: {
      mobile: [],
      desktop: [],
    },
    lastError: "",
    runErrors: { mobile: "", desktop: "" },
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

  hideTooltip();
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
  const url = parseUrlSafe(normalizeEnteredUrl(urlValue));
  if (!url || !isShopifyPreviewHost(url.hostname)) {
    return "";
  }
  url.searchParams.set("pb", "0");
  return url.toString();
}

function shouldSuggestShopifyPb(urlValue) {
  const url = parseUrlSafe(normalizeEnteredUrl(urlValue));
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
    return `Running ${formatStrategyLabel(tracker.activeStrategy)}`;
  }

  if (!tracker.running) {
    if (/^stat-sig-[1-5]$/.test(tracker.pauseReason || "")) {
      return `Paused (reached ±${tracker.pauseReason.slice(9)} points)`;
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

function render() {
  const labelEditState = skipLabelEditRestoreOnNextRender ? null : getActiveLabelEditState();
  suppressLabelBlurCommit = Boolean(labelEditState);
  const active = document.activeElement;
  if (active instanceof Element && active.matches("#comparison-table th.sortable")) {
    active.blur();
  }
  try {
    const hasTrackers = state.trackers.size > 0;
    startAllButton.hidden = !hasTrackers;
    stopAllButton.hidden = !hasTrackers;
    if (toggleDetailsButton) {
      toggleDetailsButton.hidden = !hasTrackers;
    }
    clearRunsButton.hidden = !hasTrackers;
    deleteAllSitesButton.hidden = !hasTrackers;
    const relativeColors = state.colorMode === "relative";
    colorModeButton.textContent = `Colors: ${relativeColors ? "Relative" : "Absolute"}`;
    colorModeButton.setAttribute("aria-label", `Color mode: ${relativeColors ? "relative" : "absolute"}. Switch to ${relativeColors ? "absolute" : "relative"} colors`);
    updateApiKeyUi();
    if (toggleDetailsButton) {
      toggleDetailsButton.textContent = state.showDetails ? "Hide Details" : "Show Details";
      toggleDetailsButton.setAttribute("aria-label", state.showDetails ? "Hide Details" : "Show Details");
    }
    const renderContext = buildRenderContext();
    renderSiteLibrary(renderContext);
    renderCards(renderContext);
    renderComparisonTable(renderContext);
    renderRunDetailPanel(renderContext);
    if (labelEditState) {
      restoreLabelEditState(labelEditState);
    }
    refreshLiveStatusText();
    scheduleHeaderHeightSync();
  } finally {
    suppressLabelBlurCommit = false;
    skipLabelEditRestoreOnNextRender = false;
  }
}

const sitesView = createSitesView({
  state,
  selection: {
    get selectedSiteUrl() { return selectedSiteUrl; },
    set selectedSiteUrl(value) { selectedSiteUrl = value; },
    get openSiteMenuUrl() { return openSiteMenuUrl; },
    set openSiteMenuUrl(value) { openSiteMenuUrl = value; },
  },
  getOrderedTrackerUrls, getOrderedTrackers, persistState, render, hideTooltip,
  updateConnectedEdgeShadow, createConnectedEdgeShadow, parseUrlSafe, describeTrackerStatus,
  getSummaryBackgroundColor, addConfidenceRange, formatGoalEstimate, baselineDelta,
  setBaselineDeltaLabel, closeRunDetailPanel, setWorkspaceView: (...args) => setWorkspaceView(...args),
  beginLabelEditing, openRemoveSiteDialog, stopTracker, startTracker, ensureApiKeyConfigured,
  iconMarkup, ellipsisSvg, playSvg, pauseSvg, ICON_BASELINE,
});
function renderSiteLibrary(context) { return sitesView.renderSiteLibrary(context); }
function positionSiteSelection() { return sitesView.positionSiteSelection(); }

const { switchWorkspaceView, setWorkspaceView } = createWorkspaceNavigation({ state, closeRunDetailPanel, positionSiteSelection, positionSettingsThemeIndicator });
const { renderCards, scheduleHeaderHeightSync } = createSiteDetailsView({
  state, shared: {
    get selectedSiteUrl() { return selectedSiteUrl; }, set selectedSiteUrl(value) { selectedSiteUrl = value; },
    get pendingLabelEditUrl() { return pendingLabelEditUrl; }, set pendingLabelEditUrl(value) { pendingLabelEditUrl = value; },
    get skipLabelEditRestoreOnNextRender() { return skipLabelEditRestoreOnNextRender; }, set skipLabelEditRestoreOnNextRender(value) { skipLabelEditRestoreOnNextRender = value; },
    get suppressLabelBlurCommit() { return suppressLabelBlurCommit; }, set suppressLabelBlurCommit(value) { suppressLabelBlurCommit = value; },
    get dragEndCleanupTimerId() { return dragEndCleanupTimerId; }, set dragEndCleanupTimerId(value) { dragEndCleanupTimerId = value; },
    get dragDidDrop() { return dragDidDrop; }, set dragDidDrop(value) { dragDidDrop = value; },
    get draggedTrackerUrl() { return draggedTrackerUrl; }, set draggedTrackerUrl(value) { draggedTrackerUrl = value; },
    get dragPreviewAnimating() { return dragPreviewAnimating; }, set dragPreviewAnimating(value) { dragPreviewAnimating = value; },
  }, urlCardsContainer, urlCardTemplate, urlInput, isDev: import.meta.env.DEV,
  mountImprovementControls: node => mountImprovementControls(node, { state, onChange: updateImprovementPercentage }),
  hasApiKey, openApiKeyDialog, loadDemoSites, getOrderedTrackers, viewTransitionNameForUrl,
  parseUrlSafe, attachTooltipHandlers, beginLabelEditing, hideTooltip, setGlobalDraggingCursor,
  getTransparentDragImage, createDragPreview, clearDropTargets, clearDragCardClasses,
  clearDragPreview, fadeOutDragPreview, reorderTracker, persistState, render,
  describeTrackerStatus, iconMarkup, playSvg, pauseSvg, zapSvg, trashSvg, ICON_BASELINE,
  stopTracker, ensureApiKeyConfigured, startTracker, triggerImmediateCycle, runWithViewTransition,
  openRemoveSiteDialog, renderSummaryTile, renderMetricSummary, renderScoreHistory,
  createConnectedEdgeShadow, positionRunSelection, followRunSeam,
});


document.querySelectorAll(".workspace-tab[data-view]").forEach((button) => {
  button.addEventListener("click", () => switchWorkspaceView(button.dataset.view));
});
document.querySelectorAll(".logo-button, .brand-title-button").forEach((button) => {
  button.addEventListener("click", () => switchWorkspaceView("sites"));
});
document.getElementById("site-search").addEventListener("input", () => renderSiteLibrary(buildRenderContext()));
window.addEventListener("resize", positionSiteSelection);
window.addEventListener("resize", positionSettingsThemeIndicator);
window.addEventListener("resize", () => {
  positionRunSelection();
});

const runLayoutObserver = new ResizeObserver(() => {
  if (state.runDetail) positionRunSelection();
});
runLayoutObserver.observe(document.getElementById("score-history-slot"));
runLayoutObserver.observe(document.getElementById("run-detail-slot"));
function loadDemoSites() {
  const examples = [
    { url: "https://northstar.example/", label: "Demo · Northstar Home", mobile: 78, desktop: 94 },
    { url: "https://northstar.example/products/field-kit", label: "Demo · Field Kit", mobile: 68, desktop: 89 },
    { url: "https://northstar.example/collections/all", label: "Demo · Collection", mobile: 84, desktop: 96 },
    { url: "https://northstar.example/pages/about", label: "Demo · About", mobile: 91, desktop: 98 },
  ];
  for (const [siteIndex, example] of examples.entries()) {
    if (state.trackers.has(example.url)) continue;
    const tracker = createTracker(example.url);
    tracker.label = example.label;
    for (const mode of STRATEGIES) {
      const base = example[mode];
      tracker.history[mode] = Array.from({ length: 12 }, (_, index) => {
        const variation = [1, -3, 2, 0, -1, 3, -2, 1, 0, -1, 2, -2][index];
        const multiplier = (mode === "mobile" ? 1 : 0.58) * (1 + siteIndex * 0.06) * (1 + variation * 0.018);
        const values = { fcp: 1850, si: 2750, lcp: 3100, tbt: 230, cls: 0.075 };
        const metrics = Object.fromEntries(METRICS.map((metric) => [metric.key, {
          value: values[metric.key] * multiplier,
          score: Math.max(0, Math.min(100, base + variation)),
        }]));
        return { timestamp: Date.now() - (11 - index) * 60000, lighthouseFetchTime: null, performanceScore: Math.max(0, Math.min(100, base + variation)), metrics };
      });
    }
    state.trackers.set(tracker.url, tracker);
    state.trackerOrder.push(tracker.url);
  }
  selectedSiteUrl = examples[0].url;
  persistState();
  render();
}

function refreshLiveStatusText() {
  for (const row of document.querySelectorAll(".site-row[data-url]")) {
    const tracker = state.trackers.get(row.dataset.url);
    const status = row.querySelector(".site-status");
    if (tracker && status) {
      status.querySelector(".site-status-text").textContent = `${tracker.running ? "" : "● "}${describeTrackerStatus(tracker)}${state.comparisonBaseUrl === tracker.url ? " · Baseline" : ""}`;
    }
  }
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

function persistState() {
  try {
    persistStoredState({ state, normalizeTrackerOrder, storage: localStorage });
  } catch (error) {
    console.warn("Failed to persist state", error);
  }
}

function hydrateState() {
  try {
    hydrateStoredState({ state, storage: localStorage, apiKeyInput, autoPauseTargetInput,
      FIXED_POLL_INTERVAL_SEC, THEME_MODES, SORTABLE_KEYS, STRATEGIES, normalizeUrl,
      createTracker, normalizeTrackerOrder, hydrateGlimmDevState });
  } catch (error) {
    console.warn("Failed to load saved state", error);
  }
}

hydrateState();
mountImprovementControls(document.getElementById("settings-improvements"), { state, onChange: updateImprovementPercentage });
applyThemeMode();
syncGlimmDevPanel();
scheduleGlimmAutoplay();
updateShopifyPbSuggestion();
for (const tracker of state.trackers.values()) {
  if (tracker.running) {
    const wasAutoPauseArmed = tracker.autoPauseArmed;
    tracker.running = false;
    startTracker(tracker);
    tracker.autoPauseArmed = wasAutoPauseArmed;
    persistState();
  }
}

render();
if (state.trackers.size === 0 && !hasApiKey()) {
  openApiKeyDialog({ onboarding: true });
}
