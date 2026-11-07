import { readFileSync } from "node:fs";
import { defineTracker, type ReleaseInfo } from "../../../src/server/tracker.ts";

/** Demo-Tracker für Tests: liest die Fixture aus DEMO_FIXTURE statt aus dem Netz. */
export function parseDemo(html: string): ReleaseInfo[] {
  return [...html.matchAll(/data-version="(\d+)\.(\d+)\.(\d+)"/g)].map(([, a, b, c]) => ({
    line: a,
    version: `${a}.${b}.${c}`,
    type: c !== "0" ? "hotfix" : b !== "0" ? "servicepack" : "major",
    sortKey: [+a, +b, +c],
  }));
}

export default defineTracker({
  id: "demo-product",
  vendor: "Demo Vendor",
  product: "Demo Product",
  sources: ["https://example.com/demo"],
  async fetchReleases() {
    return parseDemo(readFileSync(process.env.DEMO_FIXTURE!, "utf8"));
  },
});
