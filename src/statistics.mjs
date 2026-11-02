import { METRICS } from "./metrics.mjs";

export function sampleFingerprint(sample) {
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

export function isDuplicateSample(previousSample, nextSample) {
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

export function summarize(samples) {
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
      ci95Value: ci95(values),
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

export function mean(values) {
  if (!values.length) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

export function stdDevSample(values) {
  if (values.length < 2) {
    return 0;
  }

  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function ci95(values) {
  if (values.length < 2) {
    return null;
  }

  const standardDeviation = stdDevSample(values);
  const standardError = standardDeviation / Math.sqrt(values.length);
  return 1.96 * standardError;
}

export function getPercentile(population, value, higherIsBetter = true) {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (!Array.isArray(population) || population.length === 0) {
    return 50;
  }

  const raw = percentileRank(population, value);
  return higherIsBetter ? raw : 100 - raw;
}

export function percentileRank(values, value) {
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

