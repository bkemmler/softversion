/**
 * Einmaliger Prüflauf ohne Server: `npm run check` (alle aktiven Produkte) oder `npm run check -- <tracker-id>`.
 * Umgebungsvariablen wie beim Server (DATA_DIR, APP_SECRET, TRACKER_DIR für Tests). Exit-Code 1 bei Fehlern.
 */
import { join } from "node:path";
import { createApp, ROOT } from "./app.ts";
import { initLogFiles } from "./log.ts";

const dataDir = process.env.DATA_DIR ?? join(ROOT, "data");
initLogFiles(dataDir);
const app = await createApp({ dataDir, trackerDir: process.env.TRACKER_DIR });
const trackerId = process.argv[2];
if (trackerId && !app.trackers.has(trackerId)) {
  console.error(`Unbekannter Tracker: ${trackerId}. Vorhanden: ${[...app.trackers.keys()].join(", ")}`);
  process.exit(2);
}
const summary = await app.runner.start("cli", trackerId).done;
console.log(JSON.stringify(summary));
process.exit(summary.status === "ok" ? 0 : 1);
