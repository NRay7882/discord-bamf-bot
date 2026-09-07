import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseResults } from "./parse.js";

const dir = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(dir, "fixtures", name), "utf8");

test("parses summary, videos, ids, dates, and matches", () => {
  const r = parseResults(fixture("motor-running.html"));
  assert.equal(r.query, "motor running");
  assert.equal(r.totalMatches, 10);
  assert.equal(r.totalVideos, 4);
  assert.equal(r.videos.length, 4);

  const first = r.videos[0];
  assert.equal(first.id, "5dGOyUBqUqY");
  assert.equal(first.title, "Wow, this show sucks!");
  assert.equal(first.date, "2026-09-04");
  assert.equal(first.matches.length, 2);
  assert.equal(first.matches[0].seconds, 618);
  assert.equal(first.matches[0].label, "10:18");
  assert.match(first.matches[0].snippet, /motor running/);
  assert.doesNotMatch(first.matches[0].snippet, /<mark>|…/); // tags + ellipses stripped
});

test("decodes HTML entities in titles", () => {
  const r = parseResults(fixture("motor-running.html"));
  const charlotte = r.videos.find((v) => v.id === "ttqO7kcFsGI");
  assert.equal(charlotte.title, "Charlotte's only good impression");
});

test("captures the fuzzy (motorcycle/runway) video with no exact phrase", () => {
  const r = parseResults(fixture("motor-running.html"));
  const fuzzy = r.videos.find((v) => v.id === "v2-OauzBS2c");
  assert.ok(fuzzy);
  assert.equal(fuzzy.matches.length, 1);
  assert.doesNotMatch(fuzzy.matches[0].snippet, /motor running/);
});

test("empty results yield no videos", () => {
  const r = parseResults(fixture("no-results.html"));
  assert.equal(r.videos.length, 0);
  assert.equal(r.totalMatches, 0);
  assert.equal(r.query, "zzxqvljkwq");
});
