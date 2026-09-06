// In-process module loader. Some features (like thread-directory) need direct
// discord.js access - live thread enumeration, event subscriptions, proactive
// channel upkeep - that the HTTP+JSON module contract deliberately does not
// expose. These trusted, first-party modules declare `"transport": "in-process"`
// in their manifest and ship a handler file that runs inside the core.
//
// A handler module exports:
//   commands: { [commandName]: async (interaction, ctx) => {} }   // required
//   init?:    async (ctx) => {}                                    // optional, at boot
//
// ctx = { client, log, config, dataDir }. Handlers receive the live discord.js
// interaction directly (no HTTP round-trip), so they may defer, edit, DM, etc.

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { log } from "./logger.js";

/**
 * Load every in-process module, run its init(ctx), and map its command names to
 * their handler functions.
 * @param {object[]} modules  loaded manifests (from loadRegistry)
 * @param {{ client: object, config: object, dataDir: string }} ctx
 * @returns {Promise<Map<string, Function>>} commandName -> handler(interaction, ctx)
 */
export async function loadInProcessModules(modules, ctx) {
  const commandHandlers = new Map();

  for (const manifest of modules) {
    if (manifest.transport !== "in-process") continue;

    const handlerPath = join(manifest.__dir, manifest.runtime.handler);
    let handler;
    try {
      handler = await import(pathToFileURL(handlerPath).href);
    } catch (error) {
      log.error("Failed to import in-process module handler", {
        module: manifest.name,
        handler: handlerPath,
        error: error.message,
      });
      continue;
    }

    const moduleCtx = { ...ctx, log, manifest };
    if (typeof handler.init === "function") {
      try {
        await handler.init(moduleCtx);
      } catch (error) {
        log.error("in-process module init() failed", {
          module: manifest.name,
          error: error.message,
        });
        // Keep going: a failed init should not strip the command handlers, and it
        // must never take down the core (NFR4).
      }
    }

    const commands = handler.commands ?? {};
    for (const command of manifest.commands) {
      const fn = commands[command.name];
      if (typeof fn !== "function") {
        log.warn("in-process module declares a command with no handler", {
          module: manifest.name,
          command: command.name,
        });
        continue;
      }
      commandHandlers.set(command.name, (interaction) => fn(interaction, moduleCtx));
    }

    log.info("Loaded in-process module", {
      module: manifest.name,
      commands: manifest.commands.map((c) => c.name),
    });
  }

  return commandHandlers;
}
