import { now, type DB } from "./db.ts";
import { writeLog } from "./log.ts";
import type { SecretBox } from "./crypto.ts";
import type { RunNotifier } from "./runner.ts";

export const TYPE_LABELS: Record<string, string> = {
  major: "Hauptversion",
  servicepack: "Service Pack / Maintenance Release",
  hotfix: "Hotfix",
  patch: "Patch",
};
const SUMMARY_THRESHOLD = 5; // mehr als 5 neue Releases je Kanal und Versand → Sammelkarte
const MAX_ATTEMPTS = 10;      // danach Status "failed" (Versand bei jedem Lauf, also ca. 10 Tage)

type ReleaseRow = { id: number; vendor: string; product: string; line_key: string; version: string; type: string; release_date: string | null; notes_url: string | null; download_url: string | null };
type Pending = { id: number; release_id: number | null; channel_id: number; payload: string | null; attempts: number };

// ---- Adaptive Cards (Teams-Workflow "Post to a channel when a webhook request is received") ----

const wrap = (body: unknown[], actions: unknown[] = []) => ({
  type: "message",
  attachments: [{
    contentType: "application/vnd.microsoft.card.adaptive",
    contentUrl: null,
    content: { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", msteams: { width: "Full" }, body, actions },
  }],
});
const title = (text: string) => ({ type: "TextBlock", size: "Medium", weight: "Bolder", text, wrap: true });

export function releaseCard(r: ReleaseRow) {
  const facts = [
    ["Hersteller", r.vendor],
    ["Produkt", r.product],
    ["Version", r.version],
    ["Typ", TYPE_LABELS[r.type] ?? r.type],
    ["Versionslinie", r.line_key],
    ["Veröffentlicht", r.release_date ?? "unbekannt"],
  ].map(([t, v]) => ({ title: t, value: v }));
  const actions = [
    r.notes_url && { type: "Action.OpenUrl", title: "Release Notes", url: r.notes_url },
    r.download_url && { type: "Action.OpenUrl", title: "Download", url: r.download_url },
  ].filter(Boolean);
  return wrap([title(`Neues Release: ${r.product} ${r.version}`), { type: "FactSet", facts }], actions);
}

export function summaryCard(rows: ReleaseRow[]) {
  const facts = rows.map((r) => ({ title: `${r.vendor} ${r.product}`, value: `${r.version} (${TYPE_LABELS[r.type] ?? r.type})${r.notes_url ? ` – [Release Notes](${r.notes_url})` : ""}` }));
  return wrap([title(`${rows.length} neue Releases`), { type: "FactSet", facts }]);
}

export const textCard = (heading: string, text: string) => wrap([title(heading), { type: "TextBlock", text, wrap: true }]);

/** Postet an einen Workflow-Webhook. Die URL ist ein Geheimnis und wird nie geloggt. */
export async function postWebhook(url: string, payload: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Teams antwortet mit HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

// ---- Ausgangskorb ----

export function createNotifier(db: DB, box: SecretBox): RunNotifier & {
  sendTest(channelId: number): Promise<void>;
  resend(releaseId: number): number;
} {
  /** Zielkanäle: ist das Produkt Kanälen zugeordnet, nur diese, sonst alle aktiven Kanäle. */
  function targetChannels(productId: number): number[] {
    const rows = db.prepare(`SELECT c.id FROM channels c WHERE c.enabled = 1 AND (
        NOT EXISTS (SELECT 1 FROM product_channels pc WHERE pc.product_id = ?)
        OR c.id IN (SELECT channel_id FROM product_channels WHERE product_id = ?))`).all(productId, productId) as { id: number }[];
    return rows.map((r) => r.id);
  }
  const insert = db.prepare("INSERT INTO notifications (release_id, channel_id, payload, created_at) VALUES (?, ?, ?, ?)");

  function enqueueRelease(releaseId: number, productId: number) {
    for (const ch of targetChannels(productId)) insert.run(releaseId, ch, null, now());
  }
  function enqueueAlert(productId: number, text: string) {
    for (const ch of targetChannels(productId)) insert.run(null, ch, text, now());
  }
  function releaseRows(ids: number[]): ReleaseRow[] {
    return db.prepare(`SELECT r.id, p.vendor, p.product, l.line_key, r.version, r.type, r.release_date, r.notes_url, r.download_url
      FROM releases r JOIN version_lines l ON l.id = r.line_id JOIN products p ON p.id = l.product_id
      WHERE r.id IN (SELECT value FROM json_each(?)) ORDER BY p.vendor, p.product, r.sort_key`).all(JSON.stringify(ids)) as ReleaseRow[];
  }

  /** Sendet alle offenen Einträge. Fehler bleiben "pending" und werden beim nächsten Lauf wiederholt. */
  async function flush() {
    const pending = db.prepare(`SELECT n.id, n.release_id, n.channel_id, n.payload, n.attempts FROM notifications n
      JOIN channels c ON c.id = n.channel_id WHERE n.status = 'pending' AND c.enabled = 1 ORDER BY n.id`).all() as Pending[];
    for (const [channelId, items] of Map.groupBy(pending, (n) => n.channel_id)) {
      const ch = db.prepare("SELECT webhook_url FROM channels WHERE id = ?").get(channelId) as { webhook_url: string };
      const url = box.decrypt(ch.webhook_url);
      const releases = items.filter((n) => n.release_id !== null);
      const batches: [Pending[], unknown][] = items.filter((n) => n.release_id === null).map((n) => [[n], textCard("Tracker-Ausfall", n.payload ?? "")]);
      if (releases.length > SUMMARY_THRESHOLD) batches.push([releases, summaryCard(releaseRows(releases.map((n) => n.release_id!)))]);
      else for (const n of releases) batches.push([[n], releaseCard(releaseRows([n.release_id!])[0])]);
      for (const [group, card] of batches) {
        try {
          await postWebhook(url, card);
          const ids = JSON.stringify(group.map((n) => n.id));
          db.prepare("UPDATE notifications SET status = 'sent', sent_at = ?, attempts = attempts + 1, last_error = NULL WHERE id IN (SELECT value FROM json_each(?))").run(now(), ids);
          db.prepare("UPDATE channels SET last_error = NULL WHERE id = ?").run(channelId);
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          for (const n of group) {
            db.prepare("UPDATE notifications SET attempts = attempts + 1, last_error = ?, status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE status END WHERE id = ?")
              .run(err, MAX_ATTEMPTS, n.id);
          }
          db.prepare("UPDATE channels SET last_error = ? WHERE id = ?").run(err, channelId);
          writeLog("warn", "Teams-Post fehlgeschlagen, wird beim nächsten Lauf wiederholt", { channelId, err });
          break; // Kanal vermutlich kaputt: Rest beim nächsten Lauf
        }
      }
    }
  }

  /** Testnachricht; erst danach ist ein Kanal aktiv. */
  async function sendTest(channelId: number) {
    const ch = db.prepare("SELECT name, webhook_url FROM channels WHERE id = ?").get(channelId) as { name: string; webhook_url: string } | undefined;
    if (!ch) throw new Error("Kanal nicht gefunden");
    try {
      await postWebhook(box.decrypt(ch.webhook_url), textCard("Testnachricht vom Software-Update-Tracker", `Kanal "${ch.name}" ist eingerichtet. Neue Releases erscheinen ab jetzt hier.`));
      db.prepare("UPDATE channels SET enabled = 1, last_error = NULL WHERE id = ?").run(channelId);
      writeLog("info", "Testnachricht gesendet, Kanal aktiv", { channelId });
    } catch (e) {
      db.prepare("UPDATE channels SET last_error = ? WHERE id = ?").run(e instanceof Error ? e.message : String(e), channelId);
      throw e;
    }
  }

  /** "Post erneut senden" aus der UI: neue Einträge im Ausgangskorb für alle Zielkanäle. */
  function resend(releaseId: number) {
    const row = db.prepare("SELECT l.product_id FROM releases r JOIN version_lines l ON l.id = r.line_id WHERE r.id = ?").get(releaseId) as { product_id: number } | undefined;
    if (!row) throw new Error("Release nicht gefunden");
    const channels = targetChannels(row.product_id);
    for (const ch of channels) insert.run(releaseId, ch, null, now());
    return channels.length;
  }

  return { enqueueRelease, enqueueAlert, flush, sendTest, resend };
}
export type Notifier = ReturnType<typeof createNotifier>;
