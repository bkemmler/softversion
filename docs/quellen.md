# Quellen der Tracker

Je Tracker: woher die Versionen kommen, was die Quelle kann und was nicht. Recherche-Datum angeben.

## dassault-solidworks (recherchiert 2026-11-07)

- Quelle: `https://files.solidworks.com/Supportfiles/Release_Notes/<Jahr>/English/relnotes.htm`, öffentlich, ohne Login.
- Der `<title>` nennt das aktuelle SP, z. B. „SOLIDWORKS Design 2026 SP5 Release Notes“ (bis 2025 ohne „Design“).
- Zustände am 2026-11-07: 2024 SP5, 2025 SP5, 2026 SP5, 2027 „Prerelease“, 2028 „Document Coming Soon“ (HTTP 200, leerer Titel).
- Der Tracker prüft die Jahre (aktuelles Jahr − 2) bis (aktuelles Jahr + 1). Prerelease/Coming Soon zählen nicht als Release.
- Grenzen: Die Seite zeigt nur das aktuelle SP, keine Historie und kein Datum. Frühere SPs entstehen in der Datenbank
  über die täglichen Läufe. Die Seite lädt ein Akamai-Skript (Bot-Schutz); falls Abrufe aus dem Container geblockt werden,
  ist das in den Läufen als Fehler sichtbar (nach 3 Fehlläufen kommt eine Warnung in Teams).

## ptc-creo (recherchiert 2026-11-07)

- Gesucht: offizielle Liste der Maintenance Releases. Product Calendar, Release Notes und Support-Artikel sind bei PTC
  login-pflichtig; `ptc.com/en/support/refdoc/...` antwortet automatisierten Abrufen mit HTTP 403.
- Öffentlich ist der Knowledge-Hub-Artikel **CS34553** „[Knowledge Hub] Creo Parametric – What's New“
  (`https://www.ptc.com/en/support/article/CS34553`). Ohne Login sind „Applies To“ und „Description“ sichtbar, z. B.
  „Creo Parametric 7.0 to 2027.2“ und Nennungen von 12.4 und 13.4.
- Die öffentliche PTC-Plattformliste (`support.ptc.com/partners/hardware/current/support.htm`, eine PDF) bestätigt
  dieselben Stände: Creo 2027.2, 13.4, 12.4, 11.0, 10.0, 9.0. Sie wird nicht genutzt, weil dafür ein PDF-Parser nötig wäre.
- Benennung: seit Creo 12 heißen Maintenance Releases 12.1, 12.2 …; ab 2027 jahresbasiert (2027.1, 2027.2 …).
- Der Tracker meldet je Hauptversion (Linie) die höchste genannte Version.
- Grenzen: Best effort. Der Artikel wird von Hand gepflegt und kann nachhinken; ältere Linien (10.0, 11.0) zeigen nur die
  Hauptversion, nicht deren Maintenance-Stand (z. B. 11.0.6.0). Genauer wäre der PTC Product Calendar mit Firmenkonto
  (offene Frage im Konzept); dann `requiresCredentials: true` setzen und die Zugangsdaten in der UI hinterlegen.
