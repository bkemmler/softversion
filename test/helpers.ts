import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

/** Startet den echten Server als Kindprozess mit eigenem Datenverzeichnis und freiem Port. */
export async function startApp(t: TestContext, env: Record<string, string> = {}) {
  const dataDir = env.DATA_DIR ?? mkdtempSync(join(tmpdir(), "sv-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server/main.ts"], {
    env: { ...process.env, APP_SECRET: "test-secret-0123456789", LOG_LEVEL: "warn", ...env, DATA_DIR: dataDir, PORT: String(port) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  t.after(() => proc.kill());
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${url}/api/health`).then(() => true, () => false)) return { url, dataDir, proc };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Server startet nicht");
}
