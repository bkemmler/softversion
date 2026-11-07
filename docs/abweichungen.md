# Abweichungen vom Konzept

Bewusste Vereinfachungen bei gleicher Funktion (Entscheidung „schlanker Stack“, 2026-11-07).

| Konzept | Umsetzung | Grund |
| --- | --- | --- |
| pnpm-Monorepo `server`/`web`/`shared` | Ein npm-Paket mit `src/server`, `src/web`, `src/shared` | Gleiche Trennung, kein Workspace-Overhead; Schemas trotzdem gemeinsam |
| Fastify | `node:http` mit ~80 Zeilen Router (`src/server/server.ts`) | Keine Abhängigkeit für eine Handvoll Routen |
| Drizzle + SQLite | `node:sqlite` + nummerierte SQL-Migrationen (`PRAGMA user_version`) | Eingebaut, keine native Abhängigkeit |
| pino | Eigene `writeLog` (JSON nach stdout und Datei) | 30 Zeilen statt Abhängigkeit |
| Vitest, ESLint | `node:test`, `tsc --noEmit` als `npm run lint` | Eingebaut; TypeScript strict fängt das Wesentliche |
| TypeScript-Build fürs Backend | Node führt TypeScript direkt aus (Type Stripping) | Kein Build-Schritt, Stacktraces zeigen Originalzeilen |
| Playwright optional | Nicht eingebaut | Kein Tracker braucht es bisher; bei Bedarf nachrüsten |
| `ctx.html`, `ctx.json`, `ctx.browser` | Tracker importieren `cheerio`/`zod` direkt; `ctx` hat `http`, `credentials`, `log`, `signal` | Weniger Indirektion |
| Proxy als Einstellung in der UI | Nur über `HTTP(S)_PROXY` (Konzept: Internet ohne Proxy) | Infrastruktur gehört in die Umgebung |
| Zeitplan als Cron in `settings` | Uhrzeit `HH:MM` + Zeitzone | Das Konzept will „1x täglich, Uhrzeit einstellbar“ |
| Baseline auch für neue Linien | Neue Linie eines bereits geprüften Produkts meldet ihre **neueste** Version (wenn die Linie aktiv ist) | Sonst würde z. B. „SOLIDWORKS 2027 SP0“ nie gemeldet; Spam ist ausgeschlossen, weil nur eine Version je neuer Linie |
| Sammelkarte „mehr als 5 an einem Tag“ | Mehr als 5 neue Releases je Kanal in einem Versand (= Lauf) | Ein Lauf pro Tag, also gleichwertig |
| Neue Releases mit kleinerem sortKey | Werden gespeichert, aber nicht gemeldet | Konzept: Vergleich per sortKey; verhindert Doppelmeldungen bei Formatwechseln |
| Release-Zip | Nicht erstellt | Auslieferung über das Docker-Image bzw. Git |
