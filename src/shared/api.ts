/** Gemeinsame API-Verträge für Backend und UI: zod-Schemas für Eingaben, Typen für Antworten. */
import { z } from "zod";

const id = z.coerce.number().int().positive();
export const idParam = z.object({ id });

// ---- Eingaben ----

export const channelCreate = z.object({
  name: z.string().trim().min(1).max(100),
  webhookUrl: z.string().trim().url().refine((u) => u.startsWith("https://"), "Webhook-URL muss mit https:// beginnen"),
});
export const channelUpdate = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  webhookUrl: channelCreate.shape.webhookUrl.optional(),
  enabled: z.literal(false).optional(), // aktivieren nur über "Testnachricht senden"
});
export const productUpdate = z.object({
  enabled: z.boolean().optional(),
  autoEnableNewLines: z.boolean().optional(),
});
export const productBulkUpdate = z.object({ ids: z.array(id).min(1), enabled: z.boolean() });
export const productChannels = z.object({ channelIds: z.array(id) });
export const lineUpdate = z.object({ enabled: z.boolean() });
export const checkRequest = z.object({ trackerId: z.string().optional() });
export const settingsUpdate = z.object({
  scheduleTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format HH:MM").optional(),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Unbekannte Zeitzone").optional(),
  failureAlertThreshold: z.number().int().min(1).max(30).optional(),
});
export const credentialsUpdate = z.object({ username: z.string().trim().min(1).max(200), secret: z.string().min(1).max(500) });
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const releasesQuery = pageQuery.extend({ productId: id.optional(), q: z.string().optional() });

// ---- Antworten ----

export type Page<T> = { items: T[]; total: number };
export type Health = { ok: boolean; version: string; scheduler: boolean; nextRun: string | null };
export type Channel = { id: number; name: string; type: string; webhookUrl: string; enabled: boolean; lastError: string | null; createdAt: string };
export type Line = { id: number; lineKey: string; enabled: boolean; latestVersion: string | null; firstSeenAt: string };
export type Product = {
  id: number; trackerId: string; vendor: string; product: string; enabled: boolean; autoEnableNewLines: boolean;
  status: "new" | "ok" | "error" | "missing"; lastCheckAt: string | null; lastError: string | null; consecutiveFailures: number;
  latestVersion: string | null; requiresCredentials: boolean; hasCredentials: boolean; sources: string[]; channelIds: number[]; lines: Line[];
};
export type Release = {
  id: number; productId: number; vendor: string; product: string; lineKey: string; version: string; type: string;
  releaseDate: string | null; notesUrl: string | null; downloadUrl: string | null; firstSeenAt: string;
};
export type Run = { id: number; startedAt: string; finishedAt: string | null; trigger: string; status: string; checked: number; failed: number; newCount: number };
export type RunResult = { productId: number; vendor: string; product: string; status: string; error: string | null; durationMs: number; foundCount: number; newCount: number };
export type Settings = { scheduleTime: string; timezone: string; failureAlertThreshold: number };
export type Overview = {
  version: string; lastRun: Run | null; nextRun: string | null; running: boolean;
  recentReleases: Release[]; failingProducts: Pick<Product, "id" | "vendor" | "product" | "lastError" | "consecutiveFailures">[];
  counts: { products: number; enabled: number; channels: number; pendingNotifications: number };
};
