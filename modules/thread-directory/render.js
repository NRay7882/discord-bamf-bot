// Pure rendering for the thread directory: grouping, sorting, and turning thread
// records into Discord message text. No discord.js, no I/O - so it is fully
// unit-testable (see render.test.js). The handler feeds it plain records and
// sends whatever strings come back.

// Discord's hard message limit is 2000 chars; stay under it with headroom.
export const MESSAGE_LIMIT = 1900;

const NO_CATEGORY_ID = "__none__";
const NO_CATEGORY_NAME = "No category";

/**
 * Group thread records by category, then by channel, and order everything
 * according to the sort config.
 *
 * @param {Array<{
 *   id: string, name: string,
 *   parentChannelId: string, parentChannelName: string,
 *   categoryId: string|null, categoryName: string|null,
 *   lastActivity: number, createdAt: number
 * }>} threads
 * @param {{
 *   categoryMeta?: Record<string, { name: string, position: number }>,
 *   sort?: { categoryOrder?: string, customCategoryOrder?: string[], threadOrder?: string }
 * }} opts
 * @returns {Array<{ categoryId: string, categoryName: string, channels: Array<{
 *   channelId: string, channelName: string, threads: object[] }> }>}
 */
export function groupAndSort(threads, { categoryMeta = {}, sort = {} } = {}) {
  const categoryOrder = sort.categoryOrder ?? "position";
  const customOrder = sort.customCategoryOrder ?? [];
  const threadOrder = sort.threadOrder ?? "activity";

  // Bucket by category -> channel.
  const categories = new Map(); // catId -> { categoryId, categoryName, channels: Map }
  for (const t of threads) {
    const catId = t.categoryId ?? NO_CATEGORY_ID;
    const catName = t.categoryId ? t.categoryName ?? "Unknown category" : NO_CATEGORY_NAME;
    if (!categories.has(catId)) {
      categories.set(catId, { categoryId: catId, categoryName: catName, channels: new Map() });
    }
    const cat = categories.get(catId);
    if (!cat.channels.has(t.parentChannelId)) {
      cat.channels.set(t.parentChannelId, {
        channelId: t.parentChannelId,
        channelName: t.parentChannelName,
        threads: [],
      });
    }
    cat.channels.get(t.parentChannelId).threads.push(t);
  }

  const customIndex = new Map(customOrder.map((id, i) => [id, i]));

  const orderedCategories = [...categories.values()].sort((a, b) => {
    // The "No category" bucket always sinks to the bottom.
    const aNone = a.categoryId === NO_CATEGORY_ID;
    const bNone = b.categoryId === NO_CATEGORY_ID;
    if (aNone !== bNone) return aNone ? 1 : -1;

    if (categoryOrder === "custom") {
      const ai = customIndex.has(a.categoryId) ? customIndex.get(a.categoryId) : Infinity;
      const bi = customIndex.has(b.categoryId) ? customIndex.get(b.categoryId) : Infinity;
      if (ai !== bi) return ai - bi;
      // Anything not in the custom list falls back to alphabetical.
      return a.categoryName.localeCompare(b.categoryName);
    }
    if (categoryOrder === "alpha") {
      return a.categoryName.localeCompare(b.categoryName);
    }
    // "position": Discord's own category ordering, then name as a tiebreaker.
    const ap = categoryMeta[a.categoryId]?.position ?? Number.MAX_SAFE_INTEGER;
    const bp = categoryMeta[b.categoryId]?.position ?? Number.MAX_SAFE_INTEGER;
    if (ap !== bp) return ap - bp;
    return a.categoryName.localeCompare(b.categoryName);
  });

  return orderedCategories.map((cat) => ({
    categoryId: cat.categoryId,
    categoryName: cat.categoryName,
    channels: [...cat.channels.values()]
      .sort((a, b) => a.channelName.localeCompare(b.channelName))
      .map((ch) => ({
        ...ch,
        threads: orderThreads(ch.threads, threadOrder),
      })),
  }));
}

/** Order threads within a channel. Non-mutating. */
export function orderThreads(threads, threadOrder = "activity") {
  const copy = [...threads];
  if (threadOrder === "alpha") {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else if (threadOrder === "created") {
    copy.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)); // newest first
  } else {
    copy.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0)); // most recent first
  }
  return copy;
}

/**
 * Render grouped categories into one or more Discord message strings, each under
 * MESSAGE_LIMIT. A category's header is never orphaned from its first channel.
 *
 * @returns {string[]} message contents (at least one)
 */
export function renderMessages(grouped, { title, updatedAt, emptyText, limit = MESSAGE_LIMIT } = {}) {
  const header = [];
  if (title) header.push(`## ${title}`);
  if (updatedAt) header.push(`_Updated <t:${Math.floor(updatedAt / 1000)}:R>_`);
  const headerText = header.join("\n");

  if (grouped.length === 0) {
    const body = emptyText ?? "No open threads found.";
    return [headerText ? `${headerText}\n\n${body}` : body];
  }

  // Build per-category blocks of lines; keep each category together when it fits.
  const blocks = grouped.map((cat) => {
    const lines = [`**${cat.categoryName}**`];
    for (const ch of cat.channels) {
      lines.push(` #${ch.channelName}`);
      for (const t of ch.threads) lines.push(`  - <#${t.id}>`);
    }
    return lines;
  });

  const messages = [];
  let current = headerText ? [headerText, ""] : [];
  let currentLen = current.join("\n").length;

  const flush = () => {
    if (current.length > 0) {
      messages.push(current.join("\n").trimEnd());
      current = [];
      currentLen = 0;
    }
  };

  for (const block of blocks) {
    const blockText = block.join("\n");
    const sep = current.length > 0 ? 2 : 0; // blank line before a block
    if (currentLen + sep + blockText.length <= limit) {
      if (current.length > 0) {
        current.push("");
        currentLen += 1;
      }
      current.push(...block);
      currentLen += blockText.length + (current.length > block.length ? 1 : 0);
    } else if (blockText.length <= limit) {
      // Whole block fits on its own message, but not appended to this one.
      flush();
      current = [...block];
      currentLen = blockText.length;
    } else {
      // A single category is larger than one message: split it line by line,
      // repeating the category header with a "(cont.)" marker.
      flush();
      const catHeader = block[0];
      current = [catHeader];
      currentLen = catHeader.length;
      for (let i = 1; i < block.length; i++) {
        const line = block[i];
        if (currentLen + 1 + line.length > limit) {
          flush();
          current = [`${catHeader} (cont.)`, line];
          currentLen = current.join("\n").length;
        } else {
          current.push(line);
          currentLen += 1 + line.length;
        }
      }
    }
  }
  flush();

  return messages.length > 0 ? messages : [headerText || (emptyText ?? "No open threads found.")];
}

/** Convenience: group + sort + render in one call. */
export function renderDirectory(threads, opts = {}) {
  const grouped = groupAndSort(threads, opts);
  return renderMessages(grouped, opts);
}
