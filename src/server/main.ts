import { join } from "node:path";
import { initLogFiles, writeLog } from "./log.ts";
import { Router, startHttp } from "./server.ts";
import { createApp, ROOT } from "./app.ts";
import pkg from "../../package.json" with { type: "json" };

const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, "data");
const PORT = Number(process.env.PORT ?? 8080);

initLogFiles(DATA_DIR);
const app = await createApp({ dataDir: DATA_DIR });
const router = new Router().add("GET", "/api/health", () => {
  app.db.prepare("SELECT 1").get();
  return { ok: true, version: pkg.version };
});
startHttp(router, join(ROOT, "dist/web"), PORT);
writeLog("info", "softversion gestartet", { version: pkg.version, dataDir: DATA_DIR, trackers: app.trackers.size });
