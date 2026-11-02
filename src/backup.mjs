export function validateBackup(data, { normalizeUrl, parseUrlSafe, STRATEGIES, METRICS }) {
  if (!data || data.format !== "pagespeeder-backup" || data.version !== 1 || !Array.isArray(data.sites)) {
    throw new Error("This isn’t a supported PageSpeeder backup.");
  }
  const urls = new Set();
  const sites = data.sites.map((site) => {
    const url = typeof site?.url === "string" ? normalizeUrl(site.url) : "";
    const parsed = parseUrlSafe(url);
    if (!parsed || !["http:", "https:"].includes(parsed.protocol) || urls.has(url) || typeof site.label !== "string" || site.label.length > 80) {
      throw new Error("The backup contains an invalid or duplicate site.");
    }
    urls.add(url);
    const history = {};
    for (const strategy of STRATEGIES) {
      if (!Array.isArray(site.history?.[strategy])) throw new Error("The backup contains invalid run history.");
      history[strategy] = site.history[strategy].map((sample) => {
        if (!sample || !Number.isFinite(sample.timestamp) || !Number.isFinite(sample.performanceScore) || sample.performanceScore < 0 || sample.performanceScore > 100) {
          throw new Error("The backup contains an invalid run.");
        }
        const metrics = {};
        for (const metric of METRICS) {
          const value = sample.metrics?.[metric.key];
          if (!value || !Number.isFinite(value.value) || value.value < 0 || !Number.isFinite(value.score) || value.score < 0 || value.score > 100) {
            throw new Error("The backup contains invalid run metrics.");
          }
          metrics[metric.key] = { value: value.value, score: value.score };
        }
        return { timestamp: sample.timestamp, lighthouseFetchTime: typeof sample.lighthouseFetchTime === "string" ? sample.lighthouseFetchTime : null, performanceScore: sample.performanceScore, metrics };
      });
    }
    return { url, label: site.label, history };
  });
  const baselineUrl = data.baselineUrl === null ? null : normalizeUrl(typeof data.baselineUrl === "string" ? data.baselineUrl : "");
  if (data.baselineUrl !== null && (!baselineUrl || !urls.has(baselineUrl))) throw new Error("The backup contains an invalid baseline.");
  if (Object.hasOwn(data, "apiKey") && (typeof data.apiKey !== "string" || !data.apiKey.trim())) {
    throw new Error("The backup contains an invalid API key.");
  }
  return { sites, baselineUrl, apiKey: Object.hasOwn(data, "apiKey") ? data.apiKey.trim() : undefined };
}


export function createBackup(state, orderedTrackers, includeKey, now = new Date()) {
  const backup = {
    format: "pagespeeder-backup", version: 1, exportedAt: now.toISOString(),
    baselineUrl: state.comparisonBaseUrl,
    sites: orderedTrackers.map((tracker) => ({ url: tracker.url, label: tracker.label || "", history: tracker.history })),
  };
  if (includeKey) backup.apiKey = state.apiKey;
  return backup;
}
