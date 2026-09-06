// Router (section 4.2): maps an incoming slash command to its module, calls the
// module over HTTP, validates the JSON, and relays it to Discord. Handles
// deferral (FR13), timeouts, and per-call isolation (NFR4).

import { randomUUID } from "node:crypto";
import { MessageFlags } from "discord.js";
import { config } from "./config.js";
import { log } from "./logger.js";
import { sanitizeInvokeResponse } from "./contract.js";
import { safeRespond, UNAVAILABLE_MESSAGE, GENERIC_ERROR_MESSAGE } from "./errors.js";

async function callModule(module, requestPayload, requestId) {
  const url = module.runtime.invokeUrl.replace(/\/$/, "") + "/invoke";
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
 * Handle one chat-input (slash) command interaction.
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @param {Map<string, {module: object, command: object}>} commandMap
 */
export async function handleCommand(interaction, commandMap) {
  const requestId = randomUUID();
  interaction.__requestId = requestId;

  const entry = commandMap.get(interaction.commandName);
  if (!entry) {
    log.warn("Command has no owning module", {
      requestId,
      command: interaction.commandName,
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
  const options = {};
  for (const option of interaction.options?.data ?? []) {
    options[option.name] = option.value;
  }
  const requestPayload = {
    requestId,
    command: command.name,
    subcommand: interaction.options?.getSubcommand?.(false) ?? null,
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
