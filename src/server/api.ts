import { now } from "./db.ts";
import { maskUrl } from "./crypto.ts";
import { HttpError, Router } from "./server.ts";
import type { App } from "./app.ts";
import * as S from "../shared/api.ts";
import pkg from "../../package.json" with { type: "json" };

type ChannelRow = { id: number; name: string; type: string; webhook_url: string; enabled: number; last_error: string | null; created_at: string };

/** REST-API unter /api. Eingaben werden mit den zod-Schemas aus src/shared/api.ts geprüft. */
export function createApi(app: App) {
  const { db, box, notifier } = app;
  const r = new Router();

  r.add("GET", "/api/health", (): S.Health => {
    db.prepare("SELECT 1").get();
    return { ok: true, version: pkg.version, scheduler: false, nextRun: null };
  });

  // ---- Teams-Kanäle ----
  const toChannel = (c: ChannelRow): S.Channel => ({
    id: c.id, name: c.name, type: c.type, webhookUrl: maskUrl(box.decrypt(c.webhook_url)),
    enabled: !!c.enabled, lastError: c.last_error, createdAt: c.created_at,
  });
  const getChannel = (id: number) => {
    const c = db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as ChannelRow | undefined;
    if (!c) throw new HttpError(404, "Kanal nicht gefunden");
    return c;
  };
  r.add("GET", "/api/channels", () => (db.prepare("SELECT * FROM channels ORDER BY name").all() as ChannelRow[]).map(toChannel));
  r.add("POST", "/api/channels", ({ body }) => {
    const b = S.channelCreate.parse(body);
    const id = db.prepare("INSERT INTO channels (name, webhook_url, created_at) VALUES (?, ?, ?)").run(b.name, box.encrypt(b.webhookUrl), now()).lastInsertRowid;
    return toChannel(getChannel(Number(id)));
  });
  r.add("PATCH", "/api/channels/:id", ({ params, body }) => {
    const { id } = S.idParam.parse(params);
    const b = S.channelUpdate.parse(body);
    getChannel(id);
    if (b.name) db.prepare("UPDATE channels SET name = ? WHERE id = ?").run(b.name, id);
    // Neue URL muss erst wieder per Testnachricht bestätigt werden.
    if (b.webhookUrl) db.prepare("UPDATE channels SET webhook_url = ?, enabled = 0 WHERE id = ?").run(box.encrypt(b.webhookUrl), id);
    if (b.enabled === false) db.prepare("UPDATE channels SET enabled = 0 WHERE id = ?").run(id);
    return toChannel(getChannel(id));
  });
  r.add("DELETE", "/api/channels/:id", ({ params }) => {
    const { id } = S.idParam.parse(params);
    getChannel(id);
    db.prepare("DELETE FROM channels WHERE id = ?").run(id);
    return { ok: true };
  });
  r.add("POST", "/api/channels/:id/test", async ({ params }) => {
    const { id } = S.idParam.parse(params);
    getChannel(id);
    try {
      await notifier.sendTest(id);
    } catch (e) {
      throw new HttpError(502, `Testnachricht fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    }
    return toChannel(getChannel(id));
  });

  return r;
}
