import { createMeshShader, createNamedropShader, createShader, playSweep } from "glimm";
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

const iconMarkup = (svg) => svg.replace("<svg", '<svg aria-hidden="true"');
for (const [selector, icon] of [
  ['.workspace-tab[data-view="sites"] svg', dashboardSvg],
  ['.workspace-tab[data-view="comparison"] svg', chartSvg],
  ['.theme-mode-button[data-theme-mode="auto"] svg', monitorSvg],
  ['.theme-mode-button[data-theme-mode="light"] svg', sunSvg],
  ['.theme-mode-button[data-theme-mode="dark"] svg', moonSvg],
  ['#api-key-dialog-close svg', closeSvg],
]) {
  const original = document.querySelector(selector);
  if (original) original.outerHTML = iconMarkup(icon);
}

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const STRATEGIES = ["mobile", "desktop"];
const STORAGE_KEY = "pagespeed-tracker-state-v1";
const THEME_MODES = new Set(["auto", "light", "dark"]);
const GLIMM_SHADER_TYPES = new Set(["sweep", "mesh", "namedrop"]);
const GLIMM_PALETTES = new Set(["prism", "berry", "lagoon", "citrus", "azure", "ember"]);
const GLIMM_DIRECTIONS = new Set(["auto", "ltr", "rtl", "ttb", "btt"]);
const GLIMM_EASINGS = new Set([
  "linear",
  "easeOutQuart",
  "easeOutCubic",
  "easeInCubic",
  "easeInOutCubic",
  "easeOutExpo",
  "easeInOutQuint",
  "snap",
  "ease",
  "back",
]);
const GLIMM_DEV_SETTINGS_VERSION = 2;
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
  colorMode: "absolute",
  showDetails: true,
  sort: {
    key: null,
    direction: null,
  },
  runDetail: null,
  themeMode: "auto",
  glimmDev: {
    version: GLIMM_DEV_SETTINGS_VERSION,
    shader: "namedrop",
    lightPalette: "prism",
    darkPalette: "azure",
    direction: "ltr",
    easing: "snap",
    sweepMs: 640,
    outroMs: 620,
    midpoint: 0.37,
    bandTight: 6,
    peakAlpha: 0.78,
    lightBrightness: 1.46,
    darkBrightness: 0.1,
    waveAmount: 0.4,
    rippleAmount: 1.28,
    waveSpeed: 2.13,
    swellAmount: 0.08,
    autoplay: false,
    autoplayDelayMs: 300,
  },
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
const glimmDevPanel = document.getElementById("glimm-dev-panel");
const glimmDevFields = Array.from(document.querySelectorAll("[data-glimm-setting]"));
const glimmDevPreviewButton = document.getElementById("glimm-dev-preview");
const glimmDevAutoplayButton = document.getElementById("glimm-dev-autoplay");
const openSettingsButton = document.getElementById("open-settings");
const apiKeyStatus = document.getElementById("api-key-status");
const setupHint = document.getElementById("setup-hint");
const apiKeyDialog = document.getElementById("api-key-dialog");
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
const TOOLTIP_DELAY_MS = 250;
const TOOLTIP_HIDE_GRACE_MS = 120;
const REMOVE_CONFIRM_LOCKOUT_MS = 1000;
const REMOVE_CONFIRM_ARM_TTL_MS = 10000;
const DRAG_PREVIEW_SCALE = 0.25;
const DRAG_PREVIEW_OFFSET = 10;
const DRAG_PREVIEW_FADE_IN_MS = 90;
const DRAG_PREVIEW_FADE_OUT_MS = 140;
const ICON_BASELINE = iconMarkup(targetSvg);

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
let pendingAddUrlAfterKey = null;
let selectedSiteUrl = null;
let openSiteMenuUrl = null;
let runDetailReturnFocusElement = null;
let suppressLabelBlurCommit = false;
let skipLabelEditRestoreOnNextRender = false;
let pendingBulkAction = null;
let pendingSiteRemovalUrl = null;
let themeSweepController = null;
let themeSweepHandle = null;
let themeSweepShaderType = null;
let glimmAutoplayTimerId = null;
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");


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
  for (const button of themeModeButtons) {
    const isActive = button.dataset.themeMode === mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getThemeSweepDirection(nextTheme) {
  if (GLIMM_DIRECTIONS.has(state.glimmDev.direction) && state.glimmDev.direction !== "auto") {
    return state.glimmDev.direction;
  }
  return nextTheme === "dark" ? "ltr" : "rtl";
}

function getThemeSweepController() {
  const shaderType = GLIMM_SHADER_TYPES.has(state.glimmDev.shader) ? state.glimmDev.shader : "sweep";
  if (themeSweepController && themeSweepShaderType === shaderType) {
    return themeSweepController;
  }

  destroyThemeSweepController();

  const canvas = document.createElement("canvas");
  canvas.className = "theme-sweep-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);

  const shaderOptions = {
    canvas,
    palette: getThemeSweepPalette(getResolvedTheme(state.themeMode)),
    direction: getThemeSweepDirection(getResolvedTheme(state.themeMode)),
    bandTight: state.glimmDev.bandTight,
    brightness: getThemeSweepBrightness(getResolvedTheme(state.themeMode)),
    waveAmount: state.glimmDev.waveAmount,
    rippleAmount: state.glimmDev.rippleAmount,
    waveSpeed: state.glimmDev.waveSpeed,
    swellAmount: state.glimmDev.swellAmount,
  };

  if (shaderType === "mesh") {
    themeSweepController = createMeshShader({
      ...shaderOptions,
      elevation: state.glimmDev.swellAmount * 0.28,
    });
  } else if (shaderType === "namedrop") {
    themeSweepController = createNamedropShader({
      ...shaderOptions,
      travelMode: 1,
      elevation: state.glimmDev.swellAmount * 0.38,
      iridescence: state.glimmDev.swellAmount,
      refractStrength: 0.04,
    });
  } else {
    themeSweepController = createShader(shaderOptions);
  }

  if (!themeSweepController) {
    canvas.remove();
    themeSweepShaderType = null;
  } else {
    themeSweepShaderType = shaderType;
  }

  return themeSweepController;
}

function destroyThemeSweepController() {
  themeSweepHandle?.cancel();
  themeSweepHandle = null;
  themeSweepController?.destroy();
  themeSweepController?.canvas?.remove();
  themeSweepController = null;
  themeSweepShaderType = null;
}

function getThemeSweepPalette(nextTheme) {
  const palette = nextTheme === "dark" ? state.glimmDev.darkPalette : state.glimmDev.lightPalette;
  return GLIMM_PALETTES.has(palette) ? palette : "prism";
}

function getThemeSweepBrightness(nextTheme) {
  return nextTheme === "dark" ? state.glimmDev.darkBrightness : state.glimmDev.lightBrightness;
}

function commitThemeMode(mode) {
  state.themeMode = mode;
  applyThemeMode();
  persistState();
  render();
}

function setThemeModeWithSweep(mode) {
  if (!THEME_MODES.has(mode) || mode === state.themeMode) {
    return;
  }

  const previousTheme = getResolvedTheme(state.themeMode);
  const nextTheme = getResolvedTheme(mode);
  if (previousTheme === nextTheme || prefersReducedMotion()) {
    commitThemeMode(mode);
    return;
  }

  const ctrl = getThemeSweepController();
  if (!ctrl) {
    commitThemeMode(mode);
    return;
  }

  themeSweepHandle?.cancel();
  ctrl.setDirection(getThemeSweepDirection(nextTheme));
  ctrl.setBrightness(getThemeSweepBrightness(nextTheme));
  ctrl.setBandTight(state.glimmDev.bandTight);
  ctrl.setWaveAmount(state.glimmDev.waveAmount);
  ctrl.setRippleAmount(state.glimmDev.rippleAmount);
  ctrl.setWaveSpeed(state.glimmDev.waveSpeed);
  ctrl.setSwellAmount(state.glimmDev.swellAmount);

  themeSweepHandle = playSweep(ctrl, {
    palette: getThemeSweepPalette(nextTheme),
    direction: getThemeSweepDirection(nextTheme),
    sweepMs: state.glimmDev.sweepMs,
    outroMs: state.glimmDev.outroMs,
    midpoint: state.glimmDev.midpoint,
    easing: GLIMM_EASINGS.has(state.glimmDev.easing) ? state.glimmDev.easing : "easeOutQuart",
    bandTight: state.glimmDev.bandTight,
    peakAlpha: state.glimmDev.peakAlpha,
    brightness: getThemeSweepBrightness(nextTheme),
    waveAmount: state.glimmDev.waveAmount,
    rippleAmount: state.glimmDev.rippleAmount,
    waveSpeed: state.glimmDev.waveSpeed,
    swellAmount: state.glimmDev.swellAmount,
    onMidpoint: () => commitThemeMode(mode),
    onComplete: () => {
      themeSweepHandle = null;
    },
  });
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatGlimmOutputValue(key, value) {
  if (key.endsWith("Ms")) {
    return `${Math.round(value)}ms`;
  }
  if (key === "bandTight") {
    return String(Math.round(value));
  }
  return Number(value).toFixed(2);
}

function syncGlimmDevPanel() {
  for (const field of glimmDevFields) {
    const key = field.dataset.glimmSetting;
    if (!key || !(key in state.glimmDev)) {
      continue;
    }
    field.value = String(state.glimmDev[key]);
  }

  for (const output of document.querySelectorAll("[data-glimm-output]")) {
    const key = output.dataset.glimmOutput;
    if (!key || !(key in state.glimmDev)) {
      continue;
    }
    output.value = formatGlimmOutputValue(key, state.glimmDev[key]);
    output.textContent = output.value;
  }

  if (glimmDevAutoplayButton) {
    glimmDevAutoplayButton.textContent = state.glimmDev.autoplay ? "Stop autoplay" : "Start autoplay";
    glimmDevAutoplayButton.classList.toggle("is-active", state.glimmDev.autoplay);
  }
}

function updateGlimmDevSetting(field) {
  const key = field.dataset.glimmSetting;
  if (!key || !(key in state.glimmDev)) {
    return;
  }

  const previousShader = state.glimmDev.shader;
  state.glimmDev.version = GLIMM_DEV_SETTINGS_VERSION;
  const rawValue = field.value;
  if (key === "shader" && GLIMM_SHADER_TYPES.has(rawValue)) {
    state.glimmDev.shader = rawValue;
  } else if ((key === "lightPalette" || key === "darkPalette") && GLIMM_PALETTES.has(rawValue)) {
    state.glimmDev[key] = rawValue;
  } else if (key === "direction" && GLIMM_DIRECTIONS.has(rawValue)) {
    state.glimmDev.direction = rawValue;
  } else if (key === "easing" && GLIMM_EASINGS.has(rawValue)) {
    state.glimmDev.easing = rawValue;
  } else {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      return;
    }
    const min = Number(field.min);
    const max = Number(field.max);
    state.glimmDev[key] = Number.isFinite(min) && Number.isFinite(max)
      ? clampNumber(value, min, max)
      : value;
  }

  if (previousShader !== state.glimmDev.shader) {
    destroyThemeSweepController();
  }
  syncGlimmDevPanel();
  scheduleGlimmAutoplay();
  persistState();
}

function previewGlimmThemeSweep() {
  const currentTheme = getResolvedTheme(state.themeMode);
  setThemeModeWithSweep(currentTheme === "dark" ? "light" : "dark");
}

function scheduleGlimmAutoplay() {
  if (glimmAutoplayTimerId) {
    clearTimeout(glimmAutoplayTimerId);
    glimmAutoplayTimerId = null;
  }
  if (!state.glimmDev.autoplay) {
    return;
  }

  const delay = state.glimmDev.sweepMs + state.glimmDev.outroMs + state.glimmDev.autoplayDelayMs;
  glimmAutoplayTimerId = setTimeout(() => {
    previewGlimmThemeSweep();
    scheduleGlimmAutoplay();
  }, delay);
}

function hydrateGlimmDevState(settings) {
  if (settings.version !== GLIMM_DEV_SETTINGS_VERSION) {
    return;
  }

  if (typeof settings.shader === "string" && GLIMM_SHADER_TYPES.has(settings.shader)) {
    state.glimmDev.shader = settings.shader;
  }
  if (typeof settings.lightPalette === "string" && GLIMM_PALETTES.has(settings.lightPalette)) {
    state.glimmDev.lightPalette = settings.lightPalette;
  }
  if (typeof settings.darkPalette === "string" && GLIMM_PALETTES.has(settings.darkPalette)) {
    state.glimmDev.darkPalette = settings.darkPalette;
  }
  if (typeof settings.direction === "string" && GLIMM_DIRECTIONS.has(settings.direction)) {
    state.glimmDev.direction = settings.direction;
  }
  if (typeof settings.easing === "string" && GLIMM_EASINGS.has(settings.easing)) {
    state.glimmDev.easing = settings.easing;
  }

  const numericSettings = {
    sweepMs: [180, 1800],
    outroMs: [0, 1400],
    midpoint: [0.15, 0.85],
    bandTight: [3, 28],
    peakAlpha: [0.1, 1.5],
    lightBrightness: [0.1, 1.5],
    darkBrightness: [0.1, 1.5],
    waveAmount: [0, 2],
    rippleAmount: [0, 2],
    waveSpeed: [0, 3],
    swellAmount: [0, 1],
    autoplayDelayMs: [300, 4000],
  };
  for (const [key, [min, max]] of Object.entries(numericSettings)) {
    const value = Number(settings[key]);
    if (Number.isFinite(value)) {
      state.glimmDev[key] = clampNumber(value, min, max);
    }
  }
}

runDetailCloseButton?.addEventListener("click", () => {
  closeRunDetailPanel();
});
colorModeButton.dataset.tooltip = document.getElementById("color-mode-description").textContent;
attachTooltipHandlers(colorModeButton);
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
    if (!THEME_MODES.has(requestedMode)) {
      return;
    }
    setThemeModeWithSweep(requestedMode);
  });
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
  if (syncConfigFromInputs()) {
    const pendingUrl = pendingAddUrlAfterKey;
    pendingAddUrlAfterKey = null;
    closeApiKeyDialog();
    if (pendingUrl) {
      addTrackerAndStart(pendingUrl);
    } else {
      render();
    }
  }
});

addUrlForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const cleanedUrl = normalizeUrl(urlInput.value.trim());
  if (!cleanedUrl) {
    window.alert("Please enter a valid URL including protocol (https://...).");
    return;
  }

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

openSettingsButton?.addEventListener("click", () => {
  openApiKeyDialog();
});

apiKeyDialogCloseButton?.addEventListener("click", () => {
  closeApiKeyDialog();
});
skipSetupButton?.addEventListener("click", closeApiKeyDialog);

apiKeyDialog?.addEventListener("click", (event) => {
  if (event.target === apiKeyDialog) {
    closeApiKeyDialog();
  }
});

apiKeyDialog?.addEventListener("close", () => {
  pendingAddUrlAfterKey = null;
  apiKeyInput.value = state.apiKey;
  updateApiKeyUi();
});

clearApiKeyButton?.addEventListener("click", () => {
  state.apiKey = "";
  apiKeyInput.value = "";
  persistState();
  render();
  apiKeyInput.focus();
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
    : "Delete every tracked site and its run history. Tracking will stop. Your API key and appearance settings stay in this browser.";
  bulkActionConfirm.textContent = clearRuns ? "Clear Runs" : "Delete All Sites";
  bulkActionDialog.showModal();
  document.getElementById("bulk-action-cancel").focus();
}

function openRemoveSiteDialog(tracker) {
  hideTooltip();
  pendingBulkAction = "remove-site";
  pendingSiteRemovalUrl = tracker.url;
  bulkActionTitle.textContent = "Remove site?";
  bulkActionDescription.textContent = `Remove ${tracker.label || tracker.url} and its saved run history? Tracking will stop.`;
  bulkActionConfirm.textContent = "Remove Site";
  bulkActionDialog.showModal();
  document.getElementById("bulk-action-cancel").focus();
}

clearRunsButton.addEventListener("click", () => openBulkActionDialog("clear-runs"));
deleteAllSitesButton.addEventListener("click", () => openBulkActionDialog("delete-sites"));
document.getElementById("bulk-action-cancel").addEventListener("click", () => bulkActionDialog.close());
bulkActionDialog.addEventListener("close", () => { pendingBulkAction = null; pendingSiteRemovalUrl = null; });
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
  for (const tracker of state.trackers.values()) {
    tracker.historyVersion += 1;
    if (action === "clear-runs") {
      tracker.history = { mobile: [], desktop: [] };
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
    apiKeyInput.focus();
    apiKeyInput.reportValidity();
    return false;
  }

  state.apiKey = key;
  state.pollIntervalSec = FIXED_POLL_INTERVAL_SEC;

  persistState();
  return true;
}

function hasApiKey() {
  return Boolean(state.apiKey.trim());
}

function openApiKeyDialog(options = {}) {
  if (!apiKeyDialog) {
    return;
  }
  pendingAddUrlAfterKey = options.pendingUrl || null;
  const onboarding = options.onboarding === true;
  document.getElementById("api-key-dialog-title").textContent = onboarding ? "Welcome to PageSpeeder" : "Google PageSpeed API key";
  document.getElementById("api-key-intro").hidden = !onboarding;
  skipSetupButton.hidden = !onboarding;
  clearApiKeyButton.hidden = onboarding;
  apiKeyInput.value = state.apiKey;
  if (saveApiKeyButton) {
    saveApiKeyButton.textContent = pendingAddUrlAfterKey ? "Save Key & Start" : onboarding ? "Save and continue" : "Save Key";
  }
  if (!apiKeyDialog.open) {
    apiKeyDialog.showModal();
  }
  requestAnimationFrame(() => {
    apiKeyInput.focus();
    apiKeyInput.select();
  });
}

function closeApiKeyDialog() {
  if (apiKeyDialog?.open) {
    apiKeyDialog.close();
  }
}

function ensureApiKeyConfigured() {
  if (hasApiKey()) {
    return true;
  }
  openApiKeyDialog();
  return false;
}

function updateApiKeyUi() {
  const configured = hasApiKey();
  if (apiKeyStatus) {
    apiKeyStatus.textContent = configured ? "Saved" : "Not set";
  }
  openSettingsButton?.classList.toggle("is-configured", configured);
  if (setupHint) {
    setupHint.textContent = configured
      ? "Runs use your saved key from this browser."
      : "Add your Google PageSpeed API key before the first run.";
    setupHint.classList.toggle("is-ready", configured);
  }
  if (clearApiKeyButton) {
    clearApiKeyButton.disabled = !configured;
  }
}

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
      tracker.lastError = "";
      persistState();
    } catch (error) {
      if (tracker.historyVersion !== historyVersion) return;
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
  const contributionTooltip = `${SCORING_MODEL_VERSION} weighted contribution to the 100-point performance score. The measured metric is shown underneath.`;
  pointsLine.dataset.tooltip = contributionTooltip;
  pointsLine.title = contributionTooltip;
  pointsLine.setAttribute(
    "aria-label",
    `${contribution.points} out of ${contribution.outOf.replace("/", "")} weighted points. ${metric.format(value)} measured.`,
  );
  attachTooltipHandlers(pointsLine);

  const pointsBig = document.createElement("span");
  pointsBig.className = "metric-points-big";
  pointsBig.textContent = contribution.points;
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

function createPaneProgress(value, color) {
  const track = document.createElement("span");
  track.className = "pane-progress";
  track.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  fill.className = "pane-progress-fill";
  fill.style.width = `${Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))}%`;
  fill.style.backgroundColor = color;
  track.append(fill);
  return track;
}

function metricProgress(metric, value, mode, color) {
  const contribution = metricContribution(mode, metric.key, value);
  return createPaneProgress(contribution ? (contribution.points / contribution.maxPoints) * 100 : 0, color);
}

function getScorePalette(kind = "surface") {
  const isDark = document.documentElement.dataset.theme === "dark";
  const bar = isDark
    ? { low: [239, 133, 130], mid: [243, 189, 96], high: [99, 200, 161], neutral: [154, 164, 178] }
    : { low: [225, 100, 100], mid: [217, 154, 43], high: [50, 166, 124], neutral: [137, 148, 162] };
  if (kind === "bar") return bar;

  // Use the same hues as the site bars, softened against the page surface.
  const canvas = isDark ? [34, 38, 45] : [255, 255, 255];
  const strength = isDark ? 0.4 : 0.36;
  return Object.fromEntries(Object.entries(bar).map(([key, color]) => [
    key,
    color.map((channel, index) => Math.round(canvas[index] + (channel - canvas[index]) * strength)),
  ]));
}

function percentileColor(percentile, kind = "surface") {
  if (!Number.isFinite(percentile)) {
    return "";
  }

  const { low, mid, high } = getScorePalette(kind);
  const p = Math.max(0, Math.min(100, percentile));

  if (p <= 50) {
    return mixColor(low, mid, p / 50);
  }
  return mixColor(mid, high, (p - 50) / 50);
}

function absoluteScoreColor(score, kind = "surface") {
  if (!Number.isFinite(score)) return "";
  const { low, mid, high } = getScorePalette(kind);
  if (score <= 50) return mixColor(low, low, 0);
  if (score <= 70) return mixColor(low, mid, (score - 50) / 20);
  return mixColor(mid, high, (score - 70) / 20);
}

function relativeDeltaColor(delta, maxAbsDelta, kind = "surface") {
  if (!Number.isFinite(delta)) {
    return "";
  }
  const { low, neutral, high } = getScorePalette(kind);
  if (!Number.isFinite(maxAbsDelta) || maxAbsDelta <= 0) {
    return mixColor(neutral, neutral, 0);
  }
  const ratio = Math.max(-1, Math.min(1, delta / maxAbsDelta));
  if (ratio >= 0) {
    return mixColor(neutral, high, ratio);
  }
  return mixColor(neutral, low, Math.abs(ratio));
}

function getSummaryBackgroundColor(mode, avgScore, renderContext, kind = "surface") {
  if (state.colorMode === "absolute") return absoluteScoreColor(avgScore, kind);
  const baselineSummary = renderContext.baselineSummariesByMode?.[mode] || null;
  if (baselineSummary && Number.isFinite(avgScore) && Number.isFinite(baselineSummary.avgScore)) {
    return relativeDeltaColor(
      avgScore - baselineSummary.avgScore,
      renderContext.deltaScales.summaryByMode?.[mode] || 0,
      kind,
    );
  }
  const percentile = getPercentile(renderContext.scoreSummaryPopulationByMode[mode], avgScore, true);
  return percentileColor(percentile, kind);
}

function getRunBackgroundColor(mode, score, renderContext, kind = "surface") {
  if (state.colorMode === "absolute") return absoluteScoreColor(score, kind);
  const baselineSummary = renderContext.baselineSummariesByMode?.[mode] || null;
  if (baselineSummary && Number.isFinite(score) && Number.isFinite(baselineSummary.avgScore)) {
    return relativeDeltaColor(
      score - baselineSummary.avgScore,
      renderContext.deltaScales.runByMode?.[mode] || 0,
      kind,
    );
  }
  const percentile = getPercentile(renderContext.runScorePopulationByMode[mode], score, true);
  return percentileColor(percentile, kind);
}

function getMetricBackgroundColor(mode, metricKey, metricValue, renderContext, kind = "surface") {
  if (state.colorMode === "absolute") {
    const contribution = metricContribution(mode, metricKey, metricValue);
    return absoluteScoreColor(contribution ? (contribution.points / contribution.maxPoints) * 100 : null, kind);
  }
  const baselineSummary = renderContext.baselineSummariesByMode?.[mode] || null;
  const baselineMetric = baselineSummary?.metrics?.[metricKey] || null;
  if (baselineMetric) {
    const currentContribution = metricContribution(mode, metricKey, metricValue);
    const baselineContribution = metricContribution(mode, metricKey, baselineMetric.avgValue);
    if (currentContribution && baselineContribution) {
      return relativeDeltaColor(
        currentContribution.points - baselineContribution.points,
        renderContext.deltaScales.metricByMode?.[mode]?.[metricKey] || 0,
        kind,
      );
    }
  }

  const pointsForColor = contributionPointsForDisplay(mode, metricKey, metricValue);
  const percentile = getPercentile(
    renderContext.metricPopulationsByMode[mode][metricKey],
    pointsForColor,
    true,
  );
  return percentileColor(percentile, kind);
}

function parseRgbColor(color) {
  const match = color.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
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

function renderSummaryTile(tile, summary, mode, renderContext, options = {}) {
  const {
    baselineSummary = null,
    isBaselineCard = false,
  } = options;
  const scoreNode = tile.querySelector(".tile-score");
  const metaNode = tile.querySelector(".tile-meta");
  tile.style.backgroundColor = "";
  tile.style.borderColor = "";
  tile.querySelector(".pane-progress")?.remove();

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
  const formatRuns = (count) => `${count} run${count === 1 ? "" : "s"}`;
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
  let subLine = "stat sig ±2 in ? runs";
  if (requiredRuns !== null && requiredRunsTight !== null) {
    if (moreRuns > 0) {
      subLine = `stat sig ±2 in ${formatRuns(moreRuns)}`;
    } else if (moreRunsTight > 0) {
      subLine = `stat sig ±1 in ${formatRuns(moreRunsTight)}`;
    } else {
      subLine = "stat sig ±1 ✅";
    }
  }

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

  tile.querySelector(".tile-label").after(createPaneProgress(summary.avgScore, getSummaryBackgroundColor(mode, summary.avgScore, renderContext, "bar")));
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
      const mobileCellColor = getMetricBackgroundColor(
        "mobile",
        metric.key,
        mobileMetric.avgValue,
        renderContext, "bar",
      );
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
      mobileCell.querySelector(".metric-cell").prepend(metricProgress(metric, mobileMetric.avgValue, "mobile", mobileCellColor));
    }
    row.append(mobileCell);

    const desktopCell = document.createElement("td");
    const desktopMetric = desktopSummary?.metrics?.[metric.key];
    if (!desktopMetric) {
      desktopCell.textContent = "--";
    } else {
      const desktopCellColor = getMetricBackgroundColor(
        "desktop",
        metric.key,
        desktopMetric.avgValue,
        renderContext, "bar",
      );
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
      desktopCell.querySelector(".metric-cell").prepend(metricProgress(metric, desktopMetric.avgValue, "desktop", desktopCellColor));
    }
    row.append(desktopCell);

    tbody.append(row);
  }
}

