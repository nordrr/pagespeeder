const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

import { METRICS } from "../metrics.mjs";
export { sampleFingerprint, isDuplicateSample } from "../statistics.mjs";

export async function fetchPsiSample(url, strategy, apiKey) {
  const params = new URLSearchParams({ url, key: apiKey, strategy, category: "performance" });
  const response = await fetch(`${PSI_ENDPOINT}?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return parsePsiSample(payload);
}

export function parsePsiSample(payload) {
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

