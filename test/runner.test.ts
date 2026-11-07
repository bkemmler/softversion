import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { openDb, setSetting } from "../src/server/db.ts";
import { loadTrackers, syncProducts } from "../src/server/registry.ts";
import { createRunner, type RunNotifier } from "../src/server/runner.ts";
import { defineTracker, type Tracker } from "../src/server/tracker.ts";

const FIX = join(import.meta.dirname, "fixtures");

function setup(trackers: Map<string, Tracker>) {
  const db = openDb(":memory:");
  syncProducts(db, trackers);
  db.exec("UPDATE products SET enabled = 1");
  const sent = { releases: [] as number[], alerts: [] as string[] };
  const notifier: RunNotifier = {
    enqueueRelease: (id) => sent.releases.push(id),
    enqueueAlert: (_, text) => sent.alerts.push(text),
    flush: async () => {},
  };
  const runner = createRunner({ db, trackers, notifier, timeoutMs: 500 });
  return { db, runner, sent };
}

test("Abnahme Stage 1: erster Lauf = Baseline, geänderte Fixture = genau 1 neues Release", async () => {
  const { db, runner, sent } = setup(await loadTrackers(join(FIX, "demo-trackers")));
  process.env.DEMO_FIXTURE = join(FIX, "demo/v1.html");
  const first = await runner.start("cli").done;
  assert.equal(first.status, "ok");
  assert.equal(sent.releases.length, 0, "Baseline meldet nichts");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM releases").get() as { n: number }).n, 3);

  const again = await runner.start("cli").done;
  assert.equal(again.newReleases, 0, "gleiche Seite → nichts Neues");

  process.env.DEMO_FIXTURE = join(FIX, "demo/v2.html");
  const second = await runner.start("cli").done;
  assert.equal(second.newReleases, 1);
  assert.equal(sent.releases.length, 1);
  const r = db.prepare("SELECT version, type FROM releases WHERE id = ?").get(sent.releases[0]) as { version: string; type: string };
  assert.deepEqual({ ...r }, { version: "6.0.1", type: "hotfix" });
});

function fake(id: string, fn: () => unknown): Tracker {
  return defineTracker({ id, vendor: "V", product: id, sources: [], fetchReleases: async () => fn() as never });
}

test("verschwundene Versionen werden nicht gelöscht, ältere neue Versionen nicht gemeldet", async () => {
  let list = [
    { line: "1", version: "1.2", type: "servicepack", sortKey: [1, 2] },
    { line: "1", version: "1.3", type: "servicepack", sortKey: [1, 3] },
  ];
  const { db, runner, sent } = setup(new Map([["p", fake("p", () => list)]]));
  await runner.start("cli").done;
  list = [{ line: "1", version: "1.1", type: "servicepack", sortKey: [1, 1] }];
  await runner.start("cli").done;
  assert.equal(sent.releases.length, 0);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM releases").get() as { n: number }).n, 3);
});

test("neue Linie: nur neueste Version gemeldet; deaktivierte Linie meldet nichts", async () => {
  let list = [{ line: "1", version: "1.0", type: "major", sortKey: [1, 0] }];
  const { db, runner, sent } = setup(new Map([["p", fake("p", () => list)]]));
  await runner.start("cli").done;
  list = [...list, { line: "2", version: "2.0", type: "major", sortKey: [2, 0] }, { line: "2", version: "2.1", type: "servicepack", sortKey: [2, 1] }];
  await runner.start("cli").done;
  assert.equal(sent.releases.length, 1);

  db.exec("UPDATE version_lines SET enabled = 0");
  list = [...list, { line: "2", version: "2.2", type: "servicepack", sortKey: [2, 2] }];
  await runner.start("cli").done;
  assert.equal(sent.releases.length, 1);
});

test("neue Linie ohne 'automatisch tracken' wird deaktiviert angelegt", async () => {
  let list = [{ line: "1", version: "1.0", type: "major", sortKey: [1, 0] }];
  const { db, runner, sent } = setup(new Map([["p", fake("p", () => list)]]));
  db.exec("UPDATE products SET auto_enable_new_lines = 0");
  await runner.start("cli").done;
  list = [...list, { line: "2", version: "2.0", type: "major", sortKey: [2, 0] }];
  await runner.start("cli").done;
  assert.equal(sent.releases.length, 0);
  assert.equal((db.prepare("SELECT enabled FROM version_lines WHERE line_key = '2'").get() as { enabled: number }).enabled, 0);
});

test("leeres oder ungültiges Ergebnis ist ein Fehler; Ausfall-Warnung genau einmal ab Schwelle", async () => {
  let result: unknown = [];
  const { db, runner, sent } = setup(new Map([["p", fake("p", () => result)]]));
  setSetting(db, "failure_alert_threshold", "3");
  for (let i = 0; i < 5; i++) assert.equal((await runner.start("cli").done).status, "error");
  assert.equal(sent.alerts.length, 1);
  const p = db.prepare("SELECT status, consecutive_failures FROM products").get() as { status: string; consecutive_failures: number };
  assert.deepEqual({ ...p }, { status: "error", consecutive_failures: 5 });

  result = [{ line: "1", version: "1", type: "major", sortKey: [1] }];
  assert.equal((await runner.start("cli").done).status, "ok");
  result = [{ line: "1", version: "x", type: "unbekannt", sortKey: [1] }];
  const r = await runner.start("cli").done;
  assert.equal(r.status, "error");
});

test("Tracker, der hängt, wird nach Timeout abgebrochen; nur ein Lauf gleichzeitig", async () => {
  const { runner } = setup(new Map([["p", fake("p", () => new Promise(() => {}))]]));
  const run = runner.start("cli");
  assert.throws(() => runner.start("cli"), /läuft bereits/);
  const s = await run.done;
  assert.equal(s.status, "error");
});

test("100 Tracker laufen parallel (4 gleichzeitig) und unter dem Zeitlimit", async () => {
  const trackers = new Map<string, Tracker>();
  for (let i = 0; i < 100; i++) {
    trackers.set(`t${i}`, fake(`t${i}`, () => new Promise((r) => setTimeout(() => r([{ line: "1", version: "1", type: "major", sortKey: [1] }]), 20))));
  }
  const { runner } = setup(trackers);
  const t0 = Date.now();
  const s = await runner.start("cli").done;
  assert.equal(s.checked, 100);
  assert.equal(s.failed, 0);
  assert.ok(Date.now() - t0 < 2000, "4 parallel × 20 ms ≈ 0,5 s");
});
