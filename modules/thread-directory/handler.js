// thread-directory - the in-process handler. Runs inside the core with direct
// discord.js access (see src/inprocess.js). Responsibilities:
//   - init(ctx): load per-guild config, subscribe to thread/channel events,
//     start a safety-net refresh loop, and do a startup rebuild.
//   - commands.thread-list: private, on-demand listing for any member.
//   - commands.threads: admin subcommands to set up and tune the maintained
//     directory channel.
//
// All Discord-free logic lives in render.js (unit-tested); Discord enumeration in
// threads.js; persistence in store.js.

import { Events, ChannelType, MessageFlags, PermissionFlagsBits } from "discord.js";
import { ConfigStore } from "./store.js";
import { collectThreads, categoryMetaFor } from "./threads.js";
import { renderDirectory } from "./render.js";

const DEBOUNCE_MS = 5000;
const DEFAULT_REFRESH_MS = 15 * 60 * 1000;
const DIRECTORY_TITLE = "Open threads";

// Shared state, initialised in init().
let store = null;
let clientRef = null;
let log = console;
const enabledGuilds = new Set();
const debouncers = new Map(); // guildId -> timeout
const rebuildLocks = new Map(); // guildId -> { running, dirty }

// ---- lifecycle --------------------------------------------------------------

export async function init(ctx) {
  clientRef = ctx.client;
  log = ctx.log ?? console;
  store = new ConfigStore(ctx.dataDir);

  const refreshMs = Number(process.env.THREAD_DIRECTORY_REFRESH_MS ?? DEFAULT_REFRESH_MS);

  // Seed the set of guilds we actively maintain.
  for (const guildId of await store.guildIds()) {
    const cfg = await store.get(guildId);
    if (cfg.enabled && cfg.channelId) enabledGuilds.add(guildId);
  }

  registerListeners(clientRef);

  // Startup rebuild so the channel is correct even if events were missed while
  // the bot was offline.
  for (const guildId of enabledGuilds) {
    rebuildGuild(guildId).catch((error) =>
      log.error("thread-directory startup rebuild failed", { guildId, error: error.message })
    );
  }

  // Safety net: catch archived-state drift and anything the event stream missed.
  const timer = setInterval(() => {
    for (const guildId of enabledGuilds) rebuildGuild(guildId).catch(() => {});
  }, refreshMs);
  timer.unref?.();

  log.info("thread-directory initialised", {
    maintainedGuilds: enabledGuilds.size,
    refreshMs,
  });
}

function registerListeners(client) {
  const bump = (guildId) => scheduleRebuild(guildId);
  client.on(Events.ThreadCreate, (thread) => bump(thread.guildId ?? thread.guild?.id));
  client.on(Events.ThreadUpdate, (_old, thread) => bump(thread.guildId ?? thread.guild?.id));
  client.on(Events.ThreadDelete, (thread) => bump(thread.guildId ?? thread.guild?.id));
  client.on(Events.ThreadListSync, (threads, guild) =>
    bump(guild?.id ?? threads?.first?.()?.guild?.id)
  );
  client.on(Events.ChannelUpdate, (_old, channel) => bump(channel.guildId));
  client.on(Events.ChannelDelete, (channel) => bump(channel.guildId));
}

function scheduleRebuild(guildId) {
  if (!guildId || !enabledGuilds.has(guildId)) return;
  clearTimeout(debouncers.get(guildId));
  const timer = setTimeout(() => {
    debouncers.delete(guildId);
    rebuildGuild(guildId).catch((error) =>
      log.error("thread-directory rebuild failed", { guildId, error: error.message })
    );
  }, DEBOUNCE_MS);
  timer.unref?.();
  debouncers.set(guildId, timer);
}

// ---- rebuild ----------------------------------------------------------------

/**
 * Rebuild a guild's maintained directory channel. Coalesces concurrent calls:
 * a rebuild requested while one is running re-runs once when it finishes.
 * @returns {Promise<{ ok: boolean, reason?: string, messages?: number }>}
 */
async function rebuildGuild(guildId) {
  const existing = rebuildLocks.get(guildId);
  if (existing?.running) {
    existing.dirty = true;
    return { ok: true, reason: "queued" };
  }
  const lock = { running: true, dirty: false };
  rebuildLocks.set(guildId, lock);
  let result;
  try {
    do {
      lock.dirty = false;
      result = await doRebuild(guildId);
    } while (lock.dirty);
  } finally {
    rebuildLocks.delete(guildId);
  }
  return result;
}

