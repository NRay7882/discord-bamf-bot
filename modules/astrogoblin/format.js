// Turn parsed results into a Discord message payload. Classifies each match as
// exact (the caption contains the full query phrase) vs fuzzy (the site matched
// loose tokens, e.g. "motorcycle"/"runway" for "motor running"), then ranks
// videos with exact matches first (by exact count), fuzzy-only videos after (by
// total count), newest as the tiebreak. Discord-free and unit-tested.

const SITE = "https://search.astrogoblin.jammaloo.com/";
const MAX_VIDEOS = 8;
const MAX_SNIPPET = 180;
const EMBED_COLOR = 0x8b5cf6;

/** The jammaloo search URL for a query (spaces as "+", like the site itself). */
export function searchUrl(query) {
  return SITE + "?q=" + encodeURIComponent(query).replace(/%20/g, "+");
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Match the whole query phrase, words in order, at word boundaries.
function phraseRegex(query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean).map(escapeRe);
  if (words.length === 0) return null;
  return new RegExp(`\\b${words.join("\\s+")}\\b`, "i");
}

function classify(video, phrase) {
  let exact = 0;
  let firstExactSeconds = null;
  let firstExactSnippet = null;
  for (const m of video.matches) {
    if (phrase && phrase.test(m.snippet)) {
      exact++;
      if (firstExactSeconds === null) firstExactSeconds = m.seconds;
      if (firstExactSnippet === null) firstExactSnippet = m.snippet;
    }
  }
  const first = video.matches[0] ?? null;
  return {
    ...video,
    total: video.matches.length,
    exact,
    linkSeconds: firstExactSeconds ?? first?.seconds ?? null,
    snippet: firstExactSnippet ?? first?.snippet ?? "",
  };
}

function rank(a, b) {
  const aHas = a.exact > 0 ? 1 : 0;
  const bHas = b.exact > 0 ? 1 : 0;
  if (aHas !== bHas) return bHas - aHas; // videos with exact matches first
  if (aHas && b.exact !== a.exact) return b.exact - a.exact; // by exact count
  if (b.total !== a.total) return b.total - a.total; // then by total matches
  return String(b.date ?? "").localeCompare(String(a.date ?? "")); // newest first
}

function youtubeLink(id, seconds) {
  const base = `https://www.youtube.com/watch?v=${id}`;
  return seconds != null ? `${base}&t=${seconds}s` : base;
}

function clip(s, n = 256) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function escapeMd(s) {
  return String(s ?? "").replace(/([\\`*_~|>[\]])/g, "\\$1");
}

/**
 * Build the /invoke response payload for a parsed results set.
 * @param {ReturnType<import("./parse.js").parseResults>} results
 */
export function buildResponse(results) {
  const query = results.query ?? "";
  const url = searchUrl(query);

  if (!results.videos.length) {
    return {
      content: `No Astrogoblin videos found for **${clip(query, 100)}**. [Try it on the search site ↗](${url})`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    };
  }

  const phrase = phraseRegex(query);
  const ranked = results.videos.map((v) => classify(v, phrase)).sort(rank);
  const shown = ranked.slice(0, MAX_VIDEOS);

  const lines = shown.map((v, i) => {
    const loose = v.exact === 0 ? " · loose match" : "";
    const plural = v.total === 1 ? "" : "es";
    const counts = `${v.total} match${plural}${v.exact ? ` (${v.exact} exact)` : ""}`;
    const title = v.id
      ? `[${escapeMd(v.title)}](${youtubeLink(v.id, v.linkSeconds)})`
      : escapeMd(v.title);
    const header = `**${i + 1}.** ${title} — \`${v.date ?? "?"}\`${loose} — ${counts}`;
    const snip = v.snippet ? `\n> ${escapeMd(clip(v.snippet, MAX_SNIPPET))}` : "";
    return header + snip;
  });

  const totalPlural = results.totalMatches === 1 ? "" : "es";
  const vidPlural = results.totalVideos === 1 ? "" : "s";
  let description =
    `**${results.totalMatches}** match${totalPlural} in **${results.totalVideos}** video${vidPlural} · ` +
    `[full results ↗](${url})\n\n` +
    lines.join("\n");

  if (ranked.length > shown.length) {
    description += `\n\n…and ${ranked.length - shown.length} more — [see all ↗](${url})`;
  }

  return {
    embeds: [
      {
        title: clip(`🔎 Astrogoblin search: "${query}"`, 256),
        url,
        description: clip(description, 4000),
        color: EMBED_COLOR,
        footer: { text: "search.astrogoblin.jammaloo.com" },
      },
    ],
    ephemeral: true,
    allowedMentions: { parse: [] },
  };
}
