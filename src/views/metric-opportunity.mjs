import { metricContribution, metricImprovementExample } from "../lighthouse-scoring.mjs";

export function metricImprovementScenarios(metric, strategy, value, percentages = [25, 50]) {
  if (!Number.isFinite(value) || value <= 0) return [];
  const current = metricContribution(strategy, metric.key, value);
  if (!current) return [];
  return percentages.map((percentage) => {
    const fraction = percentage / 100;
    const target = value * (1 - fraction);
    const improved = metricContribution(strategy, metric.key, target);
    return { fraction, target, reduction: value - target, gain: Math.max(0, improved.points - current.points) };
  });
}

export function formatDisplayedReduction(metric, value, target) {
  const displayedStart = Number.parseFloat(metric.format(value));
  const displayedTarget = Number.parseFloat(metric.format(target));
  const displayDifference = Math.max(0, Number((displayedStart - displayedTarget).toFixed(3)));
  const scale = metric.key === "cls" || metric.key === "tbt" ? 1 : 1000;
  return metric.format(displayDifference * scale);
}

export function describeMetricScenario(metric, value, scenario, averageScore, mode) {
  const percentage = Math.round(scenario.fraction * 100);
  const reduction = formatDisplayedReduction(metric, value, scenario.target);
  const gain = scenario.gain < 0.05 ? "less than 0.1 points" : `about ${scenario.gain.toFixed(1)} points`;
  const total = Number.isFinite(averageScore)
    ? `, bringing the estimated ${mode} average to ${Math.min(100, averageScore + scenario.gain).toFixed(1)}`
    : "";
  return `Reducing ${metric.label} by ${percentage}% to ${metric.format(scenario.target)} (${reduction} lower) could add ${gain}${total}, assuming other metrics stay the same.`;
}

export function metricOpportunityRows(metric, strategy, value) {
  const example = metricImprovementExample(strategy, metric.key, value);
  if (!example || metric.format(example.target) === metric.format(value)) return [];
  const gain = example.gain < 0.05 ? "<0.1 pt" : `+${example.gain.toFixed(1)} pts`;
  const rows = [["25% lower (est.)", `${metric.format(example.target)} → ${gain}`]];
  if (example.onePointTarget !== null && metric.format(example.onePointTarget) !== metric.format(value)) {
    rows.push(["For +1 point", `~${metric.format(example.onePointTarget)}`]);
  }
  return rows;
}

export function rankMetricOpportunities(metrics, strategy, summary, percentages = [25, 50]) {
  if (!summary?.metrics) return [];
  return metrics.map((metric) => {
    const value = summary.metrics[metric.key]?.avgValue;
    const current = Number.isFinite(value) && value >= 0 ? metricContribution(strategy, metric.key, value) : null;
    if (!current) return { metric, value, gain: -1, status: "unavailable", scenarios: [] };
    const remaining = current.maxPoints - current.points;
    const status = remaining <= Number.EPSILON * current.maxPoints * 4 ? "maximum" : remaining < 0.05 ? "near-maximum" : "available";
    const scenarios = metricImprovementScenarios(metric, strategy, value, percentages);
    return { metric, value, gain: scenarios[0]?.gain ?? 0, status, scenarios: status === "available" ? scenarios : [] };
  }).sort((a, b) => b.gain - a.gain);
}
