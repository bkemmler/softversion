import { test } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "./helpers.ts";

test("GET /api/health antwortet mit ok und Version", async (t) => {
  const app = await startApp(t);
  const res = await fetch(`${app.url}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.version, /^\d+\.\d+\.\d+$/);
});
