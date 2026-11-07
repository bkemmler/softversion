import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startApp } from "./helpers.ts";

const env = { TRACKER_DIR: join(import.meta.dirname, "fixtures/demo-trackers"), DEMO_FIXTURE: join(import.meta.dirname, "fixtures/demo/v1.html") };
const call = async (url: string, method = "GET", body?: unknown) => {
  const res = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const waitIdle = async (url: string) => {
  for (let i = 0; i < 50 && (await call(`${url}/api/overview`)).body.running; i++) await new Promise((r) => setTimeout(r, 100));
};

test("Abnahme Stage 3: Produkt, Linie und Einstellungen über die API schaltbar und nach Neustart erhalten", async (t) => {
  const a = await startApp(t, env);
  const [p] = (await call(`${a.url}/api/products`)).body;
  assert.equal(p.trackerId, "demo-product");
  assert.equal(p.enabled, false);
  assert.equal((await call(`${a.url}/api/products/${p.id}`, "PATCH", { enabled: true, autoEnableNewLines: false })).status, 200);
  assert.equal((await call(`${a.url}/api/check`, "POST", {})).status, 200);
  await waitIdle(a.url);
  const runs = (await call(`${a.url}/api/runs`)).body;
  assert.equal(runs.items[0].status, "ok");
  const detail = (await call(`${a.url}/api/runs/${runs.items[0].id}`)).body;
  assert.equal(detail.results[0].foundCount, 3);
  const after = (await call(`${a.url}/api/products`)).body[0];
  assert.deepEqual(after.lines.map((l: any) => [l.lineKey, l.latestVersion, l.enabled]), [["6", "6.0.0", false], ["5", "5.1.0", false]]);
  await call(`${a.url}/api/lines/${after.lines[0].id}`, "PATCH", { enabled: true });
  assert.equal((await call(`${a.url}/api/settings`, "PUT", { scheduleTime: "07:30", timezone: "Europe/Vienna" })).status, 200);
  assert.equal((await call(`${a.url}/api/settings`, "PUT", { scheduleTime: "25:00" })).status, 400);
  const rel = (await call(`${a.url}/api/releases?limit=2`)).body;
  assert.equal(rel.total, 3);
  assert.equal(rel.items.length, 2);
  a.proc.kill();

  const b = await startApp(t, { ...env, DATA_DIR: a.dataDir });
  const p2 = (await call(`${b.url}/api/products`)).body[0];
  assert.equal(p2.enabled, true);
  assert.equal(p2.autoEnableNewLines, false);
  assert.equal(p2.lines[0].enabled, true);
  assert.deepEqual((await call(`${b.url}/api/settings`)).body, { scheduleTime: "07:30", timezone: "Europe/Vienna", failureAlertThreshold: 3 });
  const health = (await call(`${b.url}/api/health`)).body;
  assert.equal(health.scheduler, true);
  assert.ok(health.nextRun);
});
