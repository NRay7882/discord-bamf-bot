// BamfBot core entrypoint (section 4.2). Connects to Discord, loads the module
// registry, and routes every slash command to its owning module.
//
// Run through 1Password so secrets are injected at runtime:
//   op run --env-file=.env -- node src/index.js

import { Client, Events } from "discord.js";
import { secrets } from "./config.js";
import { log } from "./logger.js";
import { loadRegistry } from "./registry.js";
import { resolvePrivileges } from "./permissions.js";
import { handleCommand } from "./router.js";
import { handleHelp, HELP_COMMAND_NAME } from "./help.js";
import { installGlobalGuards, safeRespond, GENERIC_ERROR_MESSAGE } from "./errors.js";

async function main() {
  installGlobalGuards();

  const { modules, commandMap } = await loadRegistry();
  const privileges = resolvePrivileges(modules);

  log.info("Registry loaded", {
    modules: modules.map((m) => `${m.name}@${m.version}`),
    commands: [...commandMap.keys()],
    intents: privileges.intentNames,
  });

  const client = new Client({ intents: privileges.intentBits });

  client.once(Events.ClientReady, (ready) => {
    log.info("Core is online", { tag: ready.user.tag, id: ready.user.id });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      if (interaction.commandName === HELP_COMMAND_NAME) {
        await handleHelp(interaction, commandMap);
        return;
      }
      await handleCommand(interaction, commandMap);
    } catch (error) {
      // Last-resort guard: a bug in a handler must not crash the core (NFR4).
      log.error("Unhandled error in interaction handler", {
        command: interaction.commandName,
        error: error.message,
        stack: error.stack,
      });
      await safeRespond(interaction, GENERIC_ERROR_MESSAGE);
    }
  });

  await client.login(secrets.token);
}

main().catch((error) => {
  log.error("Core failed to start", { error: error.message, stack: error.stack });
  process.exitCode = 1;
});
