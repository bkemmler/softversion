# Konzept: Software-Update-Tracker

Nov 7, 2026 · @Bernd

## Ziel und Entscheidungen

Ein Docker-Container prüft einmal täglich für 20 bis 100 Softwareprodukte (z. B. SOLIDWORKS, PTC Creo), ob es für eine getrackte Versionslinie ein neues Release, Service Pack oder einen Hotfix gibt. Neue Versionen werden gespeichert und in einen Teams-Kanal gepostet.

Die Erkennungslogik pro Produkt ist Code (ein Tracker-Modul je Produkt). Alles, was ein Anwender ändert, läuft über die Web-UI: Tracking an/aus, Versionslinien an/aus, Teams-Kanal, Zeitplan.

| Thema | Entscheidung |
| --- | --- |
| Versionen | Pro Produkt mehrere Versionslinien parallel (z. B. SOLIDWORKS 2025 und 2026, jeweils mit eigenen SPs), einzeln schaltbar |
| Teams | Workflows-Webhook ("Post to a channel when a webhook request is received"), URL wird in der UI hinterlegt |
| Stack | TypeScript auf Node.js (LTS), Backend und UI in einem Container |
| Erste Tracker | SOLIDWORKS und PTC Creo (Siemens vorerst nicht) |
| Intervall | 1x täglich, Uhrzeit in der UI einstellbar, zusätzlich "Jetzt prüfen" |
| Anmeldung | Keine. Betrieb nur im internen Netz; Internetzugang direkt, ohne Proxy |
| Erweiterung | Neue Produkte nur per Code (neues Tracker-Modul), Aktivierung per UI |

## Architektur

&#91;embedded content: Architektur · ein Container, sechs Bausteine\]

Scheduler und "Jetzt prüfen" starten denselben Runner. Er ruft die Tracker-Module auf, speichert alles in SQLite und gibt neue Releases an den Notifier, der sie in Teams postet. Die UI liest und schreibt Einstellungen ebenfalls in SQLite.

**Stack:** Node.js LTS, TypeScript, pnpm-Monorepo; Fastify (API), React + Vite (UI), Drizzle + SQLite (Daten), croner (Scheduler), cheerio und optional Playwright (Abruf), pino (Logs), Vitest (Tests).

## Tracker-Plugin-Konzept

Jedes Produkt ist eine Datei unter `src/trackers/`, die eine feste Schnittstelle erfüllt. Der Kern kennt keine Herstellerdetails; ein neues Produkt hinzufügen heißt: eine Datei plus Test-Fixture anlegen, die Registry findet sie automatisch.

```ts
export default defineTracker({
  id: "dassault-solidworks",          // stabil, nie ändern
  vendor: "Dassault Systèmes",
  product: "SOLIDWORKS",
  sources: ["https://files.solidworks.com/Supportfiles/Release_Notes/"],
  requiresCredentials: false,          // true → Zugangsdaten in der UI
  async fetchReleases(ctx): Promise<ReleaseInfo[]> {
    const html = await ctx.http.getText(...);
    return parse(html);               // reine Funktion, testbar mit Fixture
  },
});
```

Ein `ReleaseInfo` liefert: `line` (Versionslinie, z. B. "2026"), `version` (z. B. "2026 SP2.0"), `type` (major, servicepack, hotfix, patch), `releaseDate` (optional), `notesUrl`, `downloadUrl` (optional) und einen `sortKey` für den Vergleich.

Der Kontext `ctx` stellt zentral bereit:

- `http`: Proxy, Timeout, Retries mit Backoff, Rate-Limit pro Host, einheitlicher User-Agent
- `html` und `json`: Parser-Helfer (cheerio, zod-Validierung)
- `browser`: optionales Playwright für JavaScript-Seiten, nur bei Bedarf geladen
- `credentials`: Zugangsdaten für Hersteller-Portale, aus der UI, verschlüsselt gespeichert
- `log`: strukturiertes Logging pro Tracker

Regeln für jeden Tracker:

1. Abrufen und Parsen trennen. Die Parse-Funktion ist pur und wird gegen gespeicherte HTML-/JSON-Fixtures getestet, nie gegen das Live-Netz.
2. Lieber zu wenig als falsch melden: Wenn das Parsing nichts Plausibles findet, wirft der Tracker einen Fehler statt eine leere Liste zu liefern.
3. Wiederverwendbare Quelltypen kommen als Basis-Helfer in `src/trackers/_sources/` (RSS/Atom, GitHub Releases, JSON-API, HTML-Tabelle, Knowledge-Base-Artikel). Bei 100 Produkten ist der Großteil damit eine Konfiguration von wenigen Zeilen.

