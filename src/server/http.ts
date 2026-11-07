import pkg from "../../package.json" with { type: "json" };
import type { Logger } from "./log.ts";

export class HttpStatusError extends Error {
  status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} bei ${url}`);
    this.status = status;
  }
}

export type HttpClient = {
  getText(url: string, init?: { headers?: Record<string, string> }): Promise<string>;
  getJson<T = unknown>(url: string, init?: { headers?: Record<string, string> }): Promise<T>;
};

const USER_AGENT = `Mozilla/5.0 (compatible; softversion/${pkg.version}; internal update tracker)`;
const nextSlot = new Map<string, number>(); // Rate-Limit: frühester nächster Abruf je Host
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

/**
 * HTTP-Abruf für Tracker: Timeout je Anfrage, 3 Versuche mit Backoff bei Netzfehlern/5xx/429,
 * mindestens `hostGapMs` Abstand zwischen Anfragen an denselben Host. Proxy kommt aus HTTP(S)_PROXY (NODE_USE_ENV_PROXY).
 */
export function createHttp(signal: AbortSignal, log: Logger, opts = { timeoutMs: 30_000, retries: 3, hostGapMs: 1000, backoffMs: 1000 }): HttpClient {
  async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
    const host = new URL(url).host;
    for (let attempt = 1; ; attempt++) {
      const wait = (nextSlot.get(host) ?? 0) - Date.now();
      nextSlot.set(host, Math.max(Date.now(), nextSlot.get(host) ?? 0) + opts.hostGapMs);
      if (wait > 0) await sleep(wait, signal);
      try {
        const res = await fetch(url, {
          headers: { "user-agent": USER_AGENT, "accept-language": "en-US,en;q=0.8", ...headers },
          signal: AbortSignal.any([signal, AbortSignal.timeout(opts.timeoutMs)]),
          redirect: "follow",
        });
        if (res.ok) return res;
        if (res.status !== 429 && res.status < 500) throw new HttpStatusError(res.status, url);
        await res.body?.cancel();
        throw Object.assign(new HttpStatusError(res.status, url), { retry: true });
      } catch (e) {
        const retryable = !(e instanceof HttpStatusError) || (e as { retry?: boolean }).retry;
        if (signal.aborted || !retryable || attempt >= opts.retries) throw e;
        log("warn", "Abruf fehlgeschlagen, neuer Versuch", { url, attempt, err: String(e) });
        await sleep(opts.backoffMs * 2 ** (attempt - 1), signal);
      }
    }
  }
  return {
    getText: async (url, init) => (await get(url, init?.headers)).text(),
    getJson: async (url, init) => (await get(url, { accept: "application/json", ...init?.headers })).json(),
  };
}
