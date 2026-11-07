import { z } from "zod";
import type { TrackerContext } from "../../tracker.ts";

/** JSON-API abrufen und gegen ein zod-Schema prüfen; bei Abweichung Fehler mit lesbarer Meldung. */
export async function fetchJson<T extends z.ZodType>(ctx: TrackerContext, url: string, schema: T): Promise<z.infer<T>> {
  const result = schema.safeParse(await ctx.http.getJson(url));
  if (!result.success) throw new Error(`Antwort von ${url} hat unerwartetes Format: ${z.prettifyError(result.error)}`);
  return result.data;
}
