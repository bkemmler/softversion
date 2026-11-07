import { useCallback, useEffect, useState } from "react";

/** Aufruf der REST-API; wirft bei Fehlern die Meldung des Servers. */
export async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const issues = data?.issues?.map((i: { message: string }) => i.message).join(", ");
    throw new Error([data?.error ?? `HTTP ${res.status}`, issues].filter(Boolean).join(": "));
  }
  return data as T;
}

/** Lädt Daten beim Anzeigen und bei Änderung von `deps`; `reload()` lädt neu. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => fn().then((d) => (setData(d), setError(null)), (e) => setError(String(e.message ?? e))), deps);
  useEffect(() => void reload(), [reload]);
  return { data, error, reload };
}

export const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "–");
export const fmtDay = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("de-DE") : "–");

export const TYPE_LABELS: Record<string, string> = { major: "Hauptversion", servicepack: "Service Pack / MR", hotfix: "Hotfix", patch: "Patch" };
export const STATUS_LABELS: Record<string, string> = {
  new: "neu", ok: "ok", error: "Fehler", missing: "Modul fehlt", partial: "teilweise", running: "läuft", aborted: "abgebrochen",
  schedule: "geplant", manual: "manuell", cli: "CLI",
};
