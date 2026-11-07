import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Tracker } from "./tracker.ts";
import type { DB } from "./db.ts";

export const TRACKER_DIR = join(import.meta.dirname, "trackers");

/** Lädt alle Tracker-Dateien eines Ordners (ohne `_`-Präfix und ohne Tests). */
export async function loadTrackers(dir = TRACKER_DIR): Promise<Map<string, Tracker>> {
  const map = new Map<string, Tracker>();
  for (const f of readdirSync(dir).sort()) {
    if (f.startsWith("_") || !f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const t = (await import(pathToFileURL(join(dir, f)).href)).default as Tracker;
    if (!t?.id || typeof t.fetchReleases !== "function") throw new Error(`${f}: kein gültiger Tracker (export default defineTracker(...))`);
    if (map.has(t.id)) throw new Error(`Tracker-ID doppelt: ${t.id}`);
    map.set(t.id, t);
  }
  return map;
}

/** Gleicht die Tabelle products mit der Registry ab: neue Tracker anlegen (deaktiviert), fehlende markieren. */
export function syncProducts(db: DB, trackers: Map<string, Tracker>) {
  const upsert = db.prepare(`INSERT INTO products (tracker_id, vendor, product) VALUES (?, ?, ?)
    ON CONFLICT(tracker_id) DO UPDATE SET vendor = excluded.vendor, product = excluded.product,
      status = CASE WHEN status = 'missing' THEN 'new' ELSE status END`);
  for (const t of trackers.values()) upsert.run(t.id, t.vendor, t.product);
  const ids = [...trackers.keys()];
  db.prepare(`UPDATE products SET status = 'missing' WHERE tracker_id NOT IN (SELECT value FROM json_each(?))`).run(JSON.stringify(ids));
}
