import { Cron } from "croner";
import { getSetting, type DB } from "./db.ts";
import { writeLog } from "./log.ts";
import type { Runner } from "./runner.ts";

/** Täglicher Prüflauf zur Uhrzeit/Zeitzone aus den Einstellungen; `reload()` nach Änderung in der UI. */
export function createScheduler(db: DB, runner: Runner, afterRun: () => void = () => {}) {
  let job: Cron | null = null;

  async function tick() {
    if (runner.isRunning()) return writeLog("warn", "Geplanter Lauf übersprungen, es läuft bereits einer");
    try {
      await runner.start("schedule").done;
      afterRun();
    } catch (e) {
      writeLog("error", "Geplanter Lauf fehlgeschlagen", { err: String(e) });
    }
  }

  function reload() {
    job?.stop();
    const [h, m] = (getSetting(db, "schedule_time") || "06:00").split(":").map(Number);
    const timezone = getSetting(db, "timezone") || "Europe/Berlin";
    job = new Cron(`${m} ${h} * * *`, { timezone, protect: true }, tick);
    writeLog("info", "Zeitplan gesetzt", { time: `${h}:${String(m).padStart(2, "0")}`, timezone, nextRun: job.nextRun()?.toISOString() });
  }

  reload();
  return {
    reload,
    nextRun: () => job?.nextRun()?.toISOString() ?? null,
    alive: () => !!job && job.isRunning(),
    stop: () => job?.stop(),
  };
}
export type Scheduler = ReturnType<typeof createScheduler>;
