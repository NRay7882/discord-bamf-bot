// Unit tests for the Discord-free rendering logic. Run:
//   node --test modules/thread-directory/render.test.js
// (or `npm run test:unit`).

import { test } from "node:test";
import assert from "node:assert/strict";
import { groupAndSort, orderThreads, renderMessages, renderDirectory } from "./render.js";

function thread(over = {}) {
  return {
    id: "t" + Math.random().toString(36).slice(2, 8),
    name: "thread",
    parentChannelId: "chan1",
    parentChannelName: "general",
    categoryId: "catA",
    categoryName: "Alpha",
    lastActivity: 1000,
    createdAt: 1000,
    ...over,
  };
}

const catMeta = {
  catA: { name: "Alpha", position: 2 },
  catB: { name: "Beta", position: 0 },
  catC: { name: "Gamma", position: 1 },
};

test("groups threads by category then channel", () => {
  const grouped = groupAndSort(
    [
      thread({ categoryId: "catA", categoryName: "Alpha", parentChannelId: "c1", parentChannelName: "aa" }),
      thread({ categoryId: "catA", categoryName: "Alpha", parentChannelId: "c2", parentChannelName: "bb" }),
      thread({ categoryId: "catB", categoryName: "Beta", parentChannelId: "c3", parentChannelName: "cc" }),
    ],
    { categoryMeta: catMeta, sort: { categoryOrder: "alpha" } }
  );
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped.map((g) => g.categoryName), ["Alpha", "Beta"]);
  assert.equal(grouped[0].channels.length, 2);
  assert.deepEqual(grouped[0].channels.map((c) => c.channelName), ["aa", "bb"]);
});

test("custom category order wins, unknowns fall back alphabetically", () => {
  const grouped = groupAndSort(
    [
      thread({ categoryId: "catA", categoryName: "Alpha" }),
      thread({ categoryId: "catB", categoryName: "Beta" }),
      thread({ categoryId: "catC", categoryName: "Gamma" }),
    ],
    { categoryMeta: catMeta, sort: { categoryOrder: "custom", customCategoryOrder: ["catC", "catB"] } }
  );
  // catC, catB explicit; catA not listed -> after, alphabetical.
  assert.deepEqual(grouped.map((g) => g.categoryName), ["Gamma", "Beta", "Alpha"]);
});

test("position order uses Discord positions", () => {
  const grouped = groupAndSort(
    [
      thread({ categoryId: "catA", categoryName: "Alpha" }),
      thread({ categoryId: "catB", categoryName: "Beta" }),
      thread({ categoryId: "catC", categoryName: "Gamma" }),
    ],
    { categoryMeta: catMeta, sort: { categoryOrder: "position" } }
  );
  // positions: B=0, C=1, A=2
  assert.deepEqual(grouped.map((g) => g.categoryName), ["Beta", "Gamma", "Alpha"]);
});

test("uncategorized threads sink to the bottom", () => {
  const grouped = groupAndSort(
    [
      thread({ categoryId: null, categoryName: null, parentChannelName: "loose" }),
      thread({ categoryId: "catA", categoryName: "Alpha" }),
    ],
    { categoryMeta: catMeta, sort: { categoryOrder: "alpha" } }
  );
  assert.equal(grouped[grouped.length - 1].categoryName, "No category");
});

test("orderThreads honors activity, alpha, and created", () => {
  const a = thread({ name: "banana", lastActivity: 10, createdAt: 30 });
  const b = thread({ name: "apple", lastActivity: 20, createdAt: 10 });
  const c = thread({ name: "cherry", lastActivity: 15, createdAt: 20 });

  assert.deepEqual(orderThreads([a, b, c], "activity").map((t) => t.name), ["apple", "cherry", "banana"]);
  assert.deepEqual(orderThreads([a, b, c], "alpha").map((t) => t.name), ["apple", "banana", "cherry"]);
  assert.deepEqual(orderThreads([a, b, c], "created").map((t) => t.name), ["banana", "cherry", "apple"]);
});

test("renderMessages returns a single empty-state message when there is nothing", () => {
  const out = renderMessages([], { title: "Open threads", emptyText: "Nothing here." });
  assert.equal(out.length, 1);
  assert.match(out[0], /Nothing here\./);
  assert.match(out[0], /Open threads/);
});

test("renderDirectory emits clickable thread mentions", () => {
  const out = renderDirectory([thread({ id: "999", categoryName: "Alpha" })], {
    categoryMeta: catMeta,
    sort: { categoryOrder: "alpha" },
    title: "Open threads",
  });
  assert.match(out.join("\n"), /<#999>/);
});

test("renderMessages splits into multiple messages under the limit", () => {
  const threads = [];
  for (let i = 0; i < 40; i++) {
    threads.push(
      thread({
        id: String(1000 + i),
        categoryId: "catA",
        categoryName: "Alpha",
        parentChannelId: "c" + i,
        parentChannelName: "channel-" + i,
      })
    );
  }
  const grouped = groupAndSort(threads, { categoryMeta: catMeta, sort: { categoryOrder: "alpha" } });
  const limit = 300;
  const out = renderMessages(grouped, { title: "Open threads", limit });
  assert.ok(out.length > 1, "expected multiple messages");
  for (const msg of out) assert.ok(msg.length <= limit, `message too long: ${msg.length}`);
  // Every thread mention should appear somewhere.
  const joined = out.join("\n");
  for (let i = 0; i < 40; i++) assert.match(joined, new RegExp(`<#${1000 + i}>`));
});