async function doRebuild(guildId) {
  const cfg = await store.get(guildId);
  if (!cfg.enabled || !cfg.channelId) return { ok: false, reason: "not-configured" };

  const guild = clientRef.guilds.cache.get(guildId);
  if (!guild) return { ok: false, reason: "guild-unavailable" };

  let channel;
  try {
    channel = await guild.channels.fetch(cfg.channelId);
  } catch {
    channel = null;
  }
  if (!channel || channel.type !== ChannelType.GuildText) {
    log.warn("thread-directory channel missing; disabling", { guildId, channelId: cfg.channelId });
    await store.update(guildId, { enabled: false });
    enabledGuilds.delete(guildId);
    return { ok: false, reason: "channel-missing" };
  }

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (me && !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
    log.warn("thread-directory lacks SendMessages in channel", { guildId, channelId: channel.id });
    return { ok: false, reason: "missing-permissions" };
  }

  const { records, categoryMeta } = await collectThreads(guild, {
    includeArchived: cfg.sort.includeArchived,
  });
  const contents = renderDirectory(records, {
    categoryMeta,
    sort: cfg.sort,
    title: DIRECTORY_TITLE,
    updatedAt: Date.now(),
    emptyText: "No open threads right now.",
  });

  const messageIds = await applyMessages(channel, cfg.managedMessageIds, contents);
  await store.update(guildId, { managedMessageIds: messageIds });
  return { ok: true, messages: messageIds.length };
}

/**
 * Reconcile the bot's managed messages in the channel with the desired contents.
 * Edits in place when the message count is unchanged (no re-ping, stable order);
 * otherwise clears the old managed messages and reposts.
 * @returns {Promise<string[]>} the resulting message IDs, in order
 */
async function applyMessages(channel, existingIds, contents) {
  const send = (content) => channel.send({ content, allowedMentions: { parse: [] } });

  if (existingIds.length === contents.length && existingIds.length > 0) {
    const ids = [];
    for (let i = 0; i < contents.length; i++) {
      try {
        const msg = await channel.messages.fetch(existingIds[i]);
        await msg.edit({ content: contents[i], allowedMentions: { parse: [] } });
        ids.push(msg.id);
      } catch {
        ids.push((await send(contents[i])).id);
      }
    }
    return ids;
  }

  // Structure changed - remove old managed messages, then repost fresh.
  for (const id of existingIds) {
    try {
      const msg = await channel.messages.fetch(id);
      await msg.delete();
    } catch {
      // already gone
    }
  }
  const ids = [];
  for (const content of contents) ids.push((await send(content)).id);
  return ids;
}

// ---- commands ---------------------------------------------------------------

async function threadList(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply("Run this in a server.");
    return;
  }

  const scope = interaction.options.getString("scope") ?? "all";
  const deliver = interaction.options.getString("deliver") ?? "here";
  const cfg = await store.get(guild.id);

  const { records, categoryMeta } = await collectThreads(guild, {
    includeArchived: cfg.sort.includeArchived,
  });

  let filtered = records;
  if (scope === "channel") {
    filtered = records.filter((r) => r.parentChannelId === interaction.channelId);
  } else if (scope === "category") {
    const here = guild.channels.cache.get(interaction.channelId);
    const categoryId = here?.parentId ?? null;
    filtered = records.filter((r) => r.categoryId === categoryId);
  }

  const contents = renderDirectory(filtered, {
    categoryMeta,
    sort: cfg.sort,
    title: DIRECTORY_TITLE,
    updatedAt: Date.now(),
    emptyText: "No open threads found for that scope.",
  });

  if (deliver === "dm") {
    try {
      const dm = await interaction.user.createDM();
      for (const content of contents) await dm.send({ content, allowedMentions: { parse: [] } });
      await interaction.editReply("Sent you a DM with the thread list.");
    } catch {
      await interaction.editReply(
        "I couldn't DM you - check whether DMs from server members are allowed, or run `/thread-list` without `deliver:dm`."
      );
    }
    return;
  }

  await interaction.editReply({ content: contents[0], allowedMentions: { parse: [] } });
  for (let i = 1; i < contents.length; i++) {
    await interaction.followUp({
      content: contents[i],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }
}

async function threadsAdmin(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Run this in a server.", flags: MessageFlags.Ephemeral });
    return;
  }
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case "setup":
      return setupCommand(interaction, guild);
    case "disable":
      return disableCommand(interaction, guild);
    case "refresh":
      return refreshCommand(interaction, guild);
    case "status":
      return statusCommand(interaction, guild);
    case "sort":
      return sortCommand(interaction, guild);
    case "order":
      return orderCommand(interaction, guild);
    default:
      return interaction.reply({ content: "Unknown subcommand.", flags: MessageFlags.Ephemeral });
  }
}

