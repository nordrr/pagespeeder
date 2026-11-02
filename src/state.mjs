export const STRATEGIES = ["mobile", "desktop"];
export const THEME_MODES = new Set(["auto", "light", "dark"]);
export const GLIMM_DEV_SETTINGS_VERSION = 2;
export const FIXED_POLL_INTERVAL_SEC = 60;
export const MIN_STAT_SIG_SAMPLES = 10;
export function createInitialState() {
return {
  apiKey: "",
  pollIntervalSec: FIXED_POLL_INTERVAL_SEC,
  autoPauseTarget: 2,
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
}
