// Turn one jammaloo search-results page (HTML) into structured data. The page is
// server-rendered with a stable, simple structure (see fixtures/), so we extract
// with focused patterns rather than pulling in an HTML-parser dependency. This is
// Discord-free and unit-tested against saved fixtures; if the site's markup ever
// changes, those tests are what catch it.

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#039;": "'",
  "&#39;": "'",
};

function decodeEntities(s) {
  return s.replace(/&(?:amp|lt|gt|quot|#0?39);/g, (m) => ENTITIES[m] ?? m);
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, "");
}

/** Plain, whitespace-collapsed text from an HTML fragment. */
function textOf(html) {
  return decodeEntities(stripTags(html)).replace(/\s+/g, " ").trim();
}

// Caption snippets are shown wrapped in ellipses with <mark> around the matched
// words; keep just the words.
function cleanSnippet(html) {
  return textOf(html)
    .replace(/^[….\s]+/, "")
    .replace(/[….\s]+$/, "")
    .trim();
}

// "10 match(es) in 4 video(s) for “motor running”", or the empty-state line.
function extractSummary(html) {
  const rs = html.match(/<div class="result-summary">([\s\S]*?)<\/div>/);
  if (rs) {
    const text = textOf(rs[1]);
    const counts = text.match(/(\d+)\s+match\(es\)\s+in\s+(\d+)\s+video/);
    const q = text.match(/for [“"]([^”"]*)[”"]/);
    return {
      matches: counts ? Number(counts[1]) : 0,
      videos: counts ? Number(counts[2]) : 0,
      query: q ? q[1] : null,
    };
  }
  const empty = html.match(/<div class="empty">([\s\S]*?)<\/div>/);
  if (empty) {
    const q = textOf(empty[1]).match(/for [“"]([^”"]*)[”"]/);
    return { matches: 0, videos: 0, query: q ? q[1] : null };
  }
  return { matches: 0, videos: 0, query: null };
}

function parseVideo(block) {
  const titleM = block.match(/<span class="title"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  if (!titleM) return null;
  const url = decodeEntities(titleM[1]);
  const idM = url.match(/[?&]v=([^&]+)/);
  const title = textOf(titleM[2]);

  const infoM = block.match(/<span class="info">([\s\S]*?)<\/span>/);
  const info = infoM ? textOf(infoM[1]) : "";
  const dateM = info.match(/\d{4}-\d{2}-\d{2}/);

  const matches = [];
  const matchRe = /<div class="match">([\s\S]*?)<\/div>/g;
  let mm;
  while ((mm = matchRe.exec(block))) {
    const mb = mm[1];
    // The href's & is HTML-encoded (&amp;t=618s), so allow the encoded form.
    const secM = mb.match(/[?&](?:amp;)?t=(\d+)s/);
    const labelM = mb.match(/<span class="ts">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const snipM = mb.match(/<span class="snip">([\s\S]*?)<\/span>/);
    matches.push({
      seconds: secM ? Number(secM[1]) : null,
      label: labelM ? textOf(labelM[1]) : null,
      snippet: snipM ? cleanSnippet(snipM[1]) : "",
    });
  }

  return {
    id: idM ? idM[1] : null,
    title,
    url,
    date: dateM ? dateM[0] : null,
    matches,
  };
}

/**
 * Parse a jammaloo results page.
 * @returns {{ query: string|null, totalMatches: number, totalVideos: number,
 *   videos: Array<{ id: string|null, title: string, url: string, date: string|null,
 *     matches: Array<{ seconds: number|null, label: string|null, snippet: string }> }> }}
 */
export function parseResults(html) {
  const summary = extractSummary(html);
  const videos = [];
  const articleRe = /<article class="video">([\s\S]*?)<\/article>/g;
  let m;
  while ((m = articleRe.exec(html))) {
    const video = parseVideo(m[1]);
    if (video) videos.push(video);
  }
  return {
    query: summary.query,
    totalMatches: summary.matches,
    totalVideos: summary.videos,
    videos,
  };
}
