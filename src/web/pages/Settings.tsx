import { useEffect, useState, type FormEvent } from "react";
import type { Channel, Product, Settings as S } from "../../shared/api.ts";
import { api, fmtDate, useLoad } from "../api.ts";

export function Settings() {
  return (
    <>
      <h1>Einstellungen</h1>
      <Channels />
      <Schedule />
      <Credentials />
      <section>
        <h2>Proxy</h2>
        <p className="muted">Wird über die Umgebungsvariablen <code>HTTP_PROXY</code>, <code>HTTPS_PROXY</code> und <code>NO_PROXY</code> des Containers gesetzt (siehe README).</p>
      </section>
    </>
  );
}

function Channels() {
  const { data, error, reload } = useLoad(() => api<Channel[]>("/channels"));
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const act = (p: Promise<unknown>, ok: string) => p.then(() => (setMsg({ text: ok }), reload()), (e) => (setMsg({ text: e.message, error: true }), reload()));
  const create = (e: FormEvent) => {
    e.preventDefault();
    act(api<Channel>("/channels", "POST", { name, webhookUrl: url }).then((c) => (setName(""), setUrl(""), api(`/channels/${c.id}/test`, "POST"))),
      "Kanal angelegt und Testnachricht gesendet – der Kanal ist aktiv.");
  };
  const changeUrl = (c: Channel) => {
    const webhookUrl = prompt(`Neue Webhook-URL für "${c.name}":`);
    if (webhookUrl) act(api(`/channels/${c.id}`, "PATCH", { webhookUrl }), "URL geändert. Bitte Testnachricht senden, um den Kanal wieder zu aktivieren.");
  };

  return (
    <section>
      <h2>Teams-Kanäle</h2>
      <details>
        <summary>Anleitung: Teams-Kanal einrichten</summary>
        <ol>
          <li>In Teams am Ziel-Kanal „…“ → <b>Workflows</b> → Vorlage <b>„Post to a channel when a webhook request is received“</b> wählen.</li>
          <li>Team und Kanal bestätigen, Workflow anlegen und die erzeugte URL kopieren.</li>
          <li>Hier Namen und URL eintragen und „Anlegen und testen“ klicken. Der Kanal ist erst nach erfolgreicher Testnachricht aktiv.</li>
        </ol>
        <p className="muted">Hinweise: Posts erscheinen im Namen des Workflow-Erstellers – am besten mit einem Funktionskonto anlegen.
          Der Ersteller braucht eine Lizenz mit Cloud-Workflows (z. B. Office 365 E1/E3/E5/F3). Die URL ist ein Geheimnis; sie wird verschlüsselt gespeichert und nur gekürzt angezeigt.</p>
      </details>
      {msg && <p className={msg.error ? "error" : "note"}>{msg.text}</p>}
      {error && <p className="error">{error}</p>}
      {data && data.length > 0 && (
        <table>
          <thead><tr><th>Name</th><th>Webhook</th><th>Status</th><th>Angelegt</th><th></th></tr></thead>
          <tbody>{data.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td><td><code>{c.webhookUrl}</code></td>
              <td><span className={`badge ${c.enabled ? "ok" : "new"}`}>{c.enabled ? "aktiv" : "inaktiv"}</span>
                {c.lastError && <div className="error">{c.lastError}</div>}</td>
              <td>{fmtDate(c.createdAt)}</td>
              <td className="actions">
                <button onClick={() => act(api(`/channels/${c.id}/test`, "POST"), "Testnachricht gesendet – Kanal aktiv.")}>Testnachricht senden</button>
                {c.enabled && <button onClick={() => act(api(`/channels/${c.id}`, "PATCH", { enabled: false }), "Kanal deaktiviert.")}>Deaktivieren</button>}
                <button onClick={() => changeUrl(c)}>URL ändern</button>
                <button onClick={() => confirm(`Kanal "${c.name}" löschen?`) && act(api(`/channels/${c.id}`, "DELETE"), "Kanal gelöscht.")}>Löschen</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <form onSubmit={create} className="toolbar">
        <input required placeholder="Name, z. B. CAD-Team" value={name} onChange={(e) => setName(e.target.value)} aria-label="Kanalname" />
        <input required type="url" placeholder="https://… (Workflow-URL)" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Webhook-URL" className="grow" />
        <button type="submit">Anlegen und testen</button>
      </form>
    </section>
  );
}

function Schedule() {
  const { data, reload } = useLoad(() => api<S>("/settings"));
  const [form, setForm] = useState<S | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => setForm(data), [data]);
  if (!form) return null;
  const zones = Intl.supportedValuesOf("timeZone");
  const save = (e: FormEvent) => {
    e.preventDefault();
    api<S>("/settings", "PUT", form).then(() => (setMsg({ text: "Gespeichert." }), reload()), (e) => setMsg({ text: e.message, error: true }));
  };
  return (
    <section>
      <h2>Zeitplan und Warnungen</h2>
      <form onSubmit={save} className="toolbar">
        <label>Tägliche Prüfung um <input type="time" required value={form.scheduleTime} onChange={(e) => setForm({ ...form, scheduleTime: e.target.value })} /></label>
        <label>Zeitzone <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
          {zones.map((z) => <option key={z}>{z}</option>)}
        </select></label>
        <label>Ausfall-Warnung nach <input type="number" min={1} max={30} value={form.failureAlertThreshold}
          onChange={(e) => setForm({ ...form, failureAlertThreshold: Number(e.target.value) })} /> Fehlläufen in Folge</label>
        <button type="submit">Speichern</button>
      </form>
      {msg && <p className={msg.error ? "error" : "note"}>{msg.text}</p>}
    </section>
  );
}

function Credentials() {
  const { data, reload } = useLoad(() => api<Product[]>("/products"));
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const list = (data ?? []).filter((p) => p.requiresCredentials);
  const save = (e: FormEvent<HTMLFormElement>, p: Product) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    api(`/credentials/${p.trackerId}`, "PUT", { username: f.get("username"), secret: f.get("secret") })
      .then(() => (setMsg({ text: `Zugangsdaten für ${p.product} gespeichert.` }), reload()), (e) => setMsg({ text: e.message, error: true }));
  };
  return (
    <section>
      <h2>Zugangsdaten für Hersteller-Portale</h2>
      {!list.length && <p className="muted">Kein Tracker benötigt derzeit Zugangsdaten.</p>}
      {msg && <p className={msg.error ? "error" : "note"}>{msg.text}</p>}
      {list.map((p) => (
        <form key={p.id} onSubmit={(e) => save(e, p)} className="toolbar">
          <b>{p.vendor} {p.product}</b> {p.hasCredentials ? <span className="badge ok">hinterlegt</span> : <span className="badge error">fehlt</span>}
          <input name="username" required placeholder="Benutzer" autoComplete="off" aria-label="Benutzer" />
          <input name="secret" required type="password" placeholder="Passwort" autoComplete="new-password" aria-label="Passwort" />
          <button type="submit">Speichern</button>
          {p.hasCredentials && <button type="button" onClick={() => api(`/credentials/${p.trackerId}`, "DELETE").then(reload)}>Entfernen</button>}
        </form>
      ))}
    </section>
  );
}
