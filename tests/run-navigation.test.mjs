import { test } from "node:test";
import assert from "node:assert/strict";
import { findRunNavigationTarget } from "../src/views/run-navigation.mjs";

test("arrows navigate scores by column and skip incomplete runs", () => {
  const rows = [
    { runNumber: 4, mobile: null, desktop: "4d" },
    { runNumber: 3, mobile: "3m", desktop: "3d" },
    { runNumber: 2, mobile: "2m", desktop: null },
    { runNumber: 1, mobile: "1m", desktop: "1d" },
  ];
  assert.equal(findRunNavigationTarget(rows, 3, "desktop", "ArrowLeft"), "3m");
  assert.equal(findRunNavigationTarget(rows, 3, "mobile", "ArrowRight"), "3d");
  assert.equal(findRunNavigationTarget(rows, 3, "mobile", "ArrowUp"), null);
  assert.equal(findRunNavigationTarget(rows, 3, "desktop", "ArrowDown"), "1d");
  assert.equal(findRunNavigationTarget(rows, 1, "mobile", "ArrowUp"), "2m");
  assert.equal(findRunNavigationTarget(rows, 2, "mobile", "ArrowRight"), null);
  assert.equal(findRunNavigationTarget(rows, 1, "mobile", "ArrowDown"), null);
});
