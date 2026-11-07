import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeLog } from "./log.ts";

export type DB = DatabaseSync;
const MIGRATIONS = join(import.meta.dirname, "migrations");

/** Öffnet die Datenbank und spielt fehlende Migrationen ein (Stand in PRAGMA user_version). */
export function openDb(file: string): DB {
  if (file !== ":memory:") mkdirSync(join(file, ".."), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const current = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    const n = parseInt(f, 10);
    if (n <= current) continue;
    tx(db, () => {
      db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
      db.exec(`PRAGMA user_version = ${n}`);
    });
    writeLog("info", "Migration eingespielt", { migration: f });
  }
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const now = () => new Date().toISOString();

export function getSetting(db: DB, key: string): string {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? "";
}
export function setSetting(db: DB, key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
