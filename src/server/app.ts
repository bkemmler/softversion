import { join } from "node:path";
import { openDb } from "./db.ts";
import { loadTrackers, syncProducts, TRACKER_DIR } from "./registry.ts";
import { createRunner, markAbortedRuns } from "./runner.ts";
import { createSecretBox } from "./crypto.ts";
import { createNotifier } from "./notifier.ts";

export const ROOT = join(import.meta.dirname, "../..");

/** Verdrahtet Datenbank, Tracker-Registry, Verschlüsselung, Notifier und Runner; genutzt von Server (main.ts) und CLI. */
export async function createApp(opts: { dataDir: string; trackerDir?: string; appSecret?: string }) {
  const box = createSecretBox(opts.appSecret ?? process.env.APP_SECRET);
  const db = openDb(join(opts.dataDir, "softversion.db"));
  const trackers = await loadTrackers(opts.trackerDir ?? TRACKER_DIR);
  syncProducts(db, trackers);
  markAbortedRuns(db);
  const notifier = createNotifier(db, box);
  const getCredentials = (trackerId: string) => {
    const row = db.prepare("SELECT username, secret FROM credentials WHERE tracker_id = ?").get(trackerId) as { username: string; secret: string } | undefined;
    return row ? { username: row.username, secret: box.decrypt(row.secret) } : null;
  };
  const runner = createRunner({ db, trackers, notifier, getCredentials });
  return { db, box, trackers, notifier, runner, dataDir: opts.dataDir };
}
export type App = Awaited<ReturnType<typeof createApp>>;
