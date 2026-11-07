import { load } from "cheerio";

export type FeedItem = { title: string; link: string | undefined; date: string | undefined; summary: string };

/** RSS 2.0 und Atom: liefert die Einträge eines Feeds. Wirft, wenn das Dokument kein Feed ist. */
export function parseFeed(xml: string): FeedItem[] {
  const $ = load(xml, { xml: true });
  const rss = $("rss > channel > item, rdf\\:RDF > item");
  const atom = $("feed > entry");
  if (!rss.length && !atom.length && !$("rss, feed").length) throw new Error("Kein RSS/Atom-Feed");
  const items: FeedItem[] = [];
  rss.each((_, el) => {
    const e = $(el);
    items.push({ title: e.children("title").text().trim(), link: e.children("link").text().trim() || undefined, date: e.children("pubDate").text().trim() || e.children("dc\\:date").text().trim() || undefined, summary: e.children("description").text().trim() });
  });
  atom.each((_, el) => {
    const e = $(el);
    const link = e.children("link[rel='alternate']").attr("href") ?? e.children("link").first().attr("href");
    items.push({ title: e.children("title").text().trim(), link, date: e.children("updated").text().trim() || e.children("published").text().trim() || undefined, summary: e.children("summary, content").first().text().trim() });
  });
  return items;
}
