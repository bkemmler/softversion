import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { openDb, setSetting } from "../src/server/db.ts";
import { backupDb } from "../src/server/backup.ts";
import { createScheduler } from "../src/server/scheduler.ts";
import { createRunner } from "../src/server/runner.ts";
import { createNotifier } from "../src/server/notifier.ts";
import { createSecretBox } from "../src/server/crypto.ts";
import { syncProducts } from "../src/server/registry.ts";
import { createHttp, HttpStatusError } from "../src/server/http.ts";
import { defineTracker, type Tracker } from "../src/server/tracker.ts";

async function server(t: { after(fn: () => void): void }, handler: (path: string) => [number, string]) {
  const hits: { path: string; at: number }[] = [];
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c)).on("end", () => {
      hits.push({ path: req.url! + (body ? ` ${body}` : ""), at: Date.now() });
      const [status, text] = handler(req.url!);
      res.writeHead(status).end(text);
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  t.after(() => srv.close());
  return { base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, hits };
}

test("Backup: Kopie ist lesbar, ältere als 14 Tage werden gelöscht", () => {
  const dir = mkdtempSync(join(tmpdir(), "sv-bak-"));
  const db = openDb(join(dir, "softversion.db"));
  setSetting(db, "schedule_time", "05:15");
  backupDb(db, dir, 14, new Date("2026-11-07T10:00:00Z")); // schon vorhanden → wird ersetzt
  writeFileSync(join(dir, "backups", "softversion-2026-10-01.db"), "");
  writeFileSync(join(dir, "backups", "softversion-2026-10-30.db"), "");
  const file = backupDb(db, dir, 14, new Date("2026-11-07T10:00:00Z"));
  assert.deepEqual(readdirSync(join(dir, "backups")).sort(), ["softversion-2026-10-30.db", "softversion-2026-11-07.db"]);
  const copy = new DatabaseSync(file);
  assert.equal((copy.prepare("SELECT value FROM settings WHERE key = 'schedule_time'").get() as { value: string }).value, "05:15");
  copy.close();
});

test("Scheduler: Uhrzeit und Zeitzone aus den Einstellungen, reload übernimmt Änderungen", () => {
  const db = openDb(":memory:");
  const runner = createRunner({ db, trackers: new Map() });
  const s = createScheduler(db, runner);
  try {
    assert.ok(s.alive());
    let next = new Date(s.nextRun()!);
    assert.equal(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(next), "06:00");
    setSetting(db, "schedule_time", "22:45");
    setSetting(db, "timezone", "America/New_York");
    s.reload();
    next = new Date(s.nextRun()!);
    assert.equal(new Intl.DateTimeFormat("de-DE", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }).format(next), "22:45");
  } finally {
    s.stop();
  }
});

test("HTTP: Wiederholung bei 503, kein Retry bei 404, Mindestabstand je Host", async (t) => {
  let calls = 0;
  const srv = await server(t, (path) => (path === "/flaky" ? (++calls < 3 ? [503, "busy"] : [200, "ok"]) : path === "/gone" ? [404, ""] : [200, "hi"]));
  const http = createHttp(new AbortController().signal, () => {}, { timeoutMs: 2000, retries: 3, hostGapMs: 50, backoffMs: 10 });
  assert.equal(await http.getText(`${srv.base}/flaky`), "ok");
  assert.equal(calls, 3);
  await assert.rejects(http.getText(`${srv.base}/gone`), (e) => e instanceof HttpStatusError && e.status === 404);
  assert.equal(srv.hits.filter((h) => h.path === "/gone").length, 1);
  srv.hits.length = 0;
  await Promise.all([http.getText(`${srv.base}/a`), http.getText(`${srv.base}/b`), http.getText(`${srv.base}/c`)]);
  const at = srv.hits.map((h) => h.at).sort();
  assert.ok(at[2] - at[0] >= 90, `Abstand ${at[2] - at[0]} ms`);
});

test("Abnahme Stage 5: kaputter Tracker löst nach 3 Läufen genau eine Warnung in Teams aus", async (t) => {
  const teams = await server(t, () => [202, ""]);
  const db = openDb(":memory:");
  const box = createSecretBox("0123456789abcdef-secret");
  let broken = true;
  const trackers = new Map<string, Tracker>([["kaputt", defineTracker({
    id: "kaputt", vendor: "ACME", product: "Widget", sources: [],
    fetchReleases: async () => {
      if (broken) throw new Error("Seitenlayout geändert");
      return [{ line: "1", version: "1.0", type: "major", sortKey: [1, 0] }];
    },
  })]]);
  syncProducts(db, trackers);
  db.exec("UPDATE products SET enabled = 1");
  db.prepare("INSERT INTO channels (name, webhook_url, enabled, created_at) VALUES ('IT', ?, 1, '')").run(box.encrypt(`${teams.base}/hook`));
  const runner = createRunner({ db, trackers, notifier: createNotifier(db, box) });
  const alerts = () => teams.hits.filter((h) => h.path.includes("Tracker-Ausfall")).length;

  for (let i = 1; i <= 2; i++) await runner.start("schedule").done;
  assert.equal(alerts(), 0);
  await runner.start("schedule").done;
  assert.equal(alerts(), 1);
  assert.match(teams.hits[0].path, /ACME Widget.*3-mal in Folge.*Seitenlayout ge/);
  await runner.start("schedule").done;
  assert.equal(alerts(), 1, "keine Wiederholung");

  broken = false;
  await runner.start("schedule").done;
  broken = true;
  for (let i = 1; i <= 3; i++) await runner.start("schedule").done;
  assert.equal(alerts(), 2, "nach Erholung und erneutem Ausfall wieder eine Warnung");
});

test("Unterbrochene Läufe werden beim Start als abgebrochen markiert", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sv-abort-"));
  const db = openDb(join(dir, "softversion.db"));
  db.prepare("INSERT INTO check_runs (started_at, trigger, status) VALUES ('2026-01-01', 'schedule', 'running')").run();
  db.close();
  const { createApp } = await import("../src/server/app.ts");
  const app = await createApp({ dataDir: dir, appSecret: "0123456789abcdef-secret" });
  assert.equal((app.db.prepare("SELECT status FROM check_runs").get() as { status: string }).status, "aborted");
  assert.ok(existsSync(join(dir, "softversion.db")));
});
