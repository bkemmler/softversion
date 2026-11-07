import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { render, SOURCES, type Source } from "../scripts/new-tracker.ts";
import { validateReleases, type Tracker } from "../src/server/tracker.ts";
import { parseFeed } from "../src/server/trackers/_sources/feed.ts";
import { parseHtmlTable, kbSections } from "../src/server/trackers/_sources/html.ts";
import { numericKey, lineOf, typeOf, isoDate } from "../src/server/trackers/_sources/version.ts";

const TRACKERS = join(import.meta.dirname, "../src/server/trackers");

/** Generierte Tracker-Datei in ein Temp-Verzeichnis schreiben; relative Importe auf die echten Module umbiegen. */
async function loadGenerated(source: Source) {
  const files = render({ id: `acme-${source}`, vendor: "ACME", product: "Widget", source, url: source === "github" ? "acme/widget" : "https://example.com/releases" });
  const code = files[`src/server/trackers/acme-${source}.ts`]
    .replaceAll('"../tracker.ts"', JSON.stringify(pathToFileURL(join(TRACKERS, "../tracker.ts")).href))
    .replaceAll('"./_sources/', `"${pathToFileURL(join(TRACKERS, "_sources")).href}/`)
    .replaceAll('"zod"', JSON.stringify(import.meta.resolve("zod")));
  const file = join(mkdtempSync(join(tmpdir(), "sv-gen-")), `acme-${source}.ts`);
  writeFileSync(file, code);
  return { mod: await import(pathToFileURL(file).href), files };
}

test("Generator: alle Quelltypen erzeugen ladbare Tracker mit Test und Fixture", async () => {
  for (const source of SOURCES) {
    const { mod, files } = await loadGenerated(source);
    const t = mod.default as Tracker;
    assert.equal(t.id, `acme-${source}`);
    assert.equal(typeof mod.parse, "function");
    assert.ok(Object.keys(files).some((f) => f.startsWith(`test/trackers/acme-${source}.test.ts`)));
    assert.ok(Object.keys(files).some((f) => f.startsWith(`test/fixtures/acme-${source}/source.`)));
  }
});

test("Abnahme Stage 6: Standard-Tracker aus dem Generator parst typische Quellen ohne Anpassung", async () => {
  const html = (await loadGenerated("html-table")).mod;
  const table = `<table><tr><th>Version</th><th>Date</th></tr>
    <tr><td><a href="/notes/4.2.1">4.2.1</a></td><td>2026-10-01</td></tr><tr><td>4.2.0</td><td>2026-08-01</td></tr><tr><td>3.9</td><td>2025-12-24</td></tr></table>`;
  const rel = validateReleases(html.parse(table));
  assert.deepEqual(rel.map((r) => [r.line, r.version, r.type]), [["4", "4.2.1", "hotfix"], ["4", "4.2.0", "servicepack"], ["3", "3.9", "servicepack"]]);
  assert.equal(rel[0].notesUrl, "https://example.com/notes/4.2.1");

  const rss = (await loadGenerated("rss")).mod;
  const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
    <item><title>Widget 5.0 released</title><link>https://example.com/5.0</link><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item>
    <item><title>Webinar am Freitag</title></item></channel></rss>`;
  assert.deepEqual(validateReleases(rss.parse(feed)).map((r) => [r.version, r.releaseDate, r.type]), [["5.0", "2026-11-03", "major"]]);

  const gh = (await loadGenerated("github")).mod;
  const releases = [{ tag_name: "v2.1.0", name: null, html_url: "https://github.com/acme/widget/releases/v2.1.0", draft: false, prerelease: false, published_at: "2026-09-09T00:00:00Z" }];
  assert.deepEqual(validateReleases(gh.parse(releases)).map((r) => [r.line, r.version]), [["2", "2.1.0"]]);

  const kb = (await loadGenerated("kb")).mod;
  const article = `<div><h2>Applies To</h2><ul><li>Widget 7.0 to 7.3</li><li>Widget 8.1</li></ul></div>`;
  assert.deepEqual(validateReleases(kb.parse(article)).map((r) => r.version).sort(), ["7.3", "8.1"]);
});

test("Quelltyp-Helfer: Feed (Atom), HTML-Tabelle, KB-Abschnitte, Versionen", () => {
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>1.2.3</title><link rel="alternate" href="https://e.com/1"/><updated>2026-01-02T00:00:00Z</updated></entry></feed>`;
  assert.deepEqual(parseFeed(atom), [{ title: "1.2.3", link: "https://e.com/1", date: "2026-01-02T00:00:00Z", summary: "" }]);
  assert.throws(() => parseFeed("<html><body>kein Feed</body></html>"), /Kein RSS/);
  assert.throws(() => parseHtmlTable("<p>leer</p>"), /nicht gefunden/);
  assert.deepEqual(parseHtmlTable("<table><thead><tr><th>A</th></tr></thead><tbody><tr><td> x  y </td></tr></tbody></table>")[0].cells, { A: "x y" });
  assert.deepEqual(kbSections("<div><h3>Applies To</h3><p>Foo 1.0</p></div>", ["Applies To", "Fehlt"]), { "Applies To": ["Foo 1.0"] });
  assert.deepEqual(numericKey("v11.0.3.0-beta"), [11, 0, 3, 0]);
  assert.equal(lineOf("2026.2.1", 2), "2026.2");
  assert.equal(typeOf([2026, 0, 0]), "major");
  assert.equal(typeOf([2026, 3]), "servicepack");
  assert.equal(typeOf([2026, 3, 1]), "hotfix");
  assert.equal(isoDate("kaputt"), undefined);
  assert.throws(() => numericKey("ohne"), /Keine Versionsnummer/);
});
