import { test } from "node:test";
import assert from "node:assert/strict";
import { averageComparison, averageComparisonRows, confidenceBounds } from "../src/views/run-average.mjs";

test("describes each run relative to the same site's average", () => {
  assert.equal(averageComparison(49, 46.5), "Site average 46.5; 2.5 points above average");
  assert.equal(averageComparison(40, 46.5), "Site average 46.5; 6.5 points below average");
  assert.equal(averageComparison(46.5, 46.5), "Site average 46.5; matches the average");
  assert.equal(averageComparison(40, undefined), "");
});

test("confidence bounds are available only for finite intervals", () => {
  assert.deepEqual(confidenceBounds(50, 5), { low: 45, high: 55 });
  assert.equal(confidenceBounds(50, null), null);
  assert.equal(averageComparison(49, 50, "points", { low: 45, high: 55 }), "Site average 50.0; 1.0 points below average; 95% confidence range 45.0–55.0 points");
});

test("formats readable comparison rows with optional confidence bounds", () => {
  assert.deepEqual(averageComparisonRows(58, 49.7, "points", { low: 46.1, high: 53.4 }), [
    ["Site average", "49.7 points"], ["This run", "8.3 points above"], ["95% range", "46.1–53.4 points"],
  ]);
  assert.deepEqual(averageComparisonRows(50, 50), [["Site average", "50.0 points"], ["This run", "Matches average"]]);
  assert.deepEqual(averageComparisonRows(50, undefined), []);
});
