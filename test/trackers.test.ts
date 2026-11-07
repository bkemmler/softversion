import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchSolidworks, parseSolidworksPage } from "../src/server/trackers/dassault-solidworks.ts";
import { parseCreoKb } from "../src/server/trackers/ptc-creo.ts";
import { HttpStatusError } from "../src/server/http.ts";
import { validateReleases, type TrackerContext } from "../src/server/tracker.ts";
import { loadTrackers } from "../src/server/registry.ts";

const fx = (p: string) => readFileSync(join(import.meta.dirname, "fixtures", p), "utf8");

/** Kontext ohne Netz: URLs werden auf Fixtures abgebildet, unbekannte URLs liefern 404. */
function offlineCtx(pages: Record<string, string>): TrackerContext {
  const getText = async (url: string) => {
    if (url in pages) return pages[url];
    throw new HttpStatusError(404, url);
  };
  return { http: { getText, getJson: async (u) => JSON.parse(await getText(u)) }, credentials: null, log: () => {}, signal: new AbortController().signal };
}

test("SOLIDWORKS: Titel mit SP, ohne SP, Prerelease und 'Coming Soon'", () => {
  assert.deepEqual(parseSolidworksPage(fx("solidworks/relnotes-2026.htm"), 2026), {
    line: "2026", version: "2026 SP5", type: "servicepack", sortKey: [2026, 5, 0],
    notesUrl: "https://files.solidworks.com/Supportfiles/Release_Notes/2026/English/relnotes.htm",
  });
  assert.equal(parseSolidworksPage(fx("solidworks/relnotes-2025.htm"), 2025)?.version, "2025 SP5");
  assert.equal(parseSolidworksPage(fx("solidworks/relnotes-2027.htm"), 2027), null);
  assert.equal(parseSolidworksPage(fx("solidworks/relnotes-2028.htm"), 2028), null);
  const base = parseSolidworksPage("<title>SOLIDWORKS Design 2027 Release Notes</title>", 2027);
  assert.deepEqual([base?.version, base?.type, base?.sortKey], ["2027 SP0", "major", [2027, 0, 0]]);
  assert.equal(parseSolidworksPage("<title>SOLIDWORKS 2026 SP2.1 Release Notes</title>", 2026)?.version, "2026 SP2.1");
  assert.throws(() => parseSolidworksPage("<title>Wartungsarbeiten</title>", 2026), /Unerwarteter Seitentitel/);
  assert.throws(() => parseSolidworksPage("<title>SOLIDWORKS 2025 SP5 Release Notes</title>", 2026), /nennt Version 2025/);
});

test("Abnahme Stage 4: SOLIDWORKS findet die neueste Version jeder Linie (offline)", async () => {
  const u = (y: number) => `https://files.solidworks.com/Supportfiles/Release_Notes/${y}/English/relnotes.htm`;
  const ctx = offlineCtx({
    [u(2025)]: fx("solidworks/relnotes-2025.htm"),
    [u(2026)]: fx("solidworks/relnotes-2026.htm"),
    [u(2027)]: fx("solidworks/relnotes-2027.htm"),
  });
  const list = validateReleases(await fetchSolidworks(ctx, new Date("2026-11-07")));
  assert.deepEqual(list.map((r) => r.version), ["2025 SP5", "2026 SP5"]);
  await assert.rejects(async () => validateReleases(await fetchSolidworks(offlineCtx({}), new Date("2026-11-07"))), /keine Versionen/);
});

test("Abnahme Stage 4: Creo findet je Linie die höchste Version (offline)", () => {
  const list = validateReleases(parseCreoKb(fx("ptc-creo/CS34553.html")));
  const byLine = Object.fromEntries(list.map((r) => [r.line, r.version]));
  assert.deepEqual(byLine, {
    "7": "Creo 7.0", "8": "Creo 8.0", "9": "Creo 9.0", "10": "Creo 10.0", "11": "Creo 11.0",
    "12": "Creo 12.4", "13": "Creo 13.4", "2027": "Creo 2027.2",
  });
  assert.equal(list.find((r) => r.line === "2027")?.type, "servicepack");
  assert.ok(!list.some((r) => r.version.includes("Wildfire")));
  assert.throws(() => parseCreoKb("<html><body>Bitte anmelden</body></html>"), /nicht gefunden/);
});

test("Registry lädt die echten Tracker mit eindeutigen IDs", async () => {
  const t = await loadTrackers();
  assert.ok(t.has("dassault-solidworks"));
  assert.ok(t.has("ptc-creo"));
});
