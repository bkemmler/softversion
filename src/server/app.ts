import { join } from "node:path";
import { openDb } from "./db.ts";
import { loadTrackers, syncProducts, TRACKER_DIR } from "./registry.ts";
import { createRunner, markAbortedRuns } from "./runner.ts";

export const ROOT = join(import.meta.dirname, "../..");

/** Verdrahtet Datenbank, Tracker-Registry und Runner; genutzt von Server (main.ts) und CLI. */
export async function createApp(opts: { dataDir: string; trackerDir?: string }) {
  const db = openDb(join(opts.dataDir, "softversion.db"));
  const trackers = await loadTrackers(opts.trackerDir ?? TRACKER_DIR);
  syncProducts(db, trackers);
  markAbortedRuns(db);
  const runner = createRunner({ db, trackers });
  return { db, trackers, runner };
}
export type App = Awaited<ReturnType<typeof createApp>>;
