# softversion – Software-Update-Tracker

Ein Docker-Container prüft einmal täglich Herstellerseiten (z. B. SOLIDWORKS, PTC Creo) auf neue Releases,
Service Packs und Hotfixes, speichert sie in SQLite und postet neue Versionen in einen Teams-Kanal.
Bedienung komplett über die Web-UI; neue Produkte kommen als Tracker-Modul (Code) dazu.

Konzept: [docs/konzept.md](docs/konzept.md) · Abweichungen: [docs/abweichungen.md](docs/abweichungen.md) · Quellen der Tracker: [docs/quellen.md](docs/quellen.md)

## Start

Voraussetzung: Docker mit Compose.

```bash
cp env.example .env
# In .env APP_SECRET setzen, z. B. Ausgabe von: openssl rand -base64 32
docker compose up -d --build
```

UI: `http://<host>:8080`. Danach in der UI:

1. **Einstellungen → Teams-Kanäle:** Workflow-URL eintragen, „Anlegen und testen“ (Anleitung steht dort).
2. **Produkte:** Tracking für die gewünschten Produkte einschalten, ggf. einzelne Versionslinien abschalten.
3. **Übersicht → Alle jetzt prüfen:** Der erste Lauf je Produkt ist die *Baseline* – alles wird gespeichert, nichts gepostet.
   Ab dem nächsten Lauf werden nur neue Versionen gemeldet.

## Betrieb

| Thema | Details |
| --- | --- |
| Zeitplan | Täglich, Standard 06:00 Europe/Berlin; Uhrzeit und Zeitzone in der UI änderbar |
| Daten | Volume `/data`: `softversion.db` (SQLite), `logs/`, `backups/` |
| Backup | Nach jedem geplanten Lauf `backups/softversion-JJJJ-MM-TT.db`, 14 Tage Aufbewahrung. Komplette Sicherung = `/data` kopieren |
| Logs | JSON nach stdout (`docker compose logs -f`) und `/data/logs/app-JJJJ-MM-TT.log` (14 Tage) |
| Healthcheck | `GET /api/health` prüft Datenbank und Scheduler; im Dockerfile als `HEALTHCHECK` |
| Ausfall-Warnung | Schlägt ein Tracker n-mal in Folge fehl (Standard 3, in der UI änderbar), kommt einmalig eine Warnung in Teams |
| Teams-Fehler | Fehlgeschlagene Posts bleiben im Ausgangskorb und werden beim nächsten Lauf wiederholt (max. 10 Versuche) |
| Netz | Ausgehend HTTPS zu Herstellerseiten und Power Automate. Eingehend nur Port 8080 |
| Sicherheit | **Keine Anmeldung.** Port nur im internen Netz freigeben bzw. per Firewall auf ein Admin-Subnetz begrenzen; optional Reverse Proxy mit Basic Auth davor |

### Umgebungsvariablen

Nur Infrastruktur, alles Fachliche steht in der UI.

| Variable | Pflicht | Bedeutung |
| --- | --- | --- |
| `APP_SECRET` | ja | Schlüssel für die Verschlüsselung (AES-256-GCM) von Webhook-URLs und Passwörtern, mind. 16 Zeichen. **Nicht verlieren** – sonst Kanäle und Zugangsdaten neu eintragen |
| `TZ` | nein | Zeitzone des Containers (Logs), Standard `Europe/Berlin` |
| `PORT` | nein | Standard `8080` |
| `LOG_LEVEL` | nein | `debug`, `info` (Standard), `warn`, `error` |
| `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` | nein | Proxy für ausgehende Abrufe (wird über `NODE_USE_ENV_PROXY=1` von Node genutzt) |

### Update und Wiederherstellung

```bash
git pull
docker compose up -d --build
```

Migrationen laufen beim Start automatisch. Wiederherstellen: Container stoppen, gewünschtes Backup als
`/data/softversion.db` ins Volume kopieren (vorher `softversion.db-wal` und `-shm` entfernen), Container starten.

## Entwicklung

Node.js ≥ 22.18 (Docker: Node 24). TypeScript läuft ohne Build direkt in Node.

```bash
npm install
npm run dev        # Backend :8080 + UI mit Hot Reload :5173
npm test           # alle Tests, offline
npm run lint       # Typprüfung
npm run check      # einmaliger Prüflauf über die CLI; -- <tracker-id> für ein Produkt
```

Lokal braucht der Server `APP_SECRET` in der Umgebung, Daten landen in `./data`.

### Neues Produkt anbinden

```bash
npm run new-tracker -- <hersteller-produkt> --vendor "<Hersteller>" --product "<Produkt>" --source <html-table|rss|github|json|kb> --url <Quelle>
```

Erzeugt Tracker, Test und Fixture-Platzhalter. Dann Seite als Fixture speichern, Parser anpassen, `npm test`,
Quelle in `docs/quellen.md` dokumentieren. Der Claude-Code-Skill `neuer-tracker` führt durch alle Schritte.
Nach dem Deployment erscheint das Produkt in der UI und wird dort aktiviert.

## Version

Siehe [CHANGELOG.md](CHANGELOG.md); die laufende Version zeigt die UI unten auf der Übersicht und `GET /api/health`.