## Datenmodell

SQLite in einem Docker-Volume reicht für 100 Produkte und tägliche Läufe locker aus; Zugriff über Drizzle ORM mit versionierten Migrationen.

| Tabelle | Inhalt | Wichtige Felder |
| --- | --- | --- |
| products | Ein Eintrag je Tracker-Modul, beim Start mit der Registry abgeglichen | tracker\_id, enabled, auto\_enable\_new\_lines, status, last\_check\_at |
| version\_lines | Erkannte Versionslinien je Produkt | product\_id, line\_key, enabled, first\_seen\_at |
| releases | Jede je gesehene Version | line\_id, version, type, release\_date, notes\_url, sort\_key, first\_seen\_at, fingerprint |
| check\_runs | Ein täglicher oder manueller Lauf | started\_at, finished\_at, trigger, status |
| check\_results | Ergebnis je Produkt und Lauf | run\_id, product\_id, status, error, duration\_ms, found\_count |
| channels | Teams-Ziele | name, type (teams\_workflow), webhook\_url (verschlüsselt), enabled |
| notifications | Ausgangskorb für Posts | release\_id, channel\_id, status, attempts, last\_error, sent\_at |
| credentials | Zugangsdaten für Hersteller-Portale | tracker\_id, username, secret (verschlüsselt) |
| settings | Schlüssel-Wert-Einstellungen | schedule (Cron), timezone, proxy, failure\_alert\_threshold |

Geheimnisse (Webhook-URLs, Passwörter) werden mit AES-256-GCM verschlüsselt. Der Schlüssel kommt aus der Umgebungsvariable `APP_SECRET`, nicht aus der Datenbank. Die UI zeigt sie nur maskiert an.

## Täglicher Prüflauf

Ein Scheduler im Container startet den Lauf täglich (Standard 06:00 Europe/Berlin, in der UI änderbar). Derselbe Ablauf läuft bei "Jetzt prüfen" für ein einzelnes Produkt oder alle.

1. Alle aktiven Produkte laden und mit begrenzter Parallelität abarbeiten (Standard 4 gleichzeitig, max. 60 s je Tracker, 3 Versuche mit Backoff).
2. Gefundene Releases normalisieren und je Versionslinie per `sortKey` mit der Datenbank vergleichen.
3. Neue Versionslinien anlegen; sie sind nur aktiv, wenn beim Produkt "neue Linien automatisch tracken" gesetzt ist.
4. Neue Releases speichern. Liegt die Linie im Tracking, entsteht ein Eintrag im Ausgangskorb (notifications).
5. Ausgangskorb an Teams senden; fehlgeschlagene Posts werden beim nächsten Lauf erneut versucht.
6. Ergebnis je Produkt in check\_results schreiben.

Drei Regeln verhindern Fehlalarme und Spam:

- **Baseline:** Beim ersten Lauf eines Produkts (oder einer Linie) wird alles nur gespeichert, nicht gepostet. Sonst kommen bei 100 Produkten Hunderte alte Versionen in den Kanal.
- **Kein Rückschritt:** Verschwindet eine bekannte Version von der Herstellerseite, wird sie nicht gelöscht und nichts gemeldet.
- **Ausfall-Warnung:** Schlägt ein Tracker an 3 Läufen in Folge fehl (Wert einstellbar), geht eine einmalige Warnung in Teams. Das ist wichtig, weil Herstellerseiten sich ändern und ein Tracker sonst still kaputt bleibt.

## Teams-Anbindung

