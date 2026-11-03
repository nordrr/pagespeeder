export const SCORING_MODEL_VERSION = "v10";
export const LH_V10_CURVES = {
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

export function internalErf(x) {
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

export function derivePodrFromP10(median, p10) {
  const u = Math.log(median);
  const shape = Math.abs(Math.log(p10) - u) / (Math.SQRT2 * 0.9061938024368232);
  const inner = -3 * shape - Math.sqrt(4 + shape * shape);
  return Math.exp(u + (shape / 2) * inner);
}

export function quantileAtValue(curve, value) {
  const podr = curve.podr || derivePodrFromP10(curve.median, curve.p10);
  const location = Math.log(curve.median);
  const logRatio = Math.log(podr / curve.median);
  const shape = Math.sqrt(1 - 3 * logRatio - Math.sqrt((logRatio - 3) * (logRatio - 3) - 8)) / 2;
  const standardizedX = (Math.log(value) - location) / (Math.SQRT2 * shape);
  return (1 - internalErf(standardizedX)) / 2;
}

export function metricContribution(strategy, metricKey, value) {
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

// All currently supported metrics improve as their measured value decreases.
export function metricImprovementExample(strategy, metricKey, value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const current = metricContribution(strategy, metricKey, value);
  if (!current) return null;
  const target = value * 0.75;
  const improved = metricContribution(strategy, metricKey, target);
  let onePointTarget = null;
  const maximum = metricContribution(strategy, metricKey, 0);
  if (maximum.points - current.points >= 1) {
    let low = 0;
    let high = value;
    for (let i = 0; i < 60; i += 1) {
      const mid = (low + high) / 2;
      if (metricContribution(strategy, metricKey, mid).points >= current.points + 1) low = mid;
      else high = mid;
    }
    onePointTarget = low;
  }
  return { target, gain: Math.max(0, improved.points - current.points), onePointTarget };
}

