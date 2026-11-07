import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { z } from "zod";
import { writeLog } from "./log.ts";

/** Minimaler Router auf node:http: JSON-API unter /api, sonst statische UI aus dist/web. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Req = { params: Record<string, string>; query: URLSearchParams; body: unknown };
export type Handler = (req: Req) => unknown;
type Route = { method: string; re: RegExp; keys: string[]; handler: Handler };

export class Router {
  routes: Route[] = [];
  add(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
    this.routes.push({ method, re, keys, handler });
    return this;
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body ?? null));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new HttpError(413, "Anfrage zu groß");
    chunks.push(c);
  }
  if (!size) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Ungültiges JSON");
  }
}

export function startHttp(router: Router, webDir: string, port: number) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    try {
      if (url.pathname.startsWith("/api/")) {
        for (const r of router.routes) {
          const m = r.method === req.method && url.pathname.match(r.re);
          if (!m) continue;
          const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
          const body = req.method === "GET" ? undefined : await readBody(req);
          return send(res, 200, await r.handler({ params, query: url.searchParams, body }));
        }
        throw new HttpError(404, "Nicht gefunden");
      }
      // Statische Dateien; unbekannte Pfade bekommen index.html (Single-Page-App).
      const file = normalize(join(webDir, url.pathname === "/" ? "index.html" : url.pathname));
      const target = file.startsWith(webDir) && extname(file) ? file : join(webDir, "index.html");
      const data = await readFile(target).catch(() => null);
      if (!data) return send(res, 404, { error: "Nicht gefunden" });
      res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
      res.end(data);
    } catch (e) {
      if (e instanceof z.ZodError) return send(res, 400, { error: "Ungültige Eingabe", issues: e.issues });
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      writeLog("error", "API-Fehler", { path: url.pathname, err: String(e) });
      send(res, 500, { error: "Interner Fehler" });
    }
  });
  server.listen(port, () => writeLog("info", "HTTP-Server gestartet", { port }));
  return server;
}
