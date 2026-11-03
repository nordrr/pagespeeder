export function averageComparison(value, average, unit = "points", bounds = null) {
  if (!Number.isFinite(value) || !Number.isFinite(average)) return "";
  const delta = value - average;
  const difference = Math.abs(delta).toFixed(1);
  const direction = Math.abs(delta) < 0.05 ? "matches" : delta > 0 ? "above" : "below";
  const comparison = direction === "matches"
    ? `Site average ${average.toFixed(1)}; matches the average`
    : `Site average ${average.toFixed(1)}; ${difference} ${unit} ${direction} average`;
  return bounds && Number.isFinite(bounds.low) && Number.isFinite(bounds.high)
    ? `${comparison}; 95% confidence range ${bounds.low.toFixed(1)}–${bounds.high.toFixed(1)} ${unit}`
    : comparison;
}

export function averageComparisonRows(value, average, unit = "points", bounds = null) {
  if (!Number.isFinite(value) || !Number.isFinite(average)) return [];
  const delta = value - average;
  const difference = Math.abs(delta) < 0.05
    ? "Matches average"
    : `${Math.abs(delta).toFixed(1)} ${unit} ${delta > 0 ? "above" : "below"}`;
  const rows = [["Site average", `${average.toFixed(1)} ${unit}`], ["This run", difference]];
  if (bounds && Number.isFinite(bounds.low) && Number.isFinite(bounds.high)) {
    rows.push(["95% range", `${bounds.low.toFixed(1)}–${bounds.high.toFixed(1)} ${unit}`]);
  }
  return rows;
}

export function confidenceBounds(average, halfWidth) {
  if (!Number.isFinite(average) || !Number.isFinite(halfWidth) || halfWidth < 0) return null;
  return { low: average - halfWidth, high: average + halfWidth };
}

export function addAverageMarker(track, value, bounds = null, color = null) {
  if (!Number.isFinite(value)) return;
  if (color) track.style.setProperty("--run-average-color", color);
  if (bounds && Number.isFinite(bounds.low) && Number.isFinite(bounds.high)) {
    const range = document.createElement("span");
    range.className = "run-average-range";
    const low = Math.max(0, Math.min(100, bounds.low));
    const high = Math.max(0, Math.min(100, bounds.high));
    range.style.left = `${low}%`;
    range.style.width = `${Math.max(0, high - low)}%`;
    track.append(range);
  }
  const marker = document.createElement("span");
  marker.className = "run-average-marker";
  marker.style.left = `${Math.max(0, Math.min(100, value))}%`;
  track.append(marker);
}
