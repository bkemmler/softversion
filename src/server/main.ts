import { join } from "node:path";
import { initLogFiles, writeLog } from "./log.ts";
import { startHttp } from "./server.ts";
import { createApp, ROOT } from "./app.ts";
import { createApi } from "./api.ts";
import pkg from "../../package.json" with { type: "json" };

const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, "data");
const PORT = Number(process.env.PORT ?? 8080);

try {
  initLogFiles(DATA_DIR);
  const app = await createApp({ dataDir: DATA_DIR, trackerDir: process.env.TRACKER_DIR });
  startHttp(createApi(app), join(ROOT, "dist/web"), PORT);
  writeLog("info", "softversion gestartet", { version: pkg.version, dataDir: DATA_DIR, trackers: app.trackers.size });
} catch (e) {
  writeLog("error", "Start fehlgeschlagen", { err: e instanceof Error ? e.message : String(e) });
  process.exit(1);
}
