# softversion – Software-Update-Tracker

Ein Docker-Container prüft täglich für 20 bis 100 Softwareprodukte, ob es für getrackte Versionslinien neue Releases,
Service Packs oder Hotfixes gibt, speichert sie in SQLite und postet sie per Workflow-Webhook in Teams.
Je Produkt gibt es ein Tracker-Modul (Code); alles andere wird in der Web-UI bedient.
Fachliches Konzept: `docs/konzept.md`, Abweichungen davon: `docs/abweichungen.md`, Tracker-Quellen: `docs/quellen.md`.

## Befehle

- `npm run dev` – Backend mit Watch auf :8080 und Vite-UI auf :5173 (Proxy auf /api)
- `npm test` – alle Tests (node:test, offline)
- `npm run lint` – TypeScript-Typprüfung (strict)
- `npm run check` – einmaliger Prüflauf über die CLI (`-- <tracker-id>` für ein Produkt)
- `npm run new-tracker -- <id> ...` – Gerüst für einen neuen Tracker (siehe Skill `neuer-tracker`)
- `docker compose up -d --build` – Container bauen und starten (UI auf Port 8080)

## Struktur

- `src/server/` – Backend (Node 24, TypeScript ohne Build über Type Stripping, `node:sqlite`, node:http)
  - `trackers/` – **nur hier** Produkt-Tracker, eine Datei je Produkt; `_sources/` enthält Quelltyp-Helfer
  - `migrations/` – nummerierte SQL-Migrationen, laufen beim Start automatisch
- `src/shared/` – zod-Schemas und API-Typen für Backend und UI
- `src/web/` – React-UI (Vite)
- `test/` – Tests, `test/fixtures/` gespeicherte Herstellerseiten
- `scripts/` – Generator für neue Tracker

## Harte Regeln

- Keine URLs von Webhooks, Tokens, Passwörter oder Kanäle im Code oder in Logs.
- Tests nie gegen das Live-Netz; Parser werden gegen Fixtures getestet.
- Tracker: Abrufen und Parsen trennen; findet der Parser nichts Plausibles, **Fehler werfen**, nie leere Liste.
- Tracker-`id` nie ändern (ist Schlüssel in der Datenbank).
- Keine neue Abhängigkeit ohne Begründung im PR.
- Migrationen nie nachträglich ändern, nur neue anlegen.
- TypeScript nur mit "erasable syntax" (keine enums, keine Parameter-Properties), Importe mit `.ts`-Endung.
- Version in `package.json` pflegen und `CHANGELOG.md` ergänzen.

## Definition of Done

- Tests geschrieben und grün, `npm run lint` grün
- Container baut und startet, Healthcheck grün
- Abnahmekriterium der Stage im PR nachgewiesen
- Konzept, README oder CLAUDE.md aktualisiert, wenn sich etwas geändert hat
