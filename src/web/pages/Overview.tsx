import { useState } from "react";
import type { Overview as O } from "../../shared/api.ts";
import { api, fmtDate, fmtDay, STATUS_LABELS, TYPE_LABELS, useLoad } from "../api.ts";

export function Overview() {
  const { data, error, reload } = useLoad(() => api<O>("/overview"));
  const [msg, setMsg] = useState<string | null>(null);
  const checkAll = () => api("/check", "POST", {}).then(() => (setMsg("Prüfung gestartet – Ergebnis unter Läufe."), setTimeout(reload, 1500)), (e) => setMsg(e.message));
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Lädt …</p>;
  return (
    <>
      <div className="toolbar">
        <h1>Übersicht</h1>
        <button onClick={checkAll} disabled={data.running}>{data.running ? "Prüfung läuft …" : "Alle jetzt prüfen"}</button>
      </div>
      {msg && <p className="note">{msg}</p>}
      <div className="cards">
        <div className="card"><span>Letzter Lauf</span><b>{data.lastRun ? fmtDate(data.lastRun.startedAt) : "noch keiner"}</b>
          {data.lastRun && <small>{STATUS_LABELS[data.lastRun.status] ?? data.lastRun.status} · {data.lastRun.checked} geprüft · {data.lastRun.failed} Fehler · {data.lastRun.newCount} neu</small>}</div>
        <div className="card"><span>Nächster Lauf</span><b>{fmtDate(data.nextRun)}</b></div>
        <div className="card"><span>Produkte aktiv</span><b>{data.counts.enabled} / {data.counts.products}</b></div>
        <div className="card"><span>Teams-Kanäle aktiv</span><b>{data.counts.channels}</b>
          {data.counts.pendingNotifications > 0 && <small className="error">{data.counts.pendingNotifications} Posts ausstehend</small>}</div>
      </div>
      {data.counts.channels === 0 && <p className="note">Noch kein aktiver Teams-Kanal. Unter <a href="#/settings">Einstellungen</a> einrichten.</p>}

      <h2>Tracker mit Fehlern</h2>
      {data.failingProducts.length ? (
        <table><thead><tr><th>Produkt</th><th>Fehler in Folge</th><th>Letzter Fehler</th></tr></thead>
          <tbody>{data.failingProducts.map((p) => (
            <tr key={p.id}><td>{p.vendor} {p.product}</td><td>{p.consecutiveFailures}</td><td className="error">{p.lastError}</td></tr>
          ))}</tbody></table>
      ) : <p>Keine.</p>}

      <h2>Neue Releases (7 Tage)</h2>
      {data.recentReleases.length ? (
        <table><thead><tr><th>Gefunden</th><th>Produkt</th><th>Version</th><th>Typ</th><th>Release Notes</th></tr></thead>
          <tbody>{data.recentReleases.map((r) => (
            <tr key={r.id}><td>{fmtDay(r.firstSeenAt)}</td><td>{r.vendor} {r.product}</td><td>{r.version}</td><td>{TYPE_LABELS[r.type] ?? r.type}</td>
              <td>{r.notesUrl ? <a href={r.notesUrl} target="_blank" rel="noreferrer">öffnen</a> : "–"}</td></tr>
          ))}</tbody></table>
      ) : <p>Keine.</p>}
      <footer>Version {data.version}</footer>
    </>
  );
}
