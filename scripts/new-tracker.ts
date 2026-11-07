/**
 * Gerüst für einen neuen Tracker: Tracker-Datei, Test und Fixture-Platzhalter.
 *
 *   npm run new-tracker -- <id> --vendor "<Hersteller>" --product "<Produkt>" --source <typ> --url <Quelle>
 *
 * Quelltypen: html-table | rss | github | json | kb. Bei github ist --url das Repo "owner/name".
 * Danach: echte Seite als Fixture speichern, Parser anpassen, erwartete Versionen im Test eintragen, `npm test`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

export const SOURCES = ["html-table", "rss", "github", "json", "kb"] as const;
export type Source = (typeof SOURCES)[number];
export type Options = { id: string; vendor: string; product: string; source: Source; url: string };

const FIXTURE_EXT: Record<Source, string> = { "html-table": "html", rss: "xml", github: "json", json: "json", kb: "html" };

const BODIES: Record<Source, (o: Options) => { imports: string; parse: string; fetch: string }> = {
  "html-table": () => ({
    imports: `import { parseHtmlTable } from "./_sources/html.ts";\nimport { isoDate, lineOf, numericKey, typeOf } from "./_sources/version.ts";`,
    parse: `export function parse(html: string): ReleaseInfo[] {
  // TODO: Tabellen-Selektor und Spaltennamen an die Seite anpassen.
  return parseHtmlTable(html, "table", SOURCE)
    .filter((r) => r.cells["Version"])
    .map(({ cells, links }) => {
      const version = cells["Version"];
      const sortKey = numericKey(version);
      return { line: lineOf(version), version, type: typeOf(sortKey), releaseDate: isoDate(cells["Date"]), notesUrl: links["Version"] ?? SOURCE, sortKey };
    });
}`,
    fetch: `async (ctx) => parse(await ctx.http.getText(SOURCE))`,
  }),
  rss: () => ({
    imports: `import { parseFeed } from "./_sources/feed.ts";\nimport { isoDate, lineOf, numericKey, typeOf } from "./_sources/version.ts";`,
    parse: `export function parse(xml: string): ReleaseInfo[] {
  // TODO: nur Einträge übernehmen, die wirklich Releases sind (Titel-Muster anpassen).
  return parseFeed(xml)
    .filter((i) => /\\d+\\.\\d+/.test(i.title))
    .map((i) => {
      const sortKey = numericKey(i.title);
      const version = sortKey.join(".");
      return { line: lineOf(version), version, type: typeOf(sortKey), releaseDate: isoDate(i.date), notesUrl: i.link, sortKey };
    });
}`,
    fetch: `async (ctx) => parse(await ctx.http.getText(SOURCE))`,
  }),
  github: () => ({
    imports: `import { githubReleases, type GithubRelease } from "./_sources/github.ts";\nimport { isoDate, lineOf, numericKey, typeOf } from "./_sources/version.ts";`,
    parse: `export function parse(releases: GithubRelease[]): ReleaseInfo[] {
  // TODO: Linie anpassen (lineOf(version, 1) = Hauptversion, 2 = Haupt- und Nebenversion).
  return releases.map((r) => {
    const sortKey = numericKey(r.tag_name);
    const version = sortKey.join(".");
    return { line: lineOf(version), version, type: typeOf(sortKey), releaseDate: isoDate(r.published_at), notesUrl: r.html_url, sortKey };
  });
}`,
    fetch: `async (ctx) => parse(await githubReleases(ctx, SOURCE))`,
  }),
  json: () => ({
    imports: `import { z } from "zod";\nimport { fetchJson } from "./_sources/json.ts";\nimport { isoDate, lineOf, numericKey, typeOf } from "./_sources/version.ts";`,
    parse: `// TODO: Schema an die Antwort der API anpassen.
export const schema = z.array(z.object({ version: z.string(), date: z.string().optional(), url: z.string().url().optional() }));

export function parse(data: z.infer<typeof schema>): ReleaseInfo[] {
  return data.map((d) => {
    const sortKey = numericKey(d.version);
    return { line: lineOf(d.version), version: d.version, type: typeOf(sortKey), releaseDate: isoDate(d.date), notesUrl: d.url ?? SOURCE, sortKey };
  });
}`,
    fetch: `async (ctx) => parse(await fetchJson(ctx, SOURCE, schema))`,
  }),
  kb: () => ({
    imports: `import { kbSections } from "./_sources/html.ts";\nimport { lineOf, numericKey, typeOf } from "./_sources/version.ts";`,
    parse: `export function parse(html: string): ReleaseInfo[] {
  // TODO: Überschriften und Versionsmuster an den Artikel anpassen. Je Linie wird die höchste Version gemeldet.
  const texts = Object.values(kbSections(html, ["Applies To"])).flat();
  const best = new Map<string, number[]>();
  for (const t of texts) {
    for (const [v] of t.matchAll(/\\d+(?:\\.\\d+)+/g)) {
      const key = numericKey(v);
      const line = lineOf(v);
      const prev = best.get(line);
      if (!prev || key.join(".").localeCompare(prev.join("."), undefined, { numeric: true }) > 0) best.set(line, key);
    }
  }
  return [...best].map(([line, sortKey]) => ({ line, version: sortKey.join("."), type: typeOf(sortKey), notesUrl: SOURCE, sortKey }));
}`,
    fetch: `async (ctx) => parse(await ctx.http.getText(SOURCE))`,
  }),
};

export function render(o: Options): Record<string, string> {
  const b = BODIES[o.source](o);
  const today = new Date().toISOString().slice(0, 10);
  const ext = FIXTURE_EXT[o.source];
  const tracker = `import { defineTracker, type ReleaseInfo } from "../tracker.ts";
${b.imports}

/**
 * ${o.vendor} ${o.product} – Quelltyp ${o.source}.
 * Quelle: ${o.url} (recherchiert ${today}), Details in docs/quellen.md.
 */
