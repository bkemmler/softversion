---
name: neuer-tracker
description: Neues Softwareprodukt an den Update-Tracker anbinden – Quelle recherchieren, Tracker mit Generator anlegen, Fixture speichern, Parser und Test schreiben, Quelle dokumentieren. Nutzen bei "neuer Tracker", "Produkt hinzufügen", "/neuer-tracker <Hersteller> <Produkt>".
---

# Neuer Tracker

Ziel: ein Tracker je Produkt, immer gleich aufgebaut, offline getestet. Regeln aus `CLAUDE.md` gelten (keine Live-Tests,
Fehler statt leerer Liste, ID nie ändern).

## Ablauf

1. **Quelle recherchieren.** Öffentliche, maschinenlesbare Quelle bevorzugen, in dieser Reihenfolge:
   GitHub Releases → RSS/Atom-Feed → JSON-API → HTML-Tabelle/Liste → Knowledge-Base-Artikel.
   Login-pflichtige Quellen nur, wenn es keine öffentliche gibt (dann `requiresCredentials: true`, Zugangsdaten kommen aus der UI).
   Prüfen: Welche Versionslinien gibt es (Jahres-/Hauptversion)? Wie heißen SPs/Hotfixes? Gibt es Datum und Release-Notes-Link?
2. **Gerüst erzeugen:**
   `npm run new-tracker -- <hersteller-produkt> --vendor "<Hersteller>" --product "<Produkt>" --source <html-table|rss|github|json|kb> --url <Quelle>`
   (bei `github` ist `--url` das Repo `owner/name`). ID: klein, mit Bindestrich, z. B. `siemens-nx`.
3. **Fixture speichern:** echte Seite/Antwort nach `test/fixtures/<id>/source.<ext>`. Bei großen Seiten auf die
   relevanten Teile kürzen, Struktur aber original lassen. Quelle und Datum als Kommentar in die Fixture, falls das Format es erlaubt.
4. **Parser anpassen** (`src/server/trackers/<id>.ts`, Funktion `parse`): pur, ohne Netz. Helfer in
   `src/server/trackers/_sources/` nutzen (`version.ts`, `feed.ts`, `github.ts`, `json.ts`, `html.ts`).
   - `line` = Versionslinie, die einzeln schaltbar sein soll (meist Jahres- oder Hauptversion).
   - `sortKey` = Zahlenfolge, die innerhalb der Linie richtig sortiert (z. B. `[2026, 2, 0]` für „2026 SP2.0“).
   - `type`: major | servicepack | hotfix | patch. Vorabversionen (Beta, Prerelease, RC) **nicht** liefern.
   - Findet der Parser nichts Plausibles: `throw new Error(...)` mit klarer Meldung.
5. **Test anpassen** (`test/trackers/<id>.test.ts`): erwartete neueste Version je Linie eintragen; mindestens ein
   Negativfall (z. B. leere/geänderte Seite wirft). `npm test` und `npm run lint` müssen grün sein.
6. **Einmal live gegenprüfen:** `npm run check -- <id>` mit lokaler `APP_SECRET` (nur lesend, legt die Baseline in `./data` an).
   Ergebnis mit der Herstellerseite vergleichen.
7. **Dokumentieren:** Abschnitt in `docs/quellen.md` (Quelle, Recherche-Datum, Grenzen), Eintrag in `CHANGELOG.md`.
   Im PR: Quelle, Begründung der Quellwahl, Ausgabe von Schritt 6.

Nach dem Deployment erscheint das Produkt in der UI (deaktiviert) und wird dort eingeschaltet. Der erste Lauf ist die Baseline.
