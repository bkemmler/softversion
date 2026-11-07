/** Hilfen für Versionsnummern, gemeinsam für alle Tracker. */

/** "11.0.3.0" → [11, 0, 3, 0]; "v2.4.1-beta" → [2, 4, 1]. Wirft, wenn keine Zahl gefunden wird. */
export function numericKey(version: string): number[] {
  const m = version.match(/\d+(?:\.\d+)*/);
  if (!m) throw new Error(`Keine Versionsnummer in "${version}"`);
  return m[0].split(".").map(Number);
}

/** Linie = die ersten `parts` Stellen, z. B. lineOf("11.0.3.0", 1) = "11", lineOf("2.4.1", 2) = "2.4". */
export const lineOf = (version: string, parts = 1) => numericKey(version).slice(0, parts).join(".");

/** Typ aus der Position der ersten Stelle ≠ 0 nach der Linie: x.0.0 major, x.y.0 servicepack, x.y.z hotfix/patch. */
export function typeOf(key: number[], lineParts = 1): "major" | "servicepack" | "hotfix" {
  const rest = key.slice(lineParts);
  if (rest.every((n) => n === 0)) return "major";
  return rest.slice(1).some((n) => n !== 0) ? "hotfix" : "servicepack";
}

/** Datum in ISO-Form (YYYY-MM-DD) oder undefined, wenn nicht lesbar. */
export function isoDate(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}
