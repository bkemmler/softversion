import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeSortKey } from "../src/server/tracker.ts";

test("encodeSortKey sortiert numerisch statt lexikographisch", () => {
  const keys = [[2026, 10, 0], [2026, 2, 0], [2025, 5, 1], [2026, 2], [11, 0, 30], [2026, 2, 0, 1]];
  const sorted = keys.map(encodeSortKey).sort();
  assert.deepEqual(sorted, [[11, 0, 30], [2025, 5, 1], [2026, 2], [2026, 2, 0], [2026, 2, 0, 1], [2026, 10, 0]].map(encodeSortKey));
});
