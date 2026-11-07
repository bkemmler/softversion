import { z } from "zod";
import type { Logger } from "./log.ts";
import type { HttpClient } from "./http.ts";

export const RELEASE_TYPES = ["major", "servicepack", "hotfix", "patch"] as const;

/** Was ein Tracker je gefundener Version liefert. */
export const releaseInfoSchema = z.object({
  line: z.string().min(1),                       // Versionslinie, z. B. "2026"
  version: z.string().min(1),                    // z. B. "2026 SP2.0"
  type: z.enum(RELEASE_TYPES),
  releaseDate: z.string().optional(),            // ISO-Datum, falls bekannt
  notesUrl: z.string().url().optional(),
  downloadUrl: z.string().url().optional(),
  sortKey: z.array(z.number().int().nonnegative()).min(1), // Vergleich innerhalb der Linie, z. B. [2026, 2, 0]
});
export type ReleaseInfo = z.infer<typeof releaseInfoSchema>;

export type TrackerContext = {
  http: HttpClient;
  credentials: { username: string; secret: string } | null;
  log: Logger;
  signal: AbortSignal;
};

export type Tracker = {
  id: string;                 // stabil, nie ändern
  vendor: string;
  product: string;
  sources: string[];
  requiresCredentials?: boolean;
  fetchReleases(ctx: TrackerContext): Promise<ReleaseInfo[]>;
};

export const defineTracker = (t: Tracker) => t;

/** sortKey als String, der sich lexikographisch wie numerisch vergleichen lässt (auch in SQL). */
export const encodeSortKey = (key: number[]) => key.map((n) => String(n).padStart(10, "0")).join(".");

/** Ergebnis eines Trackers prüfen: leer oder ungültig ist ein Fehler, nie "nichts Neues". */
export function validateReleases(list: unknown): ReleaseInfo[] {
  const result = z.array(releaseInfoSchema).safeParse(list);
  if (!result.success) throw new Error(`Ungültige Tracker-Daten: ${z.prettifyError(result.error)}`);
  const parsed = result.data;
  if (!parsed.length) throw new Error("Tracker hat keine Versionen gefunden (Seitenlayout geändert?)");
  return parsed;
}