Die Anbindung läuft über einen Teams-Workflow mit Webhook-Trigger; die alten Office-365-Connector-Webhooks hat Microsoft am 22. Mai 2026 endgültig abgeschaltet ([Office 365 for IT Pros](https://office365itpros.com/2026/09/18/teams-workflows-updates/)). Im Code steht keine URL, alles wird in der UI eingerichtet.

**Einrichtung durch den Anwender (in der UI als Anleitung angezeigt):**

1. In Teams am Ziel-Kanal "…" → Workflows → Vorlage "Post to a channel when a webhook request is received" wählen.
2. Team und Kanal bestätigen, Workflow anlegen, die erzeugte URL kopieren.
3. In der Tracker-UI unter Einstellungen → Teams-Kanäle einen Kanal anlegen, Namen und URL eintragen.
4. "Testnachricht senden" klicken. Erst nach erfolgreichem Test ist der Kanal aktiv.

**Nachrichtenformat:** Eine Adaptive Card je neuem Release, gesendet als `{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","content":{…}}]}` ([Patch My PC](https://patchmypc.com/blog/migrating-from-office-365-connectors/)). Inhalt: Hersteller und Produkt, Version und Typ (z. B. "Service Pack"), Versionslinie, Veröffentlichungsdatum, Button "Release Notes". Gibt es an einem Tag mehr als 5 neue Releases, kommt eine Sammelkarte statt Einzelposts.

**Zu beachten:**

- Der Workflow gehört dem Benutzer, der ihn anlegt, und Posts tragen dessen Namen. Empfehlung: mit einem Funktionskonto anlegen.
- Der Ersteller braucht eine Lizenz mit Cloud Workflows (z. B. Office 365 E1, E3, E5 oder F3).
- Die URL enthält eine Signatur und ist ein Geheimnis: verschlüsselt speichern, nie loggen.
- Mehrere Kanäle sind möglich. Eine spätere Stage kann Produkte gezielt einzelnen Kanälen zuordnen.

## Web-UI

Eine schlanke Single-Page-App (React + Vite) mit fünf Seiten, ausgeliefert vom selben Container. Bei 100 Produkten brauchen Listen Suche, Filter und Sammelaktionen.

| Seite | Inhalt | Aktionen |
| --- | --- | --- |
| Übersicht | Letzter Lauf, nächster Lauf, neue Releases der letzten 7 Tage, Tracker mit Fehlern | Alle jetzt prüfen |
| Produkte | Liste aller Tracker mit Hersteller, Status, letzter Prüfung, neuester Version; aufklappbar die Versionslinien | Tracking an/aus je Produkt und je Linie, "neue Linien automatisch tracken", Jetzt prüfen, Filter nach Hersteller und Status |
| Releases | Verlauf aller gefundenen Versionen, neueste zuerst | Filtern, Link zu Release Notes, Post erneut senden |
| Läufe | Protokoll je Lauf und Produkt mit Fehlermeldung und Dauer | Details öffnen |
| Einstellungen | Teams-Kanäle, Zeitplan und Zeitzone, Proxy, Zugangsdaten für Hersteller-Portale, Schwelle für Ausfall-Warnung | Kanal anlegen, testen, deaktivieren; Werte speichern |

Die UI spricht nur mit einer REST-API (`/api/...`), die mit zod-Schemas validiert ist. Die Schemas teilen sich Backend und Frontend in einem gemeinsamen Paket, damit Typen nicht auseinanderlaufen.

## Docker und Betrieb

Ein Image, ein Container, ein Volume. Start mit `docker compose up -d`, danach ist die UI unter Port 8080 erreichbar.

- **Image:** Multi-Stage-Build auf `node:<LTS>-slim`; baut UI und Backend, Laufzeit-Image enthält nur das Ergebnis. Eine Variante mit Playwright/Chromium nur, falls ein Tracker sie wirklich braucht (das Image wird damit deutlich größer).
- **Volume:** `/data` für SQLite-Datenbank und Logs. Sicherung = dieses Verzeichnis kopieren; zusätzlich tägliches internes Backup mit 14 Tagen Aufbewahrung.
- **Umgebungsvariablen:** nur Infrastruktur, keine fachliche Konfiguration: `APP_SECRET` (Pflicht), `TZ`, `PORT`, `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`, `LOG_LEVEL`.
- **Healthcheck:** `GET /api/health` prüft Datenbank und Scheduler; im Dockerfile als `HEALTHCHECK` eingetragen.
- **Logs:** JSON nach stdout (pino), damit sie mit `docker logs` oder einem Log-System lesbar sind.
- **Netz:** Ausgehend HTTPS zu den Herstellerseiten und zu Power Automate (Teams-Webhook). Eingehend nur Port 8080 aus dem internen Netz.
- **Ohne Anmeldung:** Da jeder im Netz Kanäle und Zugangsdaten ändern kann, Port nur intern freigeben oder per Firewall auf ein Admin-Subnetz begrenzen. Optional später: Basic Auth über einen Reverse Proxy, ohne Codeänderung.

## Entwicklungs-Stages

Sieben Stages, jede ein eigener Branch und Pull Request, jede am Ende lauffähig im Container. Eine Stage beginnt erst, wenn die vorige ihre Abnahme erfüllt.

| Stage | Ziel | Ergebnis | Abnahme |
| --- | --- | --- | --- |
| 0 Grundgerüst | Leitplanken für alles Weitere | pnpm-Monorepo (`server`, `web`, `shared`), TypeScript strict, ESLint, Vitest, Dockerfile, Compose, `/api/health`, CLAUDE.md, CI | `docker compose up` zeigt leere UI, `pnpm test` und `pnpm lint` grün |
| 1 Kern | Prüflauf ohne UI und ohne Teams | Datenmodell mit Migrationen, Tracker-Schnittstelle, Registry, Runner, Versionsvergleich, Baseline-Logik, ein Demo-Tracker gegen Fixture, CLI `pnpm check` | Demo-Tracker: 1. Lauf legt Baseline an, geänderte Fixture erzeugt genau 1 neues Release; Unit-Tests für Vergleich und Sortierung |
| 2 Teams | Benachrichtigung | Kanal-API, Verschlüsselung, Adaptive Card, Ausgangskorb mit Wiederholung, Testnachricht, Sammelkarte | Testnachricht kommt im echten Kanal an; Post-Fehler werden beim nächsten Lauf wiederholt |
| 3 Web-UI | Bedienung ohne Code | Die fünf Seiten aus Abschnitt Web-UI, Toggles je Produkt und Linie, Einstellungen, Jetzt prüfen | Produkt und Linie in der UI schaltbar, Teams-Kanal komplett über die UI einrichtbar, Änderungen überleben einen Neustart |
| 4 Erste echte Tracker | Bewährung an echten Quellen | Tracker für SOLIDWORKS und PTC Creo, je mit Fixture und Test; Quellen-Recherche dokumentiert | Jeder Tracker findet die aktuell neueste Version jeder Linie; Tests laufen offline |
| 5 Betrieb | Dauerbetrieb ohne Aufsicht | Scheduler mit Zeitzone, Ausfall-Warnung, Proxy, Rate-Limit, Backups, Lauf-Protokoll in der UI | 7 Tage Probebetrieb ohne manuellen Eingriff; absichtlich kaputter Tracker löst nach 3 Läufen eine Warnung aus |
| 6 Skalierung | 20 bis 100 Produkte effizient anbinden | Quelltyp-Helfer (RSS, GitHub, JSON, HTML-Tabelle, KB-Artikel), Generator und Claude-Code-Skill `/neuer-tracker`, Produkt-Zuordnung zu Kanälen | Ein Standard-Tracker entsteht in einer Sitzung mit Test; Lauf mit 100 Trackern unter 15 Minuten |

**Startpunkte für Stage 4 (vor der Umsetzung zu prüfen):**

- **SOLIDWORKS:** Öffentliche Release Notes je Jahresversion unter `files.solidworks.com/Supportfiles/Release_Notes/<Jahr>/English/relnotes.htm`; die Seite nennt das aktuelle SP im Titel, für 2026 z. B. "SOLIDWORKS Design 2026 SP2" ([Release Notes 2026](https://files.solidworks.com/Supportfiles/Release_Notes/2026/English/relnotes.htm)). Neue Jahresversion etwa jeden Oktober, danach 5 SPs im Abstand von 2 bis 3 Monaten ([Hawk Ridge Systems](https://support.hawkridgesys.com/hc/en-us/articles/224134527-SOLIDWORKS-Service-Packs-Best-Practices)).
- **PTC Creo:** Maintenance Releases (M010, M020 …) erscheinen etwa alle 2 bis 3 Monate. Die offizielle Quelle (Product Calendar, Support-Artikel) ist vermutlich login-pflichtig; Quelle und Login-Bedarf sind die erste Aufgabe der Stage.

## Arbeitsweise mit Claude Code

Claude Code arbeitet eine Stage pro Sitzung ab: zuerst einen Plan vorlegen lassen, freigeben, dann umsetzen, testen, Pull Request. Dieses Konzept liegt als `docs/konzept.md` im Repo, damit jede Sitzung darauf zugreift.

**Inhalt der `CLAUDE.md` (in Stage 0 angelegt):**

- Zweck des Projekts in drei Sätzen und Verweis auf `docs/konzept.md`
- Befehle: `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm check`, `docker compose up --build`
- Ordnerstruktur und wo was hingehört (Tracker nur in `server/src/trackers/`)
- Harte Regeln: keine URLs, Tokens oder Kanäle im Code; Tests nie gegen das Live-Netz; keine neue Abhängigkeit ohne Begründung im PR; Migrationen nie nachträglich ändern
- Definition of Done (siehe unten)

**Prompt-Vorlage je Stage:**

```text
Lies CLAUDE.md und docs/konzept.md. Setze Stage <N> "<Name>" um.
Erstelle zuerst einen Plan mit Dateien, Schritten und Tests und warte auf Freigabe.
Abnahme laut Konzept: <Abnahmekriterium aus der Tabelle>.
Arbeite auf Branch stage-<N>, committe in kleinen Schritten, öffne am Ende einen PR.
```

**Skill `/neuer-tracker` (ab Stage 6):** Ein Claude-Code-Skill im Repo (`.claude/skills/neuer-tracker/`), der für ein neues Produkt immer gleich vorgeht: Quelle recherchieren und im PR dokumentieren, passenden Quelltyp-Helfer wählen, Seite als Fixture speichern, Parser schreiben, Test gegen Fixture, Tracker registrieren, einmal live gegenprüfen. So bleiben 100 Tracker einheitlich.

**Definition of Done je Aufgabe:**

- [ ] Tests geschrieben und grün, Lint grün
- [ ] Container baut und startet, Healthcheck grün
- [ ] Abnahmekriterium der Stage im PR nachgewiesen (Log-Auszug oder Screenshot)
- [ ] Konzept oder CLAUDE.md aktualisiert, wenn sich etwas geändert hat

## Risiken und offene Punkte

| Risiko | Auswirkung | Gegenmaßnahme |
| --- | --- | --- |
| Herstellerseiten ändern ihr Layout | Tracker findet nichts oder Falsches | Fehler statt leerer Liste, Ausfall-Warnung nach 3 Läufen, Fixture-Tests |
| Quellen hinter Login (z. B. PTC) | Kein Zugriff ohne Konto; Nutzungsbedingungen | Zuerst öffentliche Quellen suchen; Login nur mit Firmenkonto und nach Prüfung der Nutzungsbedingungen |
| Bot-Schutz oder JavaScript-Seiten | Einfacher HTTP-Abruf scheitert | Playwright nur für betroffene Tracker, niedrige Abruffrequenz |
| Uneinheitliche Versionsschemata (2026 SP2.0, 11.0 M020) | Falsche Reihenfolge, Doppelmeldungen | `sortKey` pro Tracker, Tests mit echten Versionsfolgen |
| Teams-Workflow hängt an einer Person | Posts brechen ab, wenn das Konto wegfällt | Funktionskonto, Testnachricht-Button, Fehlerstatus am Kanal in der UI |
| Keine Anmeldung | Jeder im Netz kann Einstellungen ändern | Nur internes Netz, optional Reverse Proxy mit Basic Auth |

**Offene Fragen vor Stage 0:**

- [ ] Gibt es ein Firmenkonto für PTC Support, falls öffentliche Quellen für Creo nicht reichen?
- [ ] Ein Kanal für alles oder Kanäle je Abteilung/Produktgruppe?
- [ ] Wo liegt das Repo (GitHub, GitLab, Azure DevOps), damit Claude Code dort Branches und PRs anlegen kann?

## Quellen

- [Office 365 for IT Pros: Replacing Retired Office 365 Connectors with Teams Workflows](https://office365itpros.com/2026/09/18/teams-workflows-updates/)
- [Patch My PC: Migrating from Office 365 Connectors to the Workflows App](https://patchmypc.com/blog/migrating-from-office-365-connectors/)
- [SOLIDWORKS Design 2026 Release Notes](https://files.solidworks.com/Supportfiles/Release_Notes/2026/English/relnotes.htm)
- [Hawk Ridge Systems: SOLIDWORKS Service Packs Best Practices](https://support.hawkridgesys.com/hc/en-us/articles/224134527-SOLIDWORKS-Service-Packs-Best-Practices)
