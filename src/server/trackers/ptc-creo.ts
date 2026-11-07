import { load } from "cheerio";
import { defineTracker, type ReleaseInfo } from "../tracker.ts";

/**
 * PTC Creo Parametric: Eine öffentliche, vollständige Release-Liste gibt es nicht (Product Calendar und
 * Release Notes brauchen ein PTC-Konto). Öffentlich ist der Knowledge-Hub-Artikel CS34553; PTC pflegt dort in
 * "Applies To" und "Description" die aktuellen Versionen (Stand 2026-11: "Creo Parametric 7.0 to 2027.2", 12.4, 13.4).
 * Benennung seit Creo 12: Maintenance Releases als 12.1, 12.2 …, ab 2027 jahresbasiert (2027.1, 2027.2 …).
 * Best effort: Der Artikel wird von Hand gepflegt und kann nachhinken. Siehe docs/quellen.md.
 */
const SOURCE = "https://www.ptc.com/en/support/article/CS34553";

/** Reine Parse-Funktion: je Hauptversion (Linie) die höchste genannte Version. */
export function parseCreoKb(html: string): ReleaseInfo[] {
  const $ = load(html);
  const section = (heading: string) =>
    $("h2").filter((_, h) => $(h).text().trim() === heading).first().parent().find("li").map((_, li) => $(li).text()).get();
  const texts = [...section("Applies To"), ...section("Description")].filter((t) => /Creo(?! Elements)/.test(t));
  if (!texts.length) throw new Error('Abschnitte "Applies To"/"Description" mit Creo nicht gefunden (Seitenlayout geändert?)');

  const best = new Map<number, [number, number]>();
  for (const t of texts) {
    for (const [, a, b] of t.matchAll(/(?<![\d.])((?:20\d\d)|(?:[1-9]\d?))\.(\d{1,2})(?![\d.])/g)) {
      const major = Number(a), minor = Number(b);
      if (major < 7) continue; // ältere Creo-Versionen (und Wildfire) sind nicht relevant
      const prev = best.get(major);
      if (!prev || minor > prev[1]) best.set(major, [major, minor]);
    }
  }
  if (![...best.keys()].some((m) => m >= 10)) throw new Error("Keine plausible aktuelle Creo-Version gefunden");
  return [...best.values()].map(([major, minor]) => ({
    line: String(major),
    version: `Creo ${major}.${minor}`,
    type: minor === 0 ? "major" : "servicepack",
    notesUrl: SOURCE,
    sortKey: [major, minor],
  }));
}

export default defineTracker({
  id: "ptc-creo",
  vendor: "PTC",
  product: "Creo Parametric",
  sources: [SOURCE],
  fetchReleases: async (ctx) => parseCreoKb(await ctx.http.getText(SOURCE)),
});
