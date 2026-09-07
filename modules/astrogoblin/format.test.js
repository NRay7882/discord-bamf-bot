import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseResults } from "./parse.js";
import { buildResponse, searchUrl } from "./format.js";

const dir = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(dir, "fixtures", name), "utf8");

test("searchUrl uses + for spaces, like the site", () => {
  assert.equal(searchUrl("motor running"), "https://search.astrogoblin.jammaloo.com/?q=motor+running");
});

test("builds an embed, exact videos ranked above the loose one", () => {
  const out = buildResponse(parseResults(fixture("motor-running.html")));
  assert.ok(out.embeds && out.embeds.length === 1);
  const embed = out.embeds[0];
  assert.equal(embed.url, "https://search.astrogoblin.jammaloo.com/?q=motor+running");

  const d = embed.description;
  // First result is an exact-match video.
  assert.match(d, /\*\*1\.\*\*[^\n]*\(\d+ exact\)/);
  // The motorcycle/runway video ranks last and is flagged as a loose match.
  assert.match(d, /\*\*4\.\*\* \[The end of this video is a disaster\][^\n]*loose match/);
  // Titles deep-link to the matched moment.
  assert.match(d, /youtube\.com\/watch\?v=[\w-]+&t=\d+s/);
});

test("classifies exact vs fuzzy from snippet text and orders accordingly", () => {
  const results = {
    query: "motor running",
    totalMatches: 3,
    totalVideos: 2,
    videos: [
      {
        id: "A",
        title: "Loose",
        url: "",
        date: "2020-01-01",
        matches: [{ seconds: 10, label: "0:10", snippet: "riding a motorcycle down the runway" }],
      },
      {
        id: "B",
        title: "Exact",
        url: "",
        date: "2019-01-01",
        matches: [
          { seconds: 5, label: "0:05", snippet: "get your motor running now" },
          { seconds: 9, label: "0:09", snippet: "motor running again" },
        ],
      },
    ],
  };
  const d = buildResponse(results).embeds[0].description;
  assert.ok(d.indexOf("Exact") < d.indexOf("Loose")); // exact video first
  assert.match(d, /\(2 exact\)/);
  assert.match(d, /Loose[^\n]*loose match/);
});

test("empty results return a friendly message with the search link", () => {
  const out = buildResponse(parseResults(fixture("no-results.html")));
  assert.ok(!out.embeds);
  assert.match(out.content, /No Astrogoblin videos found/);
  assert.match(out.content, /q=zzxqvljkwq/);
});
