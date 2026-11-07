import { Fragment, useState } from "react";
import type { Page, Run, RunResult } from "../../shared/api.ts";
import { api, fmtDate, STATUS_LABELS, useLoad } from "../api.ts";
import { Pager } from "./Releases.tsx";

const LIMIT = 30;

export function Runs() {
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const { data, error, reload } = useLoad(() => api<Page<Run>>(`/runs?limit=${LIMIT}&offset=${offset}`), [offset]);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Lädt …</p>;
  return (
    <>
      <div className="toolbar"><h1>Läufe</h1><button onClick={reload}>Aktualisieren</button></div>
      <table>
        <thead><tr><th>Start</th><th>Ende</th><th>Auslöser</th><th>Status</th><th>Geprüft</th><th>Fehler</th><th>Neu</th><th></th></tr></thead>
        <tbody>{data.items.map((r) => (
          <Fragment key={r.id}>
            <tr>
              <td>{fmtDate(r.startedAt)}</td><td>{fmtDate(r.finishedAt)}</td><td>{STATUS_LABELS[r.trigger] ?? r.trigger}</td>
              <td><span className={`badge ${r.status}`}>{STATUS_LABELS[r.status] ?? r.status}</span></td>
              <td>{r.checked}</td><td>{r.failed}</td><td>{r.newCount}</td>
              <td><button onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>{open === r.id ? "Schließen" : "Details"}</button></td>
            </tr>
            {open === r.id && <tr className="details"><td colSpan={8}><RunDetails id={r.id} /></td></tr>}
          </Fragment>
        ))}</tbody>
      </table>
      {!data.items.length && <p>Noch keine Läufe.</p>}
      <Pager offset={offset} total={data.total} limit={LIMIT} onChange={setOffset} />
    </>
  );
}

function RunDetails({ id }: { id: number }) {
  const { data, error } = useLoad(() => api<{ run: Run; results: RunResult[] }>(`/runs/${id}`), [id]);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Lädt …</p>;
  return (
    <table>
      <thead><tr><th>Produkt</th><th>Status</th><th>Dauer</th><th>Gefunden</th><th>Neu gemeldet</th><th>Fehler</th></tr></thead>
      <tbody>{data.results.map((x) => (
        <tr key={x.productId}>
          <td>{x.vendor} {x.product}</td><td><span className={`badge ${x.status}`}>{STATUS_LABELS[x.status] ?? x.status}</span></td>
          <td>{(x.durationMs / 1000).toFixed(1)} s</td><td>{x.foundCount}</td><td>{x.newCount}</td><td className="error">{x.error}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}
