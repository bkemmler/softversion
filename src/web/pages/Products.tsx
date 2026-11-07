import { Fragment, useMemo, useState } from "react";
import type { Channel, Product } from "../../shared/api.ts";
import { api, fmtDate, STATUS_LABELS, useLoad } from "../api.ts";

export function Products() {
  const { data, error, reload } = useLoad(() => api<Product[]>("/products"));
  const channels = useLoad(() => api<Channel[]>("/channels"));
  const [q, setQ] = useState("");
  const [vendor, setVendor] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const act = (p: Promise<unknown>, ok?: string) => p.then(() => (ok && setMsg(ok), reload()), (e) => setMsg(e.message));
  const vendors = useMemo(() => [...new Set((data ?? []).map((p) => p.vendor))].sort(), [data]);
  const list = (data ?? []).filter((p) =>
    (!q || `${p.vendor} ${p.product} ${p.trackerId}`.toLowerCase().includes(q.toLowerCase())) &&
    (!vendor || p.vendor === vendor) &&
    (!status || (status === "disabled" ? !p.enabled : p.status === status)));
  const bulk = (enabled: boolean) => act(api("/products/bulk", "POST", { ids: list.map((p) => p.id), enabled }), `${list.length} Produkte ${enabled ? "aktiviert" : "deaktiviert"}.`);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Lädt …</p>;
  return (
    <>
      <h1>Produkte</h1>
      <div className="toolbar">
        <input type="search" placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Suchen" />
        <select value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Hersteller">
          <option value="">Alle Hersteller</option>
          {vendors.map((v) => <option key={v}>{v}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Alle Status</option>
          <option value="ok">ok</option><option value="error">Fehler</option><option value="new">neu</option>
          <option value="missing">Modul fehlt</option><option value="disabled">deaktiviert</option>
        </select>
        <span className="spacer" />
        <button disabled={!list.length} onClick={() => bulk(true)}>Alle {list.length} aktivieren</button>
        <button disabled={!list.length} onClick={() => bulk(false)}>Alle {list.length} deaktivieren</button>
      </div>
      {msg && <p className="note">{msg}</p>}
      <table>
        <thead><tr><th>Tracking</th><th>Hersteller</th><th>Produkt</th><th>Status</th><th>Letzte Prüfung</th><th>Neueste Version</th><th></th></tr></thead>
        <tbody>
          {list.map((p) => (
            <Fragment key={p.id}>
              <tr>
                <td><input type="checkbox" checked={p.enabled} aria-label={`${p.product} tracken`}
                  onChange={(e) => act(api(`/products/${p.id}`, "PATCH", { enabled: e.target.checked }))} /></td>
                <td>{p.vendor}</td>
                <td><button className="link" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
                  {open === p.id ? "▾" : "▸"} {p.product}</button></td>
                <td><span className={`badge ${p.status}`} title={p.lastError ?? ""}>{STATUS_LABELS[p.status]}</span>
                  {p.requiresCredentials && !p.hasCredentials && <span className="badge error">Zugangsdaten fehlen</span>}</td>
                <td>{fmtDate(p.lastCheckAt)}</td>
                <td>{p.latestVersion ?? "–"}</td>
                <td><button disabled={p.status === "missing"} onClick={() => act(api("/check", "POST", { trackerId: p.trackerId }), `Prüfung von ${p.product} gestartet.`).then(() => setTimeout(reload, 3000))}>Jetzt prüfen</button></td>
              </tr>
              {open === p.id && <tr className="details"><td colSpan={7}><ProductDetails p={p} act={act} channels={channels.data ?? []} /></td></tr>}
            </Fragment>
          ))}
        </tbody>
      </table>
      {!list.length && <p>Keine Produkte für diesen Filter.</p>}
    </>
  );
}

function ProductDetails({ p, act, channels }: { p: Product; act: (x: Promise<unknown>, ok?: string) => void; channels: Channel[] }) {
  const toggleChannel = (id: number, on: boolean) =>
    act(api(`/products/${p.id}/channels`, "PUT", { channelIds: on ? [...p.channelIds, id] : p.channelIds.filter((c) => c !== id) }));
  return (
    <div>
      {p.lastError && <p className="error">Letzter Fehler ({p.consecutiveFailures}× in Folge): {p.lastError}</p>}
      <label><input type="checkbox" checked={p.autoEnableNewLines}
        onChange={(e) => act(api(`/products/${p.id}`, "PATCH", { autoEnableNewLines: e.target.checked }))} /> Neue Versionslinien automatisch tracken</label>
      <h3>Versionslinien</h3>
      {p.lines.length ? (
        <table><thead><tr><th>Tracking</th><th>Linie</th><th>Neueste Version</th><th>Erstmals gesehen</th></tr></thead>
          <tbody>{p.lines.map((l) => (
            <tr key={l.id}>
              <td><input type="checkbox" checked={l.enabled} aria-label={`Linie ${l.lineKey} tracken`}
                onChange={(e) => act(api(`/lines/${l.id}`, "PATCH", { enabled: e.target.checked }))} /></td>
              <td>{l.lineKey}</td><td>{l.latestVersion ?? "–"}</td><td>{fmtDate(l.firstSeenAt)}</td>
            </tr>
          ))}</tbody></table>
      ) : <p>Noch keine Linien – erscheinen nach der ersten Prüfung.</p>}
      {channels.length > 1 && (
        <>
          <h3>Teams-Kanäle</h3>
          <p className="muted">Ohne Auswahl gehen Meldungen an alle aktiven Kanäle.</p>
          <div className="toolbar">{channels.map((c) => (
            <label key={c.id}><input type="checkbox" checked={p.channelIds.includes(c.id)} onChange={(e) => toggleChannel(c.id, e.target.checked)} /> {c.name}{!c.enabled && " (inaktiv)"}</label>
          ))}</div>
        </>
      )}
      <p className="muted">Tracker-ID: <code>{p.trackerId}</code> · Quellen: {p.sources.map((s) => <a key={s} href={s} target="_blank" rel="noreferrer">{s}</a>)}</p>
    </div>
  );
}