function closeRunDetailPanel() {
  const returnFocus = runDetailReturnFocusElement;
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

function setWorkspaceView(view) {
  if (view !== "sites" && state.runDetail) closeRunDetailPanel();
  document.getElementById("sites-view").hidden = view !== "sites";
  document.getElementById("comparison-view").hidden = view !== "comparison";
  document.body.classList.toggle("comparison-active", view === "comparison");
  const library = document.querySelector(".site-library");
  const addPanel = document.querySelector(".library-add");
  const comparisonAddSlot = document.getElementById("comparison-add-slot");
  (view === "comparison" ? comparisonAddSlot : library).append(addPanel);
  comparisonAddSlot.hidden = view !== "comparison";
  library.inert = view !== "sites";
  library.setAttribute("aria-hidden", view === "sites" ? "false" : "true");
  document.querySelectorAll(".workspace-tab[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("selected", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (view === "sites") requestAnimationFrame(positionSiteSelection);
}

let workspaceTransition = null;
function switchWorkspaceView(view) {
  const currentView = document.body.classList.contains("comparison-active") ? "comparison" : "sites";
  if (view === currentView) return;
  if (typeof document.startViewTransition !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.body.classList.contains("keyboard-input")) {
    setWorkspaceView(view);
    return;
  }
  document.body.classList.add("moving-add-panel");
  const transition = document.startViewTransition(() => setWorkspaceView(view));
  workspaceTransition = transition;
  transition.finished.finally(() => {
    if (workspaceTransition === transition) {
      workspaceTransition = null;
      document.body.classList.remove("moving-add-panel");
    }
  }).catch(() => {});
}

document.querySelectorAll(".workspace-tab[data-view]").forEach((button) => {
  button.addEventListener("click", () => switchWorkspaceView(button.dataset.view));
});
document.getElementById("site-search").addEventListener("input", () => renderSiteLibrary(buildRenderContext()));
window.addEventListener("resize", positionSiteSelection);
window.addEventListener("resize", () => {
  positionRunSelection();
});

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
  detailSlot.style.setProperty("--run-seam-top", `${rowBounds.top - detailBounds.top}px`);
  detailSlot.style.setProperty("--run-seam-height", `${rowBounds.height}px`);
  updateConnectedEdgeShadow(slot, rowBounds.top - slotBounds.top, rowBounds.bottom - slotBounds.top, rowBounds.left - slotBounds.left);
}

function followRunSeam(selection) {
  syncRunSeam(selection);
  if (selection.isConnected && selection.getAnimations().some((animation) => animation.playState === "running")) {
    requestAnimationFrame(() => followRunSeam(selection));
  }
}

const libraryAdd = document.querySelector(".library-add");
const library = document.querySelector(".site-library");
createConnectedEdgeShadow(library, "site-edge");
new ResizeObserver(() => {
  library.style.setProperty("--add-panel-height", `${libraryAdd.offsetHeight}px`);
  document.querySelector("main").style.setProperty("--add-panel-height", `${libraryAdd.offsetHeight}px`);
}).observe(libraryAdd);
new ResizeObserver(positionSiteSelection).observe(library);
document.getElementById("site-list").addEventListener("scroll", syncSiteSeam, { passive: true });
document.getElementById("site-selection").addEventListener("transitionrun", (event) => {
  if (event.propertyName === "transform") followSiteSeam(event.currentTarget);
});

function syncSiteSeam() {
  const selection = document.getElementById("site-selection");
  if (selection.hidden) return;
  const bounds = selection.getBoundingClientRect();
  const libraryBounds = library.getBoundingClientRect();
  updateConnectedEdgeShadow(library, bounds.top - libraryBounds.top, bounds.bottom - libraryBounds.top);
}

function createConnectedEdgeShadow(container, id) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("connected-edge-shadow");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<defs><filter id="${id}-filter" filterUnits="userSpaceOnUse" x="-160" y="-40" width="400"><feGaussianBlur in="SourceAlpha" stdDeviation="2.5" result="blur1"/><feOffset in="blur1" dy="2" result="offset1"/><feFlood flood-color="#101828" flood-opacity=".06" result="color1"/><feComposite in="color1" in2="offset1" operator="in" result="shadow1"/><feGaussianBlur in="SourceAlpha" stdDeviation="1" result="blur2"/><feOffset in="blur2" dy="1" result="offset2"/><feFlood flood-color="#101828" flood-opacity=".04" result="color2"/><feComposite in="color2" in2="offset2" operator="in" result="shadow2"/><feMerge><feMergeNode in="shadow1"/><feMergeNode in="shadow2"/></feMerge></filter><mask id="${id}-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="32"><rect x="0" y="0" width="32" fill="white"/><path fill="black"/></mask></defs><path fill="white" filter="url(#${id}-filter)" mask="url(#${id}-mask)"/>`;
  if (id === "run-edge") {
    const outline = svg.lastElementChild;
    outline.removeAttribute("filter");
    outline.removeAttribute("mask");
    outline.setAttribute("fill", "none");
    outline.setAttribute("stroke", "var(--run-outline)");
    outline.setAttribute("stroke-width", "4");
  }
  container.append(svg);
}

function updateConnectedEdgeShadow(container, top, bottom, tabLeft = null) {
  const svg = container.querySelector(".connected-edge-shadow");
  if (!svg) return;
  const height = container.clientHeight;
  if (!height) return;
  const runOutline = tabLeft !== null;
  const width = runOutline ? container.clientWidth + 8 : 32;
  const seamX = runOutline ? width - 6 : width;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.querySelector("filter").setAttribute("height", height + 80);
  svg.querySelector("mask").setAttribute("height", height);
  svg.querySelector("mask").setAttribute("width", width);
  svg.querySelector("mask rect").setAttribute("height", height);
  svg.querySelector("mask rect").setAttribute("width", width);
  const hasTab = bottom > 18 && top < height && top >= 18;
  const edge = hasTab && runOutline
    ? `V ${bottom + 18} Q ${width} ${bottom} ${width - 18} ${bottom} H ${tabLeft + 16} Q ${tabLeft} ${bottom} ${tabLeft} ${bottom - 16} V ${top + 16} Q ${tabLeft} ${top} ${tabLeft + 16} ${top} H ${width - 18} Q ${width} ${top} ${width} ${top - 18}`
    : hasTab
      ? `V ${bottom + 18} Q 32 ${bottom} 14 ${bottom} H -120 V ${top} H 14 Q 32 ${top} 32 ${top - 18}`
      : "";
  const bottomEdge = runOutline ? `V ${height} H ${width + 18} Q ${width} ${height} ${width} ${height - 18}` : `V ${height + 20} H ${width}`;
  const path = `M ${width + 18} 0 H ${width + 168} ${bottomEdge} ${edge} V 18 Q ${width} 0 ${width + 18} 0 Z`;
  svg.querySelector("mask path").setAttribute("d", path);
  const tabOutline = hasTab && runOutline
    ? `M ${seamX} ${top - 22} V ${top - 18} Q ${seamX} ${top} ${seamX - 18} ${top} H ${tabLeft + 16} Q ${tabLeft} ${top} ${tabLeft} ${top + 16} V ${bottom - 16} Q ${tabLeft} ${bottom} ${tabLeft + 16} ${bottom} H ${seamX - 18} Q ${seamX} ${bottom} ${seamX} ${bottom + 18} V ${bottom + 22}`
    : "";
  svg.lastElementChild.setAttribute("d", runOutline ? tabOutline : path);
}

function followSiteSeam(selection) {
  syncSiteSeam();
  if (!selection.hidden && selection.getAnimations().some((animation) => animation.playState === "running")) {
    requestAnimationFrame(() => followSiteSeam(selection));
  }
}

function positionSiteSelection() {
  const list = document.getElementById("site-list");
  const selection = document.getElementById("site-selection");
  const selected = list.querySelector(".site-row.is-selected");
  if (!selected || !list.getClientRects().length) {
    selection.hidden = true;
    return;
  }
  const listBounds = list.getBoundingClientRect();
  const rowBounds = selected.getBoundingClientRect();
  selection.style.height = `${rowBounds.height}px`;
  selection.style.transform = `translateY(${rowBounds.top - listBounds.top + list.scrollTop}px)`;
  selection.hidden = false;
  syncSiteSeam();
}

function renderSiteLibrary(renderContext) {
  const list = document.getElementById("site-list");
  const rows = document.getElementById("site-list-rows");
  const query = document.getElementById("site-search").value.trim().toLowerCase();
  if (!state.trackers.has(selectedSiteUrl)) selectedSiteUrl = getOrderedTrackerUrls()[0] || null;
  document.getElementById("site-count").textContent = `${state.trackers.size} ${state.trackers.size === 1 ? "site" : "sites"} · ${Array.from(state.trackers.values()).filter((tracker) => tracker.running).length} running`;
  rows.replaceChildren();
  const matches = getOrderedTrackers().filter((tracker) => `${tracker.label} ${tracker.url}`.toLowerCase().includes(query));
  for (const tracker of matches) {
    const row = document.createElement("div");
    row.className = "site-row";
    row.dataset.url = tracker.url;
    row.classList.toggle("is-selected", tracker.url === selectedSiteUrl);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "site-item";
    button.draggable = true;
    button.title = "Drag to reorder";
    if (tracker.url === selectedSiteUrl) button.setAttribute("aria-current", "page");
    const copy = document.createElement("span");
    copy.className = "site-item-copy";
    const name = document.createElement("strong");
    name.textContent = tracker.label || (parseUrlSafe(tracker.url)?.hostname ?? tracker.url);
    const status = document.createElement("small");
    const summaries = renderContext.summariesByUrl.get(tracker.url) || {};
    const mobile = summaries.mobile?.avgScore;
    const desktop = summaries.desktop?.avgScore;
    status.textContent = `● ${describeTrackerStatus(tracker)}${state.comparisonBaseUrl === tracker.url ? " · Baseline" : ""}`;
    status.className = `site-status${tracker.running ? " is-running" : ""}`;
    copy.append(name, status);
    const scores = document.createElement("span");
    scores.className = "site-item-scores";
    for (const [mode, score] of [["Mobile", mobile], ["Desktop", desktop]]) {
      const summary = summaries[mode.toLowerCase()];
      const value = document.createElement("span");
      const bar = document.createElement("span");
      bar.className = "site-score-track";
      const fill = document.createElement("span");
      fill.className = "site-score-fill";
      if (Number.isFinite(score)) {
        fill.style.width = `${Math.max(0, Math.min(100, score))}%`;
        fill.style.backgroundColor = getSummaryBackgroundColor(mode.toLowerCase(), score, renderContext, "bar");
      }
      bar.append(fill);
      const scoreLine = document.createElement("span");
      scoreLine.className = "site-score-line";
      const number = document.createElement("strong");
      number.textContent = Number.isFinite(score) ? score.toFixed(1) : "–";
      const confidence = document.createElement("small");
      confidence.textContent = summary && summary.ci95HalfWidth !== null ? `±${summary.ci95HalfWidth.toFixed(1)}` : "";
      scoreLine.append(number, confidence);
      const info = document.createElement("small");
      info.textContent = summary ? `${summary.samples} ${summary.samples === 1 ? "run" : "runs"}` : "No runs";
      value.append(bar, scoreLine, info);
      if (summary) {
        const estimate = document.createElement("small");
        const required = summary.samples < 2 ? null : Math.max(MIN_STAT_SIG_SAMPLES, Math.ceil(((1.96 * summary.scoreStdDev) / TARGET_CI_HALF_WIDTH_POINTS) ** 2));
        const tight = summary.samples < 2 ? null : Math.max(MIN_STAT_SIG_SAMPLES, Math.ceil(((1.96 * summary.scoreStdDev) / SECONDARY_CI_HALF_WIDTH_POINTS) ** 2));
        estimate.textContent = required === null ? "±2 in ? runs" : summary.samples < required ? `±2 in ${required - summary.samples} runs` : summary.samples < tight ? `±1 in ${tight - summary.samples} runs` : "±1 reached";
        value.append(estimate);
      }
      value.setAttribute("aria-label", `${mode} average ${Number.isFinite(score) ? score.toFixed(1) : "not available"}; ${Array.from(value.querySelectorAll("small"), (item) => item.textContent).join("; ")}`);
      scores.append(value);
    }
    button.append(copy, scores);
    button.addEventListener("click", () => {
      if (state.runDetail && state.runDetail.url !== tracker.url) closeRunDetailPanel();
      selectedSiteUrl = tracker.url;
      openSiteMenuUrl = null;
      setWorkspaceView("sites");
      render();
      document.querySelector('.site-item[aria-current="page"]')?.focus({ preventScroll: true });
    });
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", tracker.url);
    });
    button.addEventListener("dragover", (event) => event.preventDefault());
    button.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = event.dataTransfer.getData("text/plain");
      if (state.trackers.has(from) && from !== tracker.url) reorderTracker(from, tracker.url);
    });
    const actions = document.createElement("div");
    actions.className = "site-row-actions";
    const menu = document.createElement("details");
    menu.className = "site-menu";
    menu.open = openSiteMenuUrl === tracker.url;
    const menuTrigger = document.createElement("summary");
    menuTrigger.innerHTML = iconMarkup(ellipsisSvg);
    menuTrigger.setAttribute("aria-label", `More actions: ${tracker.label || tracker.url}`);
    menu.append(menuTrigger);
    const menuItems = document.createElement("div");
    menuItems.className = "site-menu-items";
    menu.append(menuItems);
    menu.addEventListener("toggle", () => {
      if (!menu.isConnected) return;
      if (menu.open) {
        document.querySelectorAll(".site-menu[open]").forEach((other) => {
          if (other !== menu) other.open = false;
        });
        openSiteMenuUrl = tracker.url;
      }
      else if (openSiteMenuUrl === tracker.url) openSiteMenuUrl = null;
    });
    const addAction = (label, handler, options = {}) => {
      const action = document.createElement("button");
      action.type = "button";
      action.className = `site-action${options.className ? ` ${options.className}` : ""}`;
      if (options.icon) action.innerHTML = options.icon;
      else action.textContent = label;
      action.setAttribute("aria-label", `${label}: ${tracker.label || tracker.url}`);
      if (typeof options.pressed === "boolean") action.setAttribute("aria-pressed", String(options.pressed));
      action.title = label;
      action.disabled = Boolean(options.disabled);
      action.addEventListener("click", handler);
      (options.leading ? row : options.menu ? menuItems : actions).append(action);
    };
    const playIcon = iconMarkup(playSvg);
    const pauseIcon = iconMarkup(pauseSvg);
    addAction(tracker.running ? "Pause" : "Resume", () => {
      if (tracker.running) stopTracker(tracker);
      else if (ensureApiKeyConfigured()) startTracker(tracker, true);
      render();
    }, { icon: tracker.running ? pauseIcon : playIcon, className: "site-run-toggle", leading: true });
    addAction(state.comparisonBaseUrl === tracker.url ? "Clear baseline" : "Set baseline", () => {
      state.comparisonBaseUrl = state.comparisonBaseUrl === tracker.url ? null : tracker.url;
      openSiteMenuUrl = null;
      persistState();
      render();
    }, { icon: ICON_BASELINE, className: state.comparisonBaseUrl === tracker.url ? "is-baseline" : "", pressed: state.comparisonBaseUrl === tracker.url });
    addAction("Edit label", () => {
      if (state.runDetail && state.runDetail.url !== tracker.url) closeRunDetailPanel();
      selectedSiteUrl = tracker.url;
      openSiteMenuUrl = null;
      setWorkspaceView("sites");
      render();
      beginLabelEditing(tracker.url);
    }, { menu: true });
    addAction("Remove", () => {
      menu.open = false;
      openSiteMenuUrl = null;
      openRemoveSiteDialog(tracker);
    }, { menu: true, className: "remove" });
    actions.append(menu);
    row.append(button, actions);
    if (tracker.lastError) {
      const error = document.createElement("p");
      error.className = "site-row-error";
      error.textContent = tracker.lastError;
      row.append(error);
    }
    rows.append(row);
  }
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "library-empty";
    empty.textContent = query ? "No sites found." : "Your tracked sites will appear here.";
    rows.append(empty);
  }
  positionSiteSelection();
}

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

