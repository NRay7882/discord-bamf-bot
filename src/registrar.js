// Per-guild command registration for restricted (server-specific) modules.
//
// Universal modules live in the global `/bamf` command (deployed once). Restricted
// modules must appear ONLY in the servers an operator allows, and Discord scopes
// a whole command - not individual subcommands - so we register a guild-scoped
// `/bamf` (universal + that guild's restricted modules) in each allowed guild.
// A guild-scoped command shadows the global one there, so members in an allowed
// server see the extra subcommands and members elsewhere never do.
//
// The core owns this at runtime because matching a guild by NAME (and reacting to
// joins and renames) needs the live guild, which a one-shot CLI deploy can't see.
// We persist the set of guilds we've given an overlay so a later run can clear a
// stale overlay (letting that guild fall back to the global command).

import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isModuleAllowedInGuild } from "./registry.js";
import { buildBamfCommand } from "./commands.js";
import { log } from "./logger.js";

const SUBDIR = "registrar";
const OVERLAY_FILE = "overlays.json";

function guildCtx(guild) {
  return { guildId: guild.id, guildName: guild.name };
}

/** The manifest command objects available in a guild (universal + allowed restricted). */
function commandsForGuild(commandMap, guild) {
  const ctx = guildCtx(guild);
  const commands = [];
  for (const { module, command } of commandMap.values()) {
    if (isModuleAllowedInGuild(module, ctx)) commands.push(command);
  }
  return commands;
}

/** Does this guild have at least one restricted module allowed (i.e. need an overlay)? */
function needsOverlay(commandMap, guild) {
  const ctx = guildCtx(guild);
  for (const { module } of commandMap.values()) {
    if (module.__restricted && isModuleAllowedInGuild(module, ctx)) return true;
  }
  return false;
}

// ---- overlay-set persistence ------------------------------------------------

function overlayPath(dataDir) {
  return join(dataDir, SUBDIR, `${OVERLAY_FILE}`);
}

async function loadOverlaySet(dataDir) {
  try {
    const raw = await readFile(overlayPath(dataDir), "utf8");
    const ids = JSON.parse(raw);
    return new Set(Array.isArray(ids) ? ids : []);
  } catch (error) {
    if (error.code === "ENOENT") return new Set();
    log.warn("Could not read registrar overlay set; starting empty", { error: error.message });
    return new Set();
  }
}

async function saveOverlaySet(dataDir, set) {
  const dir = join(dataDir, SUBDIR);
  await mkdir(dir, { recursive: true });
  const target = overlayPath(dataDir);
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify([...set], null, 2), "utf8");
  await rename(tmp, target);
}

// ---- registration -----------------------------------------------------------

/**
 * Ensure one guild's `/bamf` is correct: install an overlay if the guild has any
 * restricted module allowed, or clear a previous overlay so it falls back to the
 * global command. Returns true if the guild now carries an overlay.
 */
async function reconcileGuild(guild, commandMap, hadOverlay) {
  if (needsOverlay(commandMap, guild)) {
    const command = buildBamfCommand(commandsForGuild(commandMap, guild));
    await guild.commands.set([command]);
    log.info("Registered guild overlay for restricted modules", {
      guildId: guild.id,
      guild: guild.name,
    });
    return true;
  }
  if (hadOverlay) {
    // No longer qualifies; clear the guild-scoped command so global applies.
    await guild.commands.set([]);
    log.info("Cleared stale guild overlay (falls back to global)", {
      guildId: guild.id,
      guild: guild.name,
    });
  }
  return false;
}

/**
 * Reconcile every guild the bot is in against the current registry. Call once the
 * client is ready. Never throws: a per-guild failure (e.g. missing scope) is
 * logged and skipped so one bad guild can't take down the core (NFR4).
 */
export async function reconcileAllGuilds(client, commandMap, dataDir) {
  const previous = await loadOverlaySet(dataDir);
  const current = new Set();

  for (const guild of client.guilds.cache.values()) {
    try {
      const nowOverlaid = await reconcileGuild(guild, commandMap, previous.has(guild.id));
      if (nowOverlaid) current.add(guild.id);
    } catch (error) {
      log.error("Failed to reconcile guild commands", {
        guildId: guild.id,
        guild: guild.name,
        error: error.message,
      });
      // Preserve prior state for this guild so we don't lose track of an overlay
      // we can't currently verify.
      if (previous.has(guild.id)) current.add(guild.id);
    }
  }

  await saveOverlaySet(dataDir, current);
  log.info("Guild command reconciliation complete", { overlays: current.size });
}

/** Handle a single guild becoming relevant (join, or rename that changes name-matching). */
export async function reconcileOneGuild(guild, commandMap, dataDir) {
  const previous = await loadOverlaySet(dataDir);
  try {
    const nowOverlaid = await reconcileGuild(guild, commandMap, previous.has(guild.id));
    if (nowOverlaid) previous.add(guild.id);
    else previous.delete(guild.id);
    await saveOverlaySet(dataDir, previous);
  } catch (error) {
    log.error("Failed to reconcile a guild's commands", {
      guildId: guild.id,
      guild: guild.name,
      error: error.message,
    });
  }
}
