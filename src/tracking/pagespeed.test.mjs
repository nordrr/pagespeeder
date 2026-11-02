import test from "node:test";
import assert from "node:assert/strict";
import { fetchPsiSample, parsePsiSample, sampleFingerprint, isDuplicateSample } from "./pagespeed.mjs";

const auditIds = ["first-contentful-paint", "speed-index", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift"];
function payload() {
  return { lighthouseResult: { fetchTime: "2026-01-01T00:00:00Z", categories: { performance: { score: 0.87 } }, audits: Object.fromEntries(auditIds.map((id, index) => [id, { numericValue: index + 1, score: index / 10 }])) } };
}

test("parses Lighthouse values and falls back for absent scores and fetch time", () => {
  const data = payload();
  data.lighthouseResult.fetchTime = 42;
  data.lighthouseResult.audits["speed-index"].score = null;
  const before = Date.now();
  const sample = parsePsiSample(data);
  assert.ok(sample.timestamp >= before && sample.timestamp <= Date.now());
  assert.equal(sample.lighthouseFetchTime, null);
  assert.equal(sample.performanceScore, 87);
  assert.deepEqual(sample.metrics, {
    fcp: { value: 1, score: 0 }, si: { value: 2, score: 0 },
    lcp: { value: 3, score: 20 }, tbt: { value: 4, score: 30 }, cls: { value: 5, score: 40 },
  });
});

test("rejects malformed responses and identifies missing metrics", () => {
  assert.throws(() => parsePsiSample({}), /Unexpected API response shape\./);
  const data = payload();
  delete data.lighthouseResult.audits["largest-contentful-paint"];
  assert.throws(() => parsePsiSample(data), /Metric LCP missing from response\./);
});

test("requests the performance category and handles API errors", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requested;
  globalThis.fetch = async (url) => { requested = new URL(url); return { ok: true, json: async () => payload() }; };
  const sample = await fetchPsiSample("https://example.com/a?x=1&y=2", "mobile", "key + value");
  assert.equal(requested.origin + requested.pathname, "https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  assert.deepEqual(Object.fromEntries(requested.searchParams), { url: "https://example.com/a?x=1&y=2", key: "key + value", strategy: "mobile", category: "performance" });
  assert.equal(sample.lighthouseFetchTime, "2026-01-01T00:00:00Z");
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "Quota exceeded" } }) });
  await assert.rejects(fetchPsiSample("x", "desktop", "k"), /Quota exceeded/);
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(fetchPsiSample("x", "desktop", "k"), /Request failed with status 503/);
});

test("detects duplicates by fetch time or complete metric fingerprint", () => {
  const sample = parsePsiSample(payload());
  assert.equal(isDuplicateSample(null, sample), false);
  assert.equal(isDuplicateSample(sample, { ...sample, performanceScore: 50 }), true);
  const sameValues = { ...sample, lighthouseFetchTime: "different" };
  assert.equal(isDuplicateSample(sample, sameValues), true);
  assert.equal(isDuplicateSample(sample, { ...sameValues, metrics: { ...sample.metrics, cls: { ...sample.metrics.cls, value: 9 } } }), false);
  assert.equal(sampleFingerprint({ performanceScore: 1, metrics: {} }), "");
  // Preserve the existing behavior for two incomplete fingerprints.
  assert.equal(isDuplicateSample({ performanceScore: 1, metrics: {} }, { performanceScore: 2, metrics: {} }), true);
});
