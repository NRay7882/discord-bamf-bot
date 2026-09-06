// Graceful error and unavailable-command handling (FR10, section 4.6).
// Every user-facing failure path points the user back to /help.

import { log } from "./logger.js";

export const UNAVAILABLE_MESSAGE =
  "That command isn't available right now. Try `/help` to see what's working.";

export const GENERIC_ERROR_MESSAGE =
  "Something went wrong handling that command. Try again, or run `/help`.";

/**
 * Reply (or edit a deferred reply) safely, ephemerally, without throwing.
 * Works whether or not the interaction was already deferred/replied.
 */
export async function safeRespond(interaction, content, { ephemeral = true } = {}) {
  const payload = { content, allowedMentions: { parse: [] } };
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
    } else {
      await interaction.reply({ ...payload, ephemeral });
    }
  } catch (error) {
    log.error("Failed to deliver a response to Discord", {
      requestId: interaction.__requestId,
      error: error.message,
    });
  }
}

/**
 * Install process-level guards so a stray rejection never takes the core down
 * (NFR4). We log loudly but keep the gateway connection alive.
 */
export function installGlobalGuards() {
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled promise rejection", {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
  process.on("uncaughtException", (error) => {
    log.error("Uncaught exception", { error: error.message, stack: error.stack });
  });
}
