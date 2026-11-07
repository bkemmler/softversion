import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Strukturiertes Logging: JSON-Zeilen nach stdout und zusätzlich in DATA_DIR/logs/app-YYYY-MM-DD.log. Nie Geheimnisse übergeben. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

const minLevel = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;
let logDir: string | undefined;

export function initLogFiles(dataDir: string, keepDays = 14) {
  logDir = join(dataDir, "logs");
  mkdirSync(logDir, { recursive: true });
  const cutoff = new Date(Date.now() - keepDays * 86400_000).toISOString().slice(0, 10);
  for (const f of readdirSync(logDir)) {
    const day = f.match(/^app-(\d{4}-\d{2}-\d{2})\.log$/)?.[1];
    if (day && day < cutoff) rmSync(join(logDir, f));
  }
}

export function writeLog(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (LEVELS[level] < minLevel) return;
  const time = new Date().toISOString();
  const line = JSON.stringify({ time, level, msg, ...fields }) + "\n";
  (level === "error" ? process.stderr : process.stdout).write(line);
  if (logDir) {
    try {
      appendFileSync(join(logDir, `app-${time.slice(0, 10)}.log`), line, "utf8");
    } catch {
      // Logdatei nicht schreibbar: stdout reicht, Betrieb nicht abbrechen.
    }
  }
}

/** Logger mit festen Feldern, z. B. { tracker: "dassault-solidworks" }. */
export function childLog(base: Record<string, unknown>) {
  return (level: Level, msg: string, fields: Record<string, unknown> = {}) => writeLog(level, msg, { ...base, ...fields });
}
export type Logger = ReturnType<typeof childLog>;
