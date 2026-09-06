// Discord thread enumeration. Turns a live guild into the plain thread records
// that render.js consumes. This is the only file here that touches discord.js.
//
// Stale entries fix themselves for free: we enumerate what Discord reports right
// now, so a thread (or its channel/category) that no longer exists simply is not
// in the result - no more "#unknown" rows to prune by hand.

import { ChannelType, SnowflakeUtil } from "discord.js";

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
  };
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
 * Collect thread records for a guild.
 * @param {import("discord.js").Guild} guild
 * @param {{ includeArchived?: boolean }} opts
 * @returns {Promise<{ records: object[], categoryMeta: Record<string, object> }>}
 */
export async function collectThreads(guild, { includeArchived = false } = {}) {
  const byId = new Map();

  const active = await guild.channels.fetchActiveThreads();
  for (const thread of active.threads.values()) {
    byId.set(thread.id, recordFor(thread, guild));
  }

  if (includeArchived) {
    // Archived public threads must be fetched per parent channel. This is more
    // rate-limit intensive, so it is opt-in.
    const parents = guild.channels.cache.filter(
      (c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildForum
    );
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

  return { records: [...byId.values()], categoryMeta: categoryMetaFor(guild) };
}
