export const METRICS = [
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

