import { z } from "zod";
import type { TrackerContext } from "../../tracker.ts";

const releaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable(),
  html_url: z.string().url(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
});
export type GithubRelease = z.infer<typeof releaseSchema>;

/**
 * Veröffentlichte Releases eines GitHub-Repos ("owner/name"), ohne Entwürfe und Vorabversionen.
 * Paginiert (100 je Seite) bis `maxPages`. Ohne Token gilt das GitHub-Limit von 60 Anfragen/Stunde je IP.
 */
export async function githubReleases(ctx: TrackerContext, repo: string, maxPages = 3): Promise<GithubRelease[]> {
  const out: GithubRelease[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const raw = await ctx.http.getJson(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, {
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    });
    const list = z.array(releaseSchema).parse(raw);
    out.push(...list.filter((r) => !r.draft && !r.prerelease));
    if (list.length < 100) break;
  }
  return out;
}
