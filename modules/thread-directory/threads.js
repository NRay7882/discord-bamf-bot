// Discord thread enumeration. Turns a live guild into the plain thread records
// that render.js consumes. This is the only file here that touches discord.js.
//
// Stale entries fix themselves for free: we enumerate what Discord reports right
// now, so a thread (or its channel/category) that no longer exists simply is not
// in the result - no more "#unknown" rows to prune by hand.

import { ChannelType, SnowflakeUtil } from "discord.js";

// Forum and media channels hold "posts" that are threads; treat both as forums
// for the exclude-forums filter.
const MEDIA_CHANNEL = ChannelType.GuildMedia ?? 16;
function isForumParent(channel) {
  return !!channel && (channel.type === ChannelType.GuildForum || channel.type === MEDIA_CHANNEL);
}

/** Best-effort "last activity" for a thread: its last message, else creation. */
function lastActivityOf(thread) {
  if (thread.lastMessageId) {
    try {
      return Number(SnowflakeUtil.timestampFrom(thread.lastMessageId));
    } catch {
      // fall through
    }
  }
  return thread.createdTimestamp ?? 0;
}

function recordFor(thread, guild) {
  const parent = thread.parent ?? guild.channels.cache.get(thread.parentId) ?? null;
  const category =
    parent?.parent ?? (parent?.parentId ? guild.channels.cache.get(parent.parentId) : null);
  return {
    id: thread.id,
    name: thread.name,
    parentChannelId: thread.parentId,
    parentChannelName: parent?.name ?? "unknown-channel",
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
    lastActivity: lastActivityOf(thread),
    createdAt: thread.createdTimestamp ?? 0,
    isForum: isForumParent(parent),
    archived: Boolean(thread.archived),
  };
}

/**
 * Apply the include/exclude filters to a set of records. Pure (records already
 * carry `isForum` and `archived`), so it is unit-testable without a client.
 */
export function filterRecords(records, filters = {}) {
  const { includeArchived = false, includeForums = false, excludedChannelIds = [] } = filters;
  const excluded = new Set(excludedChannelIds);
  return records.filter((r) => {
    if (!includeForums && r.isForum) return false;
    if (excluded.has(r.parentChannelId)) return false;
    if (!includeArchived && r.archived) return false;
    return true;
  });
}

/** Map of category id -> { name, position } for every category in the guild. */
export function categoryMetaFor(guild) {
  const meta = {};
  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildCategory) {
      meta[channel.id] = { name: channel.name, position: channel.rawPosition };
    }
  }
  return meta;
}

/**
 * Collect thread records for a guild, honoring the include/exclude filters.
 * @param {import("discord.js").Guild} guild
 * @param {{ includeArchived?: boolean, includeForums?: boolean, excludedChannelIds?: string[] }} filters
 * @returns {Promise<{ records: object[], categoryMeta: Record<string, object> }>}
 */
export async function collectThreads(guild, filters = {}) {
  const { includeArchived = false, includeForums = false, excludedChannelIds = [] } = filters;
  const excluded = new Set(excludedChannelIds);
  const byId = new Map();

  const active = await guild.channels.fetchActiveThreads();
  for (const thread of active.threads.values()) {
    byId.set(thread.id, recordFor(thread, guild));
  }

  if (includeArchived) {
    // Archived public threads must be fetched per parent channel. This is more
    // rate-limit intensive, so it is opt-in - and we skip channels we would only
    // filter back out (excluded ones, and forums unless forums are included).
    const parents = guild.channels.cache.filter((c) => {
      if (excluded.has(c.id)) return false;
      if (c.type === ChannelType.GuildText) return true;
      if (isForumParent(c)) return includeForums;
      return false;
    });
    for (const channel of parents.values()) {
      try {
        const archived = await channel.threads.fetchArchived({ type: "public", limit: 100 });
        for (const thread of archived.threads.values()) {
          if (!byId.has(thread.id)) byId.set(thread.id, recordFor(thread, guild));
        }
      } catch {
        // Missing access or none present; skip this channel.
      }
    }
  }

  const records = filterRecords([...byId.values()], { includeArchived, includeForums, excludedChannelIds });
  return { records, categoryMeta: categoryMetaFor(guild) };
}
