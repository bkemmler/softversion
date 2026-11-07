import { getSetting, now, setSetting, tx } from "./db.ts";
import { maskUrl } from "./crypto.ts";
import { writeLog } from "./log.ts";
import { HttpError, Router } from "./server.ts";
import type { App } from "./app.ts";
import type { Scheduler } from "./scheduler.ts";
import * as S from "../shared/api.ts";
import pkg from "../../package.json" with { type: "json" };

type ChannelRow = { id: number; name: string; type: string; webhook_url: string; enabled: number; last_error: string | null; created_at: string };
type ProductRow = { id: number; tracker_id: string; vendor: string; product: string; enabled: number; auto_enable_new_lines: number; status: S.Product["status"]; last_check_at: string | null; last_error: string | null; consecutive_failures: number };
type LineRow = { id: number; product_id: number; line_key: string; enabled: number; first_seen_at: string; latest: string | null; latest_key: string | null };
type RunRow = { id: number; started_at: string; finished_at: string | null; trigger: string; status: string; checked: number; failed: number; new_count: number };

const RELEASE_SELECT = `SELECT r.id, p.id AS productId, p.vendor, p.product, l.line_key AS lineKey, r.version, r.type,
  r.release_date AS releaseDate, r.notes_url AS notesUrl, r.download_url AS downloadUrl, r.first_seen_at AS firstSeenAt
  FROM releases r JOIN version_lines l ON l.id = r.line_id JOIN products p ON p.id = l.product_id`;
const RUN_SELECT = `SELECT r.*, COUNT(c.id) AS checked, COALESCE(SUM(c.status = 'error'), 0) AS failed, COALESCE(SUM(c.new_count), 0) AS new_count
  FROM check_runs r LEFT JOIN check_results c ON c.run_id = r.id`;
const toRun = (r: RunRow): S.Run => ({ id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, trigger: r.trigger, status: r.status, checked: r.checked, failed: r.failed, newCount: r.new_count });

