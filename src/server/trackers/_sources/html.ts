import { load } from "cheerio";

export type TableRow = { cells: Record<string, string>; links: Record<string, string | undefined> };

/**
 * HTML-Tabelle → Zeilen mit Spaltennamen aus der Kopfzeile (thead oder erste Zeile).
 * `links` enthält je Spalte das href des ersten Links, absolut gemacht gegen `baseUrl`.
 */
export function parseHtmlTable(html: string, selector = "table", baseUrl?: string): TableRow[] {
  const $ = load(html);
  const table = $(selector).first();
  if (!table.length) throw new Error(`Tabelle "${selector}" nicht gefunden`);
  const rows = table.find("tr").toArray();
  const headerRow = table.find("thead tr").first().get(0) ?? rows[0];
  const headers = $(headerRow).children("th, td").map((_, c) => $(c).text().replace(/\s+/g, " ").trim()).get();
  return rows.filter((r) => r !== headerRow && $(r).children("td").length).map((r) => {
    const cells: Record<string, string> = {};
    const links: Record<string, string | undefined> = {};
    $(r).children("td, th").each((i, c) => {
      const key = headers[i] || `col${i}`;
      cells[key] = $(c).text().replace(/\s+/g, " ").trim();
      const href = $(c).find("a[href]").first().attr("href");
      links[key] = href && baseUrl ? new URL(href, baseUrl).href : href;
    });
    return { cells, links };
  });
}

/**
 * Knowledge-Base-Artikel: Texte der Listeneinträge bzw. Absätze unter den angegebenen Überschriften
 * (h1–h4, exakter Text ohne Leerraum). Typisch für Hersteller-KBs mit Abschnitten wie "Applies To".
 */
export function kbSections(html: string, headings: string[]): Record<string, string[]> {
  const $ = load(html);
  const out: Record<string, string[]> = {};
  for (const heading of headings) {
    const h = $("h1, h2, h3, h4").filter((_, el) => $(el).text().replace(/\s+/g, " ").trim() === heading).first();
    if (!h.length) continue;
    const scope = h.parent();
    const items = scope.find("li, p").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get().filter(Boolean);
    out[heading] = items.length ? items : [scope.text().replace(/\s+/g, " ").replace(heading, "").trim()];
  }
  return out;
}
