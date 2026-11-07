import { useState } from "react";
import type { Page, Product, Release } from "../../shared/api.ts";
import { api, fmtDate, fmtDay, TYPE_LABELS, useLoad } from "../api.ts";

const LIMIT = 50;

export function Releases() {
  const [q, setQ] = useState("");
  const [productId, setProductId] = useState("");
  const [offset, setOffset] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const products = useLoad(() => api<Product[]>("/products"));
  const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset), ...(q && { q }), ...(productId && { productId }) });
  const { data, error } = useLoad(() => api<Page<Release>>(`/releases?${params}`), [params.toString()]);
  const resend = (r: Release) =>
    api<{ queued: number; failed: number }>(`/releases/${r.id}/resend`, "POST").then(
      (x) => setMsg(x.failed ? `Senden fehlgeschlagen, wird beim nächsten Lauf wiederholt.` : `${r.product} ${r.version} an ${x.queued} Kanal/Kanäle gesendet.`),
      (e) => setMsg(e.message));

  return (
    <>
      <h1>Releases</h1>
      <div className="toolbar">
        <input type="search" placeholder="Suchen …" value={q} onChange={(e) => (setQ(e.target.value), setOffset(0))} aria-label="Suchen" />
        <select value={productId} onChange={(e) => (setProductId(e.target.value), setOffset(0))} aria-label="Produkt">
          <option value="">Alle Produkte</option>
          {products.data?.map((p) => <option key={p.id} value={p.id}>{p.vendor} {p.product}</option>)}
        </select>
      </div>
      {msg && <p className="note">{msg}</p>}
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <table>
            <thead><tr><th>Gefunden</th><th>Produkt</th><th>Linie</th><th>Version</th><th>Typ</th><th>Veröffentlicht</th><th>Links</th><th></th></tr></thead>
            <tbody>{data.items.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.firstSeenAt)}</td><td>{r.vendor} {r.product}</td><td>{r.lineKey}</td><td>{r.version}</td>
                <td>{TYPE_LABELS[r.type] ?? r.type}</td><td>{fmtDay(r.releaseDate)}</td>
                <td>{r.notesUrl && <a href={r.notesUrl} target="_blank" rel="noreferrer">Release Notes</a>} {r.downloadUrl && <a href={r.downloadUrl} target="_blank" rel="noreferrer">Download</a>}</td>
                <td><button onClick={() => resend(r)}>Post erneut senden</button></td>
              </tr>
            ))}</tbody>
          </table>
          <Pager offset={offset} total={data.total} limit={LIMIT} onChange={setOffset} />
        </>
      )}
    </>
  );
}

export function Pager({ offset, total, limit, onChange }: { offset: number; total: number; limit: number; onChange: (o: number) => void }) {
  if (total <= limit) return <p className="muted">{total} Einträge</p>;
  return (
    <div className="toolbar">
      <button disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>‹ Zurück</button>
      <span>{offset + 1}–{Math.min(offset + limit, total)} von {total}</span>
      <button disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Weiter ›</button>
    </div>
  );
}
