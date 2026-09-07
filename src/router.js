// Router (section 4.2): maps an incoming slash command to its module, calls the
// module over HTTP, validates the JSON, and relays it to Discord. Handles
// deferral (FR13), timeouts, and per-call isolation (NFR4).

import { randomUUID } from "node:crypto";
import { MessageFlags } from "discord.js";
import { config } from "./config.js";
import { log } from "./logger.js";
import { sanitizeInvokeResponse } from "./contract.js";
import { resolveInvokeBaseUrl } from "./module-url.js";
import { safeRespond, UNAVAILABLE_MESSAGE, GENERIC_ERROR_MESSAGE } from "./errors.js";

async function callModule(module, requestPayload, requestId) {
  const url = resolveInvokeBaseUrl(module.runtime.invokeUrl) + "/invoke";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.moduleTimeoutMs);

  const headers = { "content-type": "application/json" };
  if (config.sharedSecret) headers["x-bamf-secret"] = config.sharedSecret;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`module returned HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`module timed out after ${config.moduleTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve which module command a `/bamf ...` interaction targets.
 *   /bamf hello         -> group null, sub "hello"  -> command "hello", subcommand null
 *   /bamf threads list  -> group "threads", sub "list" -> command "threads", subcommand "list"
 * A module command exposed as a subcommand group carries the leaf as its
 * subcommand; one exposed as a plain subcommand has no module-level subcommand.
 */
function resolveTarget(interaction) {
  const group = interaction.options?.getSubcommandGroup?.(false) ?? null;
  const leaf = interaction.options?.getSubcommand?.(false) ?? null;
  return {
    commandName: group ?? leaf,
    subcommand: group ? leaf : null,
  };
}

/** Flatten the invoked options, descending past the subcommand group/subcommand
 * wrappers so a module receives only its own named options. */
function collectOptions(interaction) {
  let data = interaction.options?.data ?? [];
  // Descend through a subcommand group, then a subcommand, to the real options.
  while (data.length === 1 && (data[0].type === 1 || data[0].type === 2) && data[0].options) {
    data = data[0].options;
  }
  const options = {};
  for (const option of data) {
    if (option.type === 1 || option.type === 2) continue; // container, not a value
    options[option.name] = option.value;
  }
  return options;
}

/**
 * Handle one chat-input (slash) command interaction under `/bamf`.
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @param {Map<string, {module: object, command: object}>} commandMap
 */
export async function handleCommand(interaction, commandMap) {
  const requestId = randomUUID();
  interaction.__requestId = requestId;

  const target = resolveTarget(interaction);
  const entry = target.commandName ? commandMap.get(target.commandName) : null;
  if (!entry) {
    log.warn("Command has no owning module", {
      requestId,
      command: interaction.commandName,
      subcommand: target.commandName,
    });
    await safeRespond(interaction, UNAVAILABLE_MESSAGE);
    return;
  }

  const { module, command } = entry;
  const ephemeral = Boolean(command.ephemeral);
  // "instant" commands reply directly (no "thinking..."); everything else defers
  // first so a slow module can never breach Discord's 3s rule (FR13). Only mark a
  // command instant if its module is reliably fast - see docs/AUTHORING.md.
  const instant = command.instant === true;
  const startedAt = Date.now();

  log.info("Invocation received", {
    requestId,
    command: command.name,
    module: module.name,
    mode: instant ? "instant" : "deferred",
    user: interaction.user?.id,
    guild: interaction.guildId,
  });

  if (!instant) {
    try {
      await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    } catch (error) {
      log.error("Failed to defer interaction", { requestId, error: error.message });
      return;
    }
  }

  // Build the request the module contract expects (section 4.3).
  const options = collectOptions(interaction);
  const requestPayload = {
    requestId,
    command: command.name,
    subcommand: target.subcommand,
    options,
    invoker: {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username,
    },
    context: {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      locale: interaction.locale,
    },
  };

  try {
    const raw = await callModule(module, requestPayload, requestId);
    const payload = sanitizeInvokeResponse(raw);
    if (instant) {
      await interaction.reply(
        ephemeral ? { ...payload, flags: MessageFlags.Ephemeral } : payload
      );
    } else {
      await interaction.editReply(payload);
    }
    log.info("Invocation completed", {
      requestId,
      module: module.name,
      command: command.name,
      ms: Date.now() - startedAt,
    });
  } catch (error) {
    log.error("Invocation failed", {
      requestId,
      module: module.name,
      command: command.name,
      ms: Date.now() - startedAt,
      error: error.message,
    });
    const message = /timed out|HTTP 5|fetch failed|ECONNREFUSED/i.test(error.message)
      ? UNAVAILABLE_MESSAGE
      : GENERIC_ERROR_MESSAGE;
    await safeRespond(interaction, message);
  }
}
