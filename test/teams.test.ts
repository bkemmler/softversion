import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { openDb } from "../src/server/db.ts";
import { createSecretBox, maskUrl } from "../src/server/crypto.ts";
import { createNotifier } from "../src/server/notifier.ts";
import { createRunner } from "../src/server/runner.ts";
import { syncProducts } from "../src/server/registry.ts";
import { defineTracker, type Tracker } from "../src/server/tracker.ts";
import { startApp } from "./helpers.ts";

/** Lokaler Ersatz für den Teams-Workflow-Webhook. */
async function mockTeams(t: { after(fn: () => void): void }) {
  const posts: any[] = [];
  let status = 202;
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c)).on("end", () => {
      if (status < 300) posts.push(JSON.parse(body));
      res.writeHead(status).end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  t.after(() => srv.close());
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/workflows/abc?sig=SECRET`, posts, setStatus: (s: number) => (status = s) };
}

test("Verschlüsselung: Roundtrip, Manipulation und falscher Schlüssel schlagen fehl", () => {
  const box = createSecretBox("0123456789abcdef-secret");
  const enc = box.encrypt("https://x.logic.azure.com/workflows/1?sig=geheim");
  assert.ok(!enc.includes("geheim"));
  assert.equal(box.decrypt(enc), "https://x.logic.azure.com/workflows/1?sig=geheim");
  const parts = enc.split(":");
  parts[3] = Buffer.from("manipuliert").toString("base64");
  assert.throws(() => box.decrypt(parts.join(":")));
  assert.throws(() => createSecretBox("anderer-schluessel-123").decrypt(enc));
  assert.throws(() => createSecretBox("kurz"), /APP_SECRET/);
  assert.equal(maskUrl("https://x.logic.azure.com/workflows/1?sig=geheim"), "https://x.logic.azure.com/…");
});

function setup(list: () => unknown) {
  const db = openDb(":memory:");
  const box = createSecretBox("0123456789abcdef-secret");
  const trackers = new Map<string, Tracker>([["p", defineTracker({ id: "p", vendor: "Dassault Systèmes", product: "SOLIDWORKS", sources: [], fetchReleases: async () => list() as never })]]);
  syncProducts(db, trackers);
  db.exec("UPDATE products SET enabled = 1");
  const notifier = createNotifier(db, box);
  const runner = createRunner({ db, trackers, notifier });
  const addChannel = (url: string) => Number(db.prepare("INSERT INTO channels (name, webhook_url, created_at) VALUES ('Kanal', ?, '')").run(box.encrypt(url)).lastInsertRowid);
  return { db, notifier, runner, addChannel };
}

test("Testnachricht aktiviert den Kanal erst bei Erfolg", async (t) => {
  const teams = await mockTeams(t);
  const { db, notifier, addChannel } = setup(() => []);
  const id = addChannel(teams.url);
  teams.setStatus(500);
  await assert.rejects(notifier.sendTest(id), /HTTP 500/);
  assert.equal((db.prepare("SELECT enabled FROM channels").get() as any).enabled, 0);
  teams.setStatus(202);
  await notifier.sendTest(id);
  assert.equal((db.prepare("SELECT enabled, last_error FROM channels").get() as any).enabled, 1);
  assert.equal(teams.posts[0].attachments[0].contentType, "application/vnd.microsoft.card.adaptive");
});

test("Abnahme Stage 2: neues Release als Adaptive Card; Fehler wird beim nächsten Lauf wiederholt", async (t) => {
  const teams = await mockTeams(t);
  let list = [{ line: "2026", version: "2026 SP4", type: "servicepack", sortKey: [2026, 4], notesUrl: "https://example.com/notes" }];
  const { db, runner, notifier, addChannel } = setup(() => list);
  await notifier.sendTest(addChannel(teams.url));
  await runner.start("cli").done; // Baseline
  assert.equal(teams.posts.length, 1);

  list = [...list, { line: "2026", version: "2026 SP5", type: "servicepack", sortKey: [2026, 5], notesUrl: "https://example.com/notes" }];
  teams.setStatus(503);
  await runner.start("cli").done;
  assert.equal(teams.posts.length, 1);
  const n = db.prepare("SELECT status, attempts, last_error FROM notifications").get() as any;
  assert.equal(n.status, "pending");
  assert.equal(n.attempts, 1);
  assert.match(n.last_error, /503/);

  teams.setStatus(202);
  await runner.start("cli").done; // nichts Neues, aber Ausgangskorb wird erneut gesendet
  assert.equal(teams.posts.length, 2);
  const card = teams.posts[1].attachments[0].content;
  assert.equal(card.type, "AdaptiveCard");
  assert.match(card.body[0].text, /SOLIDWORKS 2026 SP5/);
  assert.deepEqual(card.body[1].facts.find((f: any) => f.title === "Typ"), { title: "Typ", value: "Service Pack / Maintenance Release" });
  assert.equal(card.actions[0].url, "https://example.com/notes");
  assert.equal((db.prepare("SELECT status FROM notifications").get() as any).status, "sent");
});

test("mehr als 5 neue Releases → eine Sammelkarte", async (t) => {
  const teams = await mockTeams(t);
  let list = [{ line: "1", version: "1.0", type: "major", sortKey: [1, 0] }];
  const { runner, notifier, addChannel } = setup(() => list);
  await notifier.sendTest(addChannel(teams.url));
  await runner.start("cli").done;
  list = Array.from({ length: 7 }, (_, i) => ({ line: "1", version: `1.${i + 1}`, type: "patch", sortKey: [1, i + 1] }));
  await runner.start("cli").done;
  assert.equal(teams.posts.length, 2);
  assert.match(teams.posts[1].attachments[0].content.body[0].text, /7 neue Releases/);
});

test("API: Kanal anlegen nur mit https, URL wird maskiert ausgegeben", async (t) => {
  const app = await startApp(t);
  const post = (body: unknown) => fetch(`${app.url}/api/channels`, { method: "POST", body: JSON.stringify(body) });
  assert.equal((await post({ name: "X", webhookUrl: "http://unsicher.example.com/x" })).status, 400);
  const res = await post({ name: "IT", webhookUrl: "https://prod.westeurope.logic.azure.com/workflows/1?sig=geheim" });
  assert.equal(res.status, 200);
  const ch = await res.json();
  assert.equal(ch.webhookUrl, "https://prod.westeurope.logic.azure.com/…");
  assert.equal(ch.enabled, false);
  const list = await (await fetch(`${app.url}/api/channels`)).text();
  assert.ok(!list.includes("geheim"));
});

test("Produkt mit Kanal-Zuordnung meldet nur an diese Kanäle", async (t) => {
  const a = await mockTeams(t);
  const b = await mockTeams(t);
  let list = [{ line: "1", version: "1.0", type: "major", sortKey: [1, 0] }];
  const { db, runner, notifier, addChannel } = setup(() => list);
  const chA = addChannel(a.url);
  await notifier.sendTest(chA);
  await notifier.sendTest(addChannel(b.url));
  db.prepare("INSERT INTO product_channels (product_id, channel_id) SELECT id, ? FROM products").run(chA);
  await runner.start("cli").done;
  list = [...list, { line: "1", version: "1.1", type: "servicepack", sortKey: [1, 1] }];
  await runner.start("cli").done;
  assert.equal(a.posts.length, 2);
  assert.equal(b.posts.length, 1, "nur die Testnachricht");
});
