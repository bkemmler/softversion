import { now, tx, getSetting, type DB } from "./db.ts";
import { childLog, writeLog } from "./log.ts";
import { createHttp } from "./http.ts";
import { encodeSortKey, validateReleases, type ReleaseInfo, type Tracker } from "./tracker.ts";

export type Trigger = "schedule" | "manual" | "cli";

/** Was der Runner vom Notifier braucht (Stage 2). Ohne Notifier wird nur gespeichert. */
export type RunNotifier = {
  enqueueRelease(releaseId: number, productId: number): void;
  enqueueAlert(productId: number, text: string): void;
  flush(): Promise<void>;
};

export type RunnerDeps = {
  db: DB;
  trackers: Map<string, Tracker>;
  notifier?: RunNotifier;
  getCredentials?: (trackerId: string) => { username: string; secret: string } | null;
  concurrency?: number;
  timeoutMs?: number;
  http?: { timeoutMs: number; retries: number; hostGapMs: number; backoffMs: number };
};

type ProductRow = { id: number; tracker_id: string; vendor: string; product: string; baselined: number; auto_enable_new_lines: number; consecutive_failures: number; failure_alerted: number };
export type RunSummary = { runId: number; status: string; checked: number; failed: number; newReleases: number };

export function createRunner(deps: RunnerDeps) {
  const { db } = deps;
  let current: Promise<RunSummary> | null = null;

  /** Startet einen Lauf (alle aktiven Produkte oder eines). Es läuft immer nur ein Lauf gleichzeitig. */
  function start(trigger: Trigger, trackerId?: string): { runId: number; done: Promise<RunSummary> } {
    if (current) throw new Error("Es läuft bereits eine Prüfung");
    const runId = Number(db.prepare("INSERT INTO check_runs (started_at, trigger, status) VALUES (?, ?, 'running')").run(now(), trigger).lastInsertRowid);
    current = execute(runId, trackerId).finally(() => (current = null));
    return { runId, done: current };
  }

  async function execute(runId: number, trackerId?: string): Promise<RunSummary> {
    const products = (trackerId
      ? db.prepare("SELECT * FROM products WHERE tracker_id = ?").all(trackerId)
      : db.prepare("SELECT * FROM products WHERE enabled = 1 AND status != 'missing' ORDER BY tracker_id").all()) as ProductRow[];
    writeLog("info", "Prüflauf gestartet", { runId, products: products.length });
    let failed = 0, newReleases = 0;
    const queue = [...products];
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        const r = await checkProduct(runId, p);
        if (r === null) failed++;
        else newReleases += r;
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? 4, queue.length) }, worker));
      await deps.notifier?.flush();
    } catch (e) {
      writeLog("error", "Prüflauf abgebrochen", { runId, err: String(e) });
      failed = products.length;
    }
    const status = !products.length || failed === 0 ? "ok" : failed === products.length ? "error" : "partial";
    db.prepare("UPDATE check_runs SET finished_at = ?, status = ? WHERE id = ?").run(now(), status, runId);
    writeLog("info", "Prüflauf beendet", { runId, status, checked: products.length, failed, newReleases });
    return { runId, status, checked: products.length, failed, newReleases };
  }

  /** Prüft ein Produkt; liefert die Zahl neuer gemeldeter Releases oder null bei Fehler. */
  async function checkProduct(runId: number, p: ProductRow): Promise<number | null> {
    const started = Date.now();
    const log = childLog({ tracker: p.tracker_id, runId });
    const tracker = deps.trackers.get(p.tracker_id);
    const ac = new AbortController();
    const timeoutMs = deps.timeoutMs ?? 60_000;
    const timer = setTimeout(() => ac.abort(new Error(`Zeitüberschreitung nach ${timeoutMs / 1000} s`)), timeoutMs);
    try {
      if (!tracker) throw new Error("Tracker-Modul nicht vorhanden");
      const credentials = deps.getCredentials?.(p.tracker_id) ?? null;
      if (tracker.requiresCredentials && !credentials) throw new Error("Zugangsdaten fehlen (Einstellungen → Zugangsdaten)");
      const ctx = { http: createHttp(ac.signal, log, deps.http), credentials, log, signal: ac.signal };
      const aborted = new Promise<never>((_, rej) => ac.signal.addEventListener("abort", () => rej(ac.signal.reason), { once: true }));
      const releases = validateReleases(await Promise.race([tracker.fetchReleases(ctx), aborted]));
      const created = applyReleases(p, releases);
      db.prepare("INSERT INTO check_results (run_id, product_id, status, duration_ms, found_count, new_count) VALUES (?, ?, 'ok', ?, ?, ?)")
        .run(runId, p.id, Date.now() - started, releases.length, created);
      log("info", "Produkt geprüft", { found: releases.length, notified: created, ms: Date.now() - started });
      return created;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      recordFailure(p, err);
      db.prepare("INSERT INTO check_results (run_id, product_id, status, error, duration_ms) VALUES (?, ?, 'error', ?, ?)")
        .run(runId, p.id, err.slice(0, 2000), Date.now() - started);
      log("warn", "Produktprüfung fehlgeschlagen", { err });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Speichert Releases und entscheidet, was gemeldet wird:
   * - Baseline: beim ersten erfolgreichen Lauf eines Produkts wird nur gespeichert.
   * - Gemeldet wird nur, was in einer aktiven Linie einen höheren sortKey als alles Bekannte hat
   *   (bei einer neuen Linie nur deren neueste Version). Nichts wird gelöscht (kein Rückschritt).
   */
  function applyReleases(p: ProductRow, releases: ReleaseInfo[]): number {
    return tx(db, () => {
      const ts = now();
      const firstRun = !p.baselined;
      const byLine = Map.groupBy(releases, (r) => r.line);
      let notified = 0;
      for (const [lineKey, list] of byLine) {
        db.prepare("INSERT OR IGNORE INTO version_lines (product_id, line_key, enabled, first_seen_at) VALUES (?, ?, ?, ?)")
          .run(p.id, lineKey, p.auto_enable_new_lines, ts);
        const line = db.prepare("SELECT id, enabled FROM version_lines WHERE product_id = ? AND line_key = ?").get(p.id, lineKey) as { id: number; enabled: number };
        const prevMax = (db.prepare("SELECT MAX(sort_key) AS m FROM releases WHERE line_id = ?").get(line.id) as { m: string | null }).m;
        const newestInBatch = list.map((r) => encodeSortKey(r.sortKey)).sort().at(-1)!;
        for (const r of list) {
          const sortKey = encodeSortKey(r.sortKey);
          const res = db.prepare(`INSERT OR IGNORE INTO releases (line_id, version, type, release_date, notes_url, download_url, sort_key, first_seen_at, fingerprint)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(line.id, r.version, r.type, r.releaseDate ?? null, r.notesUrl ?? null, r.downloadUrl ?? null, sortKey, ts, `${line.id}:${r.version}`);
          if (!res.changes || firstRun || !line.enabled) continue;
          if (prevMax === null ? sortKey !== newestInBatch : sortKey <= prevMax) continue;
          deps.notifier?.enqueueRelease(Number(res.lastInsertRowid), p.id);
          notified++;
        }
      }
      db.prepare(`UPDATE products SET baselined = 1, status = 'ok', consecutive_failures = 0, failure_alerted = 0,
        last_check_at = ?, last_error = NULL WHERE id = ?`).run(ts, p.id);
      return notified;
    });
  }

  /** Fehler zählen; ab der Schwelle (Einstellung) genau eine Ausfall-Warnung bis zum nächsten Erfolg. */
  function recordFailure(p: ProductRow, err: string) {
    const failures = p.consecutive_failures + 1;
    const threshold = Number(getSetting(db, "failure_alert_threshold")) || 3;
    const alert = failures >= threshold && !p.failure_alerted && !!deps.notifier;
    tx(db, () => {
      db.prepare("UPDATE products SET status = 'error', consecutive_failures = ?, failure_alerted = failure_alerted OR ?, last_check_at = ?, last_error = ? WHERE id = ?")
        .run(failures, alert ? 1 : 0, now(), err.slice(0, 2000), p.id);
      if (alert) deps.notifier!.enqueueAlert(p.id, `Tracker "${p.vendor} ${p.product}" ist ${failures}-mal in Folge fehlgeschlagen: ${err.slice(0, 300)}`);
    });
  }

  return { start, isRunning: () => current !== null };
}
export type Runner = ReturnType<typeof createRunner>;

/** Beim Start: Läufe, die durch Neustart/Absturz nicht beendet wurden, als abgebrochen markieren. */
export function markAbortedRuns(db: DB) {
  const n = db.prepare("UPDATE check_runs SET status = 'aborted', finished_at = ? WHERE status = 'running'").run(now()).changes;
  if (n) writeLog("warn", "Unterbrochene Läufe als abgebrochen markiert", { count: n });
}