const SOURCE = ${JSON.stringify(o.url)};

/** Reine Parse-Funktion, getestet gegen test/fixtures/${o.id}/source.${ext}. */
${b.parse}

export default defineTracker({
  id: ${JSON.stringify(o.id)}, // stabil, nie ändern
  vendor: ${JSON.stringify(o.vendor)},
  product: ${JSON.stringify(o.product)},
  sources: [${o.source === "github" ? `\`https://github.com/\${SOURCE}/releases\`` : "SOURCE"}],
  fetchReleases: ${b.fetch},
});
`;
  const read = ext === "json" ? `JSON.parse(readFileSync(FIXTURE, "utf8"))` : `readFileSync(FIXTURE, "utf8")`;
  const test = `import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../../src/server/trackers/${o.id}.ts";
import { validateReleases } from "../../src/server/tracker.ts";

const FIXTURE = join(import.meta.dirname, "../fixtures/${o.id}/source.${ext}");

test("${o.id}: findet die neueste Version jeder Linie (Fixture, offline)", () => {
  const list = validateReleases(parse(${read}));
  const newest = Object.fromEntries(
    Object.entries(Object.groupBy(list, (r) => r.line)).map(([line, rs]) => [line, rs!.sort((a, b) => b.sortKey.join(".").localeCompare(a.sortKey.join("."), undefined, { numeric: true }))[0].version]),
  );
  // TODO: erwartete neueste Version je Linie aus der gespeicherten Seite eintragen.
  assert.deepEqual(newest, {});
});
`;
  return {
    [`src/server/trackers/${o.id}.ts`]: tracker,
    [`test/trackers/${o.id}.test.ts`]: test,
    [`test/fixtures/${o.id}/source.${ext}`]: ext === "json" ? "[]\n" : "",
  };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { vendor: { type: "string" }, product: { type: "string" }, source: { type: "string" }, url: { type: "string" } },
  });
  const [id] = positionals;
  const usage = `Aufruf: npm run new-tracker -- <hersteller-produkt> --vendor "<Hersteller>" --product "<Produkt>" --source <${SOURCES.join("|")}> --url <Quelle>`;
  if (!id || !/^[a-z0-9]+(-[a-z0-9]+)+$/.test(id)) throw new Error(`ID fehlt oder ungültig (klein, mit Bindestrich, z. B. "siemens-nx").\n${usage}`);
  if (!values.vendor || !values.product || !values.url) throw new Error(usage);
  if (!SOURCES.includes(values.source as Source)) throw new Error(`--source muss einer von ${SOURCES.join(", ")} sein`);
  const root = join(import.meta.dirname, "..");
  const files = render({ id, vendor: values.vendor, product: values.product, source: values.source as Source, url: values.url });
  for (const f of Object.keys(files)) if (existsSync(join(root, f))) throw new Error(`${f} existiert bereits`);
  for (const [f, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), content, "utf8");
    console.log(`angelegt: ${f}`);
  }
  console.log("\nNächste Schritte: Quelle als Fixture speichern, Parser und Test anpassen, `npm test`, Quelle in docs/quellen.md dokumentieren.");
}