function renderCards(renderContext) {
  const scrollByUrl = new Map();
  const historySlot = document.getElementById("score-history-slot");
  const existingScroller = historySlot.querySelector(".score-history-scroll");
  if (existingScroller && historySlot.dataset.url) scrollByUrl.set(historySlot.dataset.url, existingScroller.scrollTop);
  historySlot.replaceChildren();
  historySlot.dataset.url = "";

  urlCardsContainer.innerHTML = "";

  if (!state.trackers.size) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const title = document.createElement("h3");
    title.textContent = "No sites yet";
    const copy = document.createElement("p");
    copy.textContent = hasApiKey()
      ? "Add a URL below to start collecting mobile and desktop results."
      : "Add your API key, then enter a URL below to start tracking performance.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = hasApiKey() ? "secondary" : "";
    button.textContent = hasApiKey() ? "Focus URL Field" : "Add API Key";
    button.addEventListener("click", () => {
      if (hasApiKey()) {
        urlInput.focus();
        return;
      }
      openApiKeyDialog();
    });
    empty.append(title, copy, button);
    if (import.meta.env.DEV) {
      const demoButton = document.createElement("button");
      demoButton.type = "button";
      demoButton.className = "secondary demo-button";
      demoButton.textContent = "Load demo sites";
      demoButton.addEventListener("click", loadDemoSites);
      empty.append(demoButton);
    }
    urlCardsContainer.append(empty);
    return;
  }

  const baseUrl = state.comparisonBaseUrl;
  const baseSummaries = baseUrl ? (renderContext.summariesByUrl.get(baseUrl) || null) : null;

  for (const tracker of getOrderedTrackers()) {
    if (tracker.url !== selectedSiteUrl) continue;
    const card = urlCardTemplate.content.firstElementChild.cloneNode(true);
    const isBaseCard = state.comparisonBaseUrl === tracker.url;
    card.dataset.url = tracker.url;
    card.style.viewTransitionName = viewTransitionNameForUrl(tracker.url);
    card.classList.toggle("comparison-base", isBaseCard);

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
    labelLine.textContent = hasLabel ? tracker.label : (parseUrlSafe(tracker.url)?.hostname ?? tracker.url);
    if (isBaseCard) {
      const baselineBadge = document.createElement("span");
      baselineBadge.className = "baseline-badge";
      baselineBadge.textContent = "Baseline";
      labelLine.append(baselineBadge);
    }
    urlLine.textContent = tracker.url;
    title.classList.toggle("no-label", !hasLabel);
    title.setAttribute("aria-label", `Edit label for ${tracker.label || tracker.url}`);
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
      skipLabelEditRestoreOnNextRender = true;
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
      skipLabelEditRestoreOnNextRender = true;
      render();
      if (resumeEditUrl && resumeEditUrl !== tracker.url) {
        requestAnimationFrame(() => {
          beginLabelEditing(resumeEditUrl);
        });
      }
    };

    labelInput.addEventListener("keydown", (event) => {
      if (event.isComposing) {
        return;
      }
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

    const iconPlay = iconMarkup(playSvg);
    const iconPause = iconMarkup(pauseSvg);
    const iconRunNow = iconMarkup(zapSvg);
    const iconTrash = iconMarkup(trashSvg);

    toggleButton.classList.toggle("is-running", tracker.running);
    toggleButton.classList.toggle("is-paused", !tracker.running);
    toggleButton.innerHTML = `${tracker.running ? iconPause : iconPlay}<span>${tracker.running ? "Pause" : "Resume"}</span>`;
    toggleButton.setAttribute("aria-label", tracker.running ? "Pause" : "Resume");
    toggleButton.dataset.tooltip = tracker.running ? "Pause" : "Resume";
    attachTooltipHandlers(toggleButton);
    toggleButton.addEventListener("click", () => {
      if (tracker.running) {
        stopTracker(tracker);
      } else if (ensureApiKeyConfigured()) {
        startTracker(tracker, true);
      }
      render();
    });

    runNowButton.disabled = tracker.inFlight;
    runNowButton.innerHTML = `${iconRunNow}<span>${tracker.running ? "Run now" : "Run once"}</span>`;
    runNowButton.setAttribute("aria-label", tracker.running ? "Run now" : "Run once");
    runNowButton.dataset.tooltip = tracker.running ? "Run now" : "Run once";
    attachTooltipHandlers(runNowButton);
    runNowButton.addEventListener("click", () => {
      if (!ensureApiKeyConfigured()) {
        return;
      }
      triggerImmediateCycle(tracker);
    });

    if (setBaselineButton) {
      setBaselineButton.innerHTML = `${ICON_BASELINE}<span>${isBaseCard ? "Clear baseline" : "Set baseline"}</span>`;
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
    removeButton.dataset.tooltip = "Remove site";
    removeButton.setAttribute("aria-label", `Remove site: ${tracker.label || tracker.url}`);
    attachTooltipHandlers(removeButton);
    removeButton.addEventListener("click", () => {
      openRemoveSiteDialog(tracker);
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
    if (scoreHistorySection && !scoreHistorySection.hidden) {
      historySlot.dataset.url = tracker.url;
      historySlot.append(scoreHistorySection);
      createConnectedEdgeShadow(historySlot, "run-edge");
      scoreHistoryScroll?.addEventListener("scroll", positionRunSelection, { passive: true });
      scoreHistoryScroll?.querySelector(".run-selection")?.addEventListener("transitionrun", (event) => {
        if (event.propertyName === "transform") followRunSeam(event.currentTarget);
      });
    }
    if (scoreHistoryScroll && scrollByUrl.has(tracker.url)) {
      scoreHistoryScroll.scrollTop = scrollByUrl.get(tracker.url);
    }
    requestAnimationFrame(positionRunSelection);
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
    scoreAvgCell.textContent = rowData.summary.avgScore.toFixed(1);
    scoreAvgCell.prepend(createPaneProgress(rowData.summary.avgScore, getSummaryBackgroundColor(rowData.mode, rowData.summary.avgScore, renderContext, "bar")));
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
      const metricColor = getMetricBackgroundColor(
        rowData.mode,
        metric.key,
        metricResult.avgValue,
        renderContext, "bar",
      );
      const bubble = createMetricValueBlock(
        metric,
        metricResult.avgValue,
        null,
        rowData.mode,
        false,
      );
      bubble.prepend(metricProgress(metric, metricResult.avgValue, rowData.mode, metricColor));
      metricCell.append(bubble);
      row.append(metricCell);
    }

    comparisonBody.append(row);
  }
}

function refreshLiveStatusText() {
  for (const row of document.querySelectorAll(".site-row[data-url]")) {
    const tracker = state.trackers.get(row.dataset.url);
    const status = row.querySelector(".site-status");
    if (tracker && status) {
      status.textContent = `● ${describeTrackerStatus(tracker)}${state.comparisonBaseUrl === tracker.url ? " · Baseline" : ""}`;
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
      colorMode: state.colorMode,
      glimmDev: state.glimmDev,
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

let showFirstRunIntro = false;
try {
  showFirstRunIntro = !localStorage.getItem(STORAGE_KEY) && !localStorage.getItem("pagespeeder-onboarding-seen");
} catch (error) {
  console.warn("Failed to check onboarding state", error);
}
hydrateState();
applyThemeMode();
syncGlimmDevPanel();
scheduleGlimmAutoplay();
updateShopifyPbSuggestion();
for (const tracker of state.trackers.values()) {
  if (tracker.running) {
    startTracker(tracker);
  }
}

render();
if (showFirstRunIntro) {
  try { localStorage.setItem("pagespeeder-onboarding-seen", "1"); } catch (error) { console.warn("Failed to save onboarding state", error); }
  openApiKeyDialog({ onboarding: true });
}