async function setupCommand(interaction, guild) {
  const channel = interaction.options.getChannel("channel");
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: "Pick a standard text channel for the directory.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  const perms = me ? channel.permissionsFor(me) : null;
  if (perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    await interaction.reply({
      content: `I need **View Channel** and **Send Messages** in <#${channel.id}>. Grant those and run setup again.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // A fresh channel starts with no managed messages.
  await store.update(guild.id, { channelId: channel.id, enabled: true, managedMessageIds: [] });
  enabledGuilds.add(guild.id);

  await interaction.reply({
    content: `Maintaining the thread directory in <#${channel.id}>. Building it now...`,
    flags: MessageFlags.Ephemeral,
  });

  const result = await rebuildGuild(guild.id);
  const detail = result.ok
    ? `Populated ${result.messages} message(s). New, renamed, or closed threads update automatically. Lock the channel so members can only read it.`
    : `Set up, but the first build reported: ${result.reason}. Check my permissions in the channel, then run \`/threads refresh\`.`;
  await interaction.editReply(`Thread directory set up in <#${channel.id}>. ${detail}`);
}

async function disableCommand(interaction, guild) {
  await store.update(guild.id, { enabled: false });
  enabledGuilds.delete(guild.id);
  await interaction.reply({
    content: "Stopped maintaining the thread directory. The existing messages are left in place; run `/threads setup` to resume.",
    flags: MessageFlags.Ephemeral,
  });
}

async function refreshCommand(interaction, guild) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const cfg = await store.get(guild.id);
  if (!cfg.enabled || !cfg.channelId) {
    await interaction.editReply("No directory is set up yet. Run `/threads setup channel:<#channel>` first.");
    return;
  }
  const result = await rebuildGuild(guild.id);
  await interaction.editReply(
    result.ok
      ? `Refreshed - ${result.messages} message(s) updated.`
      : `Couldn't refresh: ${result.reason}. Check my permissions in the directory channel.`
  );
}

async function statusCommand(interaction, guild) {
  const cfg = await store.get(guild.id);
  const meta = categoryMetaFor(guild);
  const orderNames =
    cfg.sort.customCategoryOrder.length > 0
      ? cfg.sort.customCategoryOrder.map((id) => meta[id]?.name ?? `(unknown: ${id})`).join(" -> ")
      : "(none set)";

  const lines = [
    "**Thread directory status**",
    `Channel: ${cfg.channelId ? `<#${cfg.channelId}>` : "(not set)"}`,
    `Active: ${cfg.enabled ? "yes" : "no"}`,
    `Category order: ${cfg.sort.categoryOrder}`,
    `Custom order: ${orderNames}`,
    `Thread order: ${cfg.sort.threadOrder}`,
    `Include archived: ${cfg.sort.includeArchived ? "yes" : "no"}`,
    `Managed messages: ${cfg.managedMessageIds.length}`,
    `Last updated: ${cfg.updatedAt ? `<t:${Math.floor(cfg.updatedAt / 1000)}:R>` : "never"}`,
  ];
  await interaction.reply({
    content: lines.join("\n"),
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

async function sortCommand(interaction, guild) {
  const categoryOrder = interaction.options.getString("categories");
  const threadOrder = interaction.options.getString("threads");
  if (!categoryOrder && !threadOrder) {
    await interaction.reply({
      content: "Nothing to change - pass `categories` and/or `threads`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const sort = {};
  if (categoryOrder) sort.categoryOrder = categoryOrder;
  if (threadOrder) sort.threadOrder = threadOrder;
  const cfg = await store.update(guild.id, { sort });

  await interaction.reply({
    content: `Sorting updated - categories: **${cfg.sort.categoryOrder}**, threads: **${cfg.sort.threadOrder}**.${
      cfg.sort.categoryOrder === "custom" && cfg.sort.customCategoryOrder.length === 0
        ? " Set the custom order with `/threads order`."
        : ""
    }`,
    flags: MessageFlags.Ephemeral,
  });
  if (cfg.enabled) await rebuildGuild(guild.id);
}

async function orderCommand(interaction, guild) {
  const raw = interaction.options.getString("categories") ?? "";
  const { ids, unknown } = resolveCategoryOrder(guild, raw);
  if (ids.length === 0) {
    await interaction.reply({
      content: `No categories matched. Provide a comma-separated list of category names, e.g. \`Politics, Fun & Games, Health & Exercise\`.${
        unknown.length ? ` Unmatched: ${unknown.join(", ")}.` : ""
      }`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const cfg = await store.update(guild.id, {
    sort: { categoryOrder: "custom", customCategoryOrder: ids },
  });
  const names = ids.map((id) => categoryMetaFor(guild)[id]?.name ?? id).join(" -> ");
  await interaction.reply({
    content: `Custom category order set: ${names}.${
      unknown.length ? ` (Ignored unmatched: ${unknown.join(", ")}.)` : ""
    }`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
  if (cfg.enabled) await rebuildGuild(guild.id);
}

/** Resolve a comma-separated list of category names to category IDs, in order. */
function resolveCategoryOrder(guild, raw) {
  const meta = categoryMetaFor(guild);
  const byName = new Map(
    Object.entries(meta).map(([id, m]) => [m.name.trim().toLowerCase(), id])
  );
  const ids = [];
  const unknown = [];
  const seen = new Set();
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (!name) continue;
    const id = byName.get(name.toLowerCase());
    if (id && !seen.has(id)) {
      ids.push(id);
      seen.add(id);
    } else if (!id) {
      unknown.push(name);
    }
  }
  return { ids, unknown };
}

export const commands = {
  "thread-list": threadList,
  threads: threadsAdmin,
};
