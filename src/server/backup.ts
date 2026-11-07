import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "./db.ts";
import { writeLog } from "./log.ts";

/** Tägliche, konsistente Kopie der Datenbank nach DATA_DIR/backups (VACUUM INTO), ältere als `keepDays` werden gelöscht. */
export function backupDb(db: DB, dataDir: string, keepDays = 14, today = new Date()) {
  const dir = join(dataDir, "backups");
  mkdirSync(dir, { recursive: true });
  const day = today.toISOString().slice(0, 10);
  const file = join(dir, `softversion-${day}.db`);
  if (existsSync(file)) rmSync(file); // VACUUM INTO verlangt eine nicht existierende Datei
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  const cutoff = new Date(today.getTime() - keepDays * 86400_000).toISOString().slice(0, 10);
  const removed = readdirSync(dir).filter((f) => (f.match(/^softversion-(\d{4}-\d{2}-\d{2})\.db$/)?.[1] ?? "9") < cutoff);
  for (const f of removed) rmSync(join(dir, f));
  writeLog("info", "Datenbank gesichert", { file, removed: removed.length });
  return file;
}
