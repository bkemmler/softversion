# Changelog

## 1.0.0 (2026-11-07)

Erste vollständige Version, Stages 0–6 laut `docs/konzept.md`.


- Stage 0: Grundgerüst (TypeScript, Tests, Dockerfile, Compose, `/api/health`, CI)
- Stage 1: Kern (Datenmodell, Tracker-Schnittstelle, Registry, Runner mit Baseline, CLI `npm run check`)
- Stage 2: Teams (Workflow-Webhook, Adaptive Cards, Ausgangskorb mit Wiederholung, Sammelkarte, AES-256-GCM)
- Stage 3: Web-UI (Übersicht, Produkte, Releases, Läufe, Einstellungen), REST-API, Zeitplan
- Stage 4: Tracker für SOLIDWORKS und PTC Creo mit Fixtures, Quellen in `docs/quellen.md`
- Stage 5: Betrieb (Backups mit 14 Tagen Aufbewahrung, Log-Rotation, Scheduler mit Zeitzone, Ausfall-Warnung, Retry/Rate-Limit, README)
- Stage 6: Quelltyp-Helfer (Version, RSS/Atom, GitHub, JSON, HTML-Tabelle, KB-Artikel), Generator `npm run new-tracker`, Skill `neuer-tracker`, Produkt→Kanal-Zuordnung
