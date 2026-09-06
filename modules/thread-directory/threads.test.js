// Unit tests for the pure filtering logic. Run:
//   node --test modules/thread-directory/threads.test.js
// (or `npm run test:unit`).

import { test } from "node:test";
import assert from "node:assert/strict";
import { filterRecords } from "./threads.js";

function rec(over = {}) {
  return { id: "1", parentChannelId: "c1", isForum: false, archived: false, ...over };
}

test("hides forum-channel threads unless forums are included", () => {
  const recs = [rec({ id: "a", isForum: true }), rec({ id: "b", isForum: false })];
  assert.deepEqual(filterRecords(recs, {}).map((r) => r.id), ["b"]);
  assert.deepEqual(
    filterRecords(recs, { includeForums: true }).map((r) => r.id).sort(),
    ["a", "b"]
  );
});

test("hides archived threads unless archived are included", () => {
  const recs = [rec({ id: "a", archived: true }), rec({ id: "b" })];
  assert.deepEqual(filterRecords(recs, {}).map((r) => r.id), ["b"]);
  assert.deepEqual(
    filterRecords(recs, { includeArchived: true }).map((r) => r.id).sort(),
    ["a", "b"]
  );
});

test("excludes threads whose parent channel is on the exclude list", () => {
  const recs = [rec({ id: "a", parentChannelId: "x" }), rec({ id: "b", parentChannelId: "y" })];
  assert.deepEqual(filterRecords(recs, { excludedChannelIds: ["x"] }).map((r) => r.id), ["b"]);
});

test("filters compose", () => {
  const recs = [
    rec({ id: "keep", parentChannelId: "ok" }),
    rec({ id: "forum", isForum: true, parentChannelId: "ok" }),
    rec({ id: "old", archived: true, parentChannelId: "ok" }),
    rec({ id: "hidden", parentChannelId: "no" }),
  ];
  assert.deepEqual(filterRecords(recs, { excludedChannelIds: ["no"] }).map((r) => r.id), ["keep"]);
});