/** REST-API unter /api. Eingaben werden mit den zod-Schemas aus src/shared/api.ts geprüft. */
export function createApi(app: App, scheduler: Scheduler) {
  const { db, box, notifier, runner, trackers } = app;
  const r = new Router();
  const count = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n;

  r.add("GET", "/api/health", (): S.Health => {
    db.prepare("SELECT 1").get();
    const alive = scheduler.alive();
    if (!alive) throw new HttpError(503, "Scheduler läuft nicht");
    return { ok: true, version: pkg.version, scheduler: alive, nextRun: scheduler.nextRun() };
  });

  // ---- Übersicht ----
  r.add("GET", "/api/overview", (): S.Overview => {
    const last = db.prepare(`${RUN_SELECT} GROUP BY r.id ORDER BY r.id DESC LIMIT 1`).get() as RunRow | undefined;
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    return {
      version: pkg.version,
      lastRun: last ? toRun(last) : null,
      nextRun: scheduler.nextRun(),
      running: runner.isRunning(),
      // Ohne Baseline: alles, was nach dem ersten Lauf des Produkts dazukam.
      recentReleases: db.prepare(`${RELEASE_SELECT} WHERE r.first_seen_at >= ? AND r.first_seen_at >
          (SELECT MIN(r2.first_seen_at) FROM releases r2 JOIN version_lines l2 ON l2.id = r2.line_id WHERE l2.product_id = p.id)
        ORDER BY r.first_seen_at DESC, r.id DESC LIMIT 50`).all(since) as S.Release[],
      failingProducts: (db.prepare("SELECT id, vendor, product, last_error, consecutive_failures FROM products WHERE status = 'error' ORDER BY vendor, product").all() as ProductRow[])
        .map((p) => ({ id: p.id, vendor: p.vendor, product: p.product, lastError: p.last_error, consecutiveFailures: p.consecutive_failures })),
      counts: {
        products: count("SELECT COUNT(*) n FROM products WHERE status != 'missing'"),
        enabled: count("SELECT COUNT(*) n FROM products WHERE enabled = 1 AND status != 'missing'"),
        channels: count("SELECT COUNT(*) n FROM channels WHERE enabled = 1"),
        pendingNotifications: count("SELECT COUNT(*) n FROM notifications WHERE status = 'pending'"),
      },
    };
  });

  // ---- Produkte und Versionslinien ----
  function listProducts(id?: number): S.Product[] {
    const products = db.prepare(`SELECT * FROM products ${id ? "WHERE id = ?" : ""} ORDER BY vendor, product`).all(...(id ? [id] : [])) as ProductRow[];
    const lines = db.prepare(`SELECT l.*, (SELECT version FROM releases WHERE line_id = l.id ORDER BY sort_key DESC LIMIT 1) AS latest,
      (SELECT MAX(sort_key) FROM releases WHERE line_id = l.id) AS latest_key FROM version_lines l ORDER BY l.line_key DESC`).all() as LineRow[];
    const byProduct = Map.groupBy(lines, (l) => l.product_id);
    const creds = new Set((db.prepare("SELECT tracker_id FROM credentials").all() as { tracker_id: string }[]).map((c) => c.tracker_id));
    const mapping = Map.groupBy(db.prepare("SELECT product_id, channel_id FROM product_channels").all() as { product_id: number; channel_id: number }[], (m) => m.product_id);
    return products.map((p) => {
      const pl = byProduct.get(p.id) ?? [];
      const t = trackers.get(p.tracker_id);
      // Neueste Version über alle Linien: Linie mit höchstem line_key (Linien sind i. d. R. Jahres-/Hauptversionen)
      const newest = pl.filter((l) => l.latest).sort((a, b) => b.line_key.localeCompare(a.line_key, undefined, { numeric: true }))[0];
      return {
        id: p.id, trackerId: p.tracker_id, vendor: p.vendor, product: p.product, enabled: !!p.enabled, autoEnableNewLines: !!p.auto_enable_new_lines,
        status: p.status, lastCheckAt: p.last_check_at, lastError: p.last_error, consecutiveFailures: p.consecutive_failures,
        latestVersion: newest?.latest ?? null, requiresCredentials: !!t?.requiresCredentials, hasCredentials: creds.has(p.tracker_id),
        sources: t?.sources ?? [], channelIds: (mapping.get(p.id) ?? []).map((m) => m.channel_id),
        lines: pl.sort((a, b) => b.line_key.localeCompare(a.line_key, undefined, { numeric: true }))
          .map((l) => ({ id: l.id, lineKey: l.line_key, enabled: !!l.enabled, latestVersion: l.latest, firstSeenAt: l.first_seen_at })),
      };
    });
  }
  const getProduct = (id: number) => listProducts(id)[0] ?? (() => { throw new HttpError(404, "Produkt nicht gefunden"); })();

  r.add("GET", "/api/products", () => listProducts());
  r.add("PATCH", "/api/products/:id", ({ params, body }) => {
    const { id } = S.idParam.parse(params);
    const b = S.productUpdate.parse(body);
    getProduct(id);
    if (b.enabled !== undefined) db.prepare("UPDATE products SET enabled = ? WHERE id = ?").run(b.enabled ? 1 : 0, id);
    if (b.autoEnableNewLines !== undefined) db.prepare("UPDATE products SET auto_enable_new_lines = ? WHERE id = ?").run(b.autoEnableNewLines ? 1 : 0, id);
    return getProduct(id);
  });
  r.add("POST", "/api/products/bulk", ({ body }) => {
    const b = S.productBulkUpdate.parse(body);
    const n = db.prepare("UPDATE products SET enabled = ? WHERE id IN (SELECT value FROM json_each(?))").run(b.enabled ? 1 : 0, JSON.stringify(b.ids)).changes;
    return { updated: Number(n) };
  });
  r.add("PUT", "/api/products/:id/channels", ({ params, body }) => {
    const { id } = S.idParam.parse(params);
    const b = S.productChannels.parse(body);
    getProduct(id);
    tx(db, () => {
      db.prepare("DELETE FROM product_channels WHERE product_id = ?").run(id);
      for (const ch of b.channelIds) db.prepare("INSERT OR IGNORE INTO product_channels (product_id, channel_id) SELECT ?, id FROM channels WHERE id = ?").run(id, ch);
    });
    return getProduct(id);
  });
  r.add("PATCH", "/api/lines/:id", ({ params, body }) => {
    const { id } = S.idParam.parse(params);
    const b = S.lineUpdate.parse(body);
    if (!db.prepare("UPDATE version_lines SET enabled = ? WHERE id = ?").run(b.enabled ? 1 : 0, id).changes) throw new HttpError(404, "Linie nicht gefunden");
    return { ok: true };
  });

  // ---- Prüfläufe ----
  r.add("POST", "/api/check", ({ body }) => {
    const b = S.checkRequest.parse(body ?? {});
    if (b.trackerId && !trackers.has(b.trackerId)) throw new HttpError(404, "Tracker nicht gefunden");
    if (runner.isRunning()) throw new HttpError(409, "Es läuft bereits eine Prüfung");
    const { runId, done } = runner.start("manual", b.trackerId);
    done.catch((e) => writeLog("error", "Manueller Lauf fehlgeschlagen", { runId, err: String(e) }));
    return { runId };
  });
  r.add("GET", "/api/runs", ({ query }): S.Page<S.Run> => {
    const q = S.pageQuery.parse(Object.fromEntries(query));
    return {
      items: (db.prepare(`${RUN_SELECT} GROUP BY r.id ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(q.limit, q.offset) as RunRow[]).map(toRun),
      total: count("SELECT COUNT(*) n FROM check_runs"),
    };
  });
  r.add("GET", "/api/runs/:id", ({ params }) => {
    const { id } = S.idParam.parse(params);
    const run = db.prepare(`${RUN_SELECT} WHERE r.id = ? GROUP BY r.id`).get(id) as RunRow | undefined;
    if (!run) throw new HttpError(404, "Lauf nicht gefunden");
    const results = db.prepare(`SELECT c.product_id AS productId, p.vendor, p.product, c.status, c.error, c.duration_ms AS durationMs,
      c.found_count AS foundCount, c.new_count AS newCount FROM check_results c JOIN products p ON p.id = c.product_id
      WHERE c.run_id = ? ORDER BY c.status, p.vendor, p.product`).all(id) as S.RunResult[];
    return { run: toRun(run), results };
  });

  // ---- Releases ----
  r.add("GET", "/api/releases", ({ query }): S.Page<S.Release> => {
    const q = S.releasesQuery.parse(Object.fromEntries(query));
    const where = ["1 = 1"];
    const args: (string | number)[] = [];
    if (q.productId) (where.push("p.id = ?"), args.push(q.productId));
    if (q.q) (where.push("(p.vendor || ' ' || p.product || ' ' || r.version) LIKE ?"), args.push(`%${q.q}%`));
    const w = where.join(" AND ");
    return {
      items: db.prepare(`${RELEASE_SELECT} WHERE ${w} ORDER BY r.first_seen_at DESC, r.sort_key DESC LIMIT ? OFFSET ?`).all(...args, q.limit, q.offset) as S.Release[],
      total: count(`SELECT COUNT(*) n FROM releases r JOIN version_lines l ON l.id = r.line_id JOIN products p ON p.id = l.product_id WHERE ${w}`, ...args),
    };
  });
  r.add("POST", "/api/releases/:id/resend", async ({ params }) => {
    const { id } = S.idParam.parse(params);
    let queued: number;
    try {
      queued = notifier.resend(id);
    } catch (e) {
      throw new HttpError(404, String(e instanceof Error ? e.message : e));
    }
    if (!queued) throw new HttpError(409, "Kein aktiver Teams-Kanal");
    if (!runner.isRunning()) await notifier.flush(); // sonst sendet der laufende Lauf am Ende
    const failed = count("SELECT COUNT(*) n FROM notifications WHERE release_id = ? AND status = 'pending' AND attempts > 0", id);
    return { queued, failed };
  });

  // ---- Einstellungen ----
  const readSettings = (): S.Settings => ({
    scheduleTime: getSetting(db, "schedule_time"),
    timezone: getSetting(db, "timezone"),
    failureAlertThreshold: Number(getSetting(db, "failure_alert_threshold")),
  });
  r.add("GET", "/api/settings", readSettings);
  r.add("PUT", "/api/settings", ({ body }) => {
    const b = S.settingsUpdate.parse(body);
    if (b.scheduleTime) setSetting(db, "schedule_time", b.scheduleTime);
    if (b.timezone) setSetting(db, "timezone", b.timezone);
    if (b.failureAlertThreshold) setSetting(db, "failure_alert_threshold", String(b.failureAlertThreshold));
    scheduler.reload();
    return readSettings();
  });

  // ---- Zugangsdaten für Hersteller-Portale ----
  r.add("PUT", "/api/credentials/:trackerId", ({ params, body }) => {
    if (!trackers.has(params.trackerId)) throw new HttpError(404, "Tracker nicht gefunden");
    const b = S.credentialsUpdate.parse(body);
    db.prepare(`INSERT INTO credentials (tracker_id, username, secret, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(tracker_id) DO UPDATE SET username = excluded.username, secret = excluded.secret, updated_at = excluded.updated_at`)
      .run(params.trackerId, b.username, box.encrypt(b.secret), now());
    return { ok: true };
  });
  r.add("DELETE", "/api/credentials/:trackerId", ({ params }) => {
    db.prepare("DELETE FROM credentials WHERE tracker_id = ?").run(params.trackerId);
    return { ok: true };
  });

  // ---- Teams-Kanäle ----
  const toChannel = (c: ChannelRow): S.Channel => ({
    id: c.id, name: c.name, type: c.type, webhookUrl: maskUrl(box.decrypt(c.webhook_url)),
    enabled: !!c.enabled, lastError: c.last_error, createdAt: c.created_at,
  });
  const getChannel = (id: number) => {
    const c = db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRow | undefined;
    if (!c) throw new HttpError(404, "Kanal nicht gefunden");
    return c;
  };
  r.add("GET", "/api/channels", () => (db.prepare("SELECT * FROM channels ORDER BY name").all() as ChannelRow[]).map(toChannel));
  r.add("POST", "/api/channels", ({ body }) => {
    const b = S.channelCreate.parse(body);
    const id = db.prepare("INSERT INTO channels (name, webhook_url, created_at) VALUES (?, ?, ?)").run(b.name, box.encrypt(b.webhookUrl), now()).lastInsertRowid;
    return toChannel(getChannel(Number(id)));
  });
  r.add("PATCH", "/api/channels/:id", ({ params, body }) => {
    const { id } = S.idParam.parse(params);
    const b = S.channelUpdate.parse(body);
    getChannel(id);
    if (b.name) db.prepare("UPDATE channels SET name = ? WHERE id = ?").run(b.name, id);
    // Neue URL muss erst wieder per Testnachricht bestätigt werden.
    if (b.webhookUrl) db.prepare("UPDATE channels SET webhook_url = ?, enabled = 0 WHERE id = ?").run(box.encrypt(b.webhookUrl), id);
    if (b.enabled === false) db.prepare("UPDATE channels SET enabled = 0 WHERE id = ?").run(id);
    return toChannel(getChannel(id));
  });
  r.add("DELETE", "/api/channels/:id", ({ params }) => {
    const { id } = S.idParam.parse(params);
    getChannel(id);
    db.prepare("DELETE FROM channels WHERE id = ?").run(id);
    return { ok: true };
  });
  r.add("POST", "/api/channels/:id/test", async ({ params }) => {
    const { id } = S.idParam.parse(params);
    getChannel(id);
    try {
      await notifier.sendTest(id);
    } catch (e) {
      throw new HttpError(502, `Testnachricht fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    }
    return toChannel(getChannel(id));
  });

  return r;
}
