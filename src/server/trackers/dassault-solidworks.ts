import { load } from "cheerio";
import { defineTracker, type ReleaseInfo, type TrackerContext } from "../tracker.ts";
import { HttpStatusError } from "../http.ts";

/**
 * SOLIDWORKS: Je Jahresversion gibt es eine öffentliche Release-Notes-Seite, deren Titel das aktuelle SP nennt,
 * z. B. "SOLIDWORKS Design 2026 SP5 Release Notes". Vor dem Release steht "Prerelease" im Titel,
 * für künftige Jahre liefert der Server "Document Coming Soon" mit leerem Titel (HTTP 200).
 * Die Seite zeigt nur das aktuelle SP; frühere SPs sammeln sich über die täglichen Läufe in der Datenbank.
 * Quelle recherchiert am 2026-11-07, siehe docs/quellen.md.
 */
const url = (year: number) => `https://files.solidworks.com/Supportfiles/Release_Notes/${year}/English/relnotes.htm`;

/** Reine Parse-Funktion: Titel einer Release-Notes-Seite → Release oder null (noch nicht veröffentlicht). */
export function parseSolidworksPage(html: string, year: number): ReleaseInfo | null {
  const $ = load(html);
  const title = ($("title").text() || $("h1").first().text()).replace(/\s+/g, " ").trim();
  if (!title || /prerelease|beta|coming soon/i.test(title)) return null;
  const m = title.match(/SOLIDWORKS(?: Design)? (\d{4})(?: SP ?(\d+)(?:\.(\d+))?)? Release Notes/i);
  if (!m) throw new Error(`Unerwarteter Seitentitel für ${year}: "${title.slice(0, 120)}"`);
  if (Number(m[1]) !== year) throw new Error(`Seite für ${year} nennt Version ${m[1]}`);
  const sp = Number(m[2] ?? 0);
  const minor = Number(m[3] ?? 0);
  return {
    line: String(year),
    version: `${year} SP${sp}${m[3] ? `.${minor}` : ""}`,
    type: sp === 0 ? "major" : "servicepack",
    notesUrl: url(year),
    sortKey: [year, sp, minor],
  };
}

/** Prüft die Jahresversionen von (aktuelles Jahr − 2) bis (aktuelles Jahr + 1). */
export async function fetchSolidworks(ctx: TrackerContext, today = new Date()): Promise<ReleaseInfo[]> {
  const y = today.getFullYear();
  const out: ReleaseInfo[] = [];
  for (const year of [y - 2, y - 1, y, y + 1]) {
    let html: string;
    try {
      html = await ctx.http.getText(url(year));
    } catch (e) {
      if (e instanceof HttpStatusError && e.status === 404) continue;
      throw e;
    }
    const r = parseSolidworksPage(html, year);
    if (r) out.push(r);
  }
  return out; // leer → Runner meldet Fehler
}

export default defineTracker({
  id: "dassault-solidworks",
  vendor: "Dassault Systèmes",
  product: "SOLIDWORKS",
  sources: ["https://files.solidworks.com/Supportfiles/Release_Notes/"],
  fetchReleases: (ctx) => fetchSolidworks(ctx),
});
