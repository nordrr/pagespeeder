import { createMeshShader, createNamedropShader, createShader, playSweep } from "glimm";

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

export function createThemeController({ state, THEME_MODES, GLIMM_DEV_SETTINGS_VERSION, systemThemeQuery, themeModeButtons, settingsThemeButtons, settingsThemeOptions, glimmDevFields, glimmDevAutoplayButton, persistState, render }) {
let themeSweepController = null;
let themeSweepHandle = null;
let themeSweepShaderType = null;
let glimmAutoplayTimerId = null;

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
  document.querySelector(".theme-control").dataset.selected = mode;
  for (const button of themeModeButtons) {
    const isActive = button.dataset.themeMode === mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
  for (const button of settingsThemeButtons) {
    const active = button.dataset.settingTheme === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  positionSettingsThemeIndicator();
}

function positionSettingsThemeIndicator() {
  const active = settingsThemeButtons.find((button) => button.dataset.settingTheme === state.themeMode);
  if (!active || !active.offsetWidth) return;
  settingsThemeOptions.style.setProperty("--indicator-left", `${active.offsetLeft}px`);
  settingsThemeOptions.style.setProperty("--indicator-width", `${active.offsetWidth}px`);
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
    glimmDevAutoplayButton.textContent = state.glimmDev.autoplay ? "Pause autoplay" : "Start autoplay";
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


return { applyThemeMode, positionSettingsThemeIndicator, setThemeModeWithSweep, updateGlimmDevSetting, previewGlimmThemeSweep, syncGlimmDevPanel, scheduleGlimmAutoplay, hydrateGlimmDevState };
}
