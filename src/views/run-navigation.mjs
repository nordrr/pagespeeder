// Rows are in the same newest-to-oldest order as the score table.
export function findRunNavigationTarget(rows, runNumber, mode, key) {
  const current = rows.findIndex((row) => row.runNumber === runNumber);
  if (current < 0) return null;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const targetMode = key === "ArrowLeft" ? "mobile" : "desktop";
    return targetMode !== mode ? rows[current][targetMode] || null : null;
  }
  const step = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
  if (!step) return null;
  for (let index = current + step; index >= 0 && index < rows.length; index += step) {
    if (rows[index][mode]) return rows[index][mode];
  }
  return null;
}
