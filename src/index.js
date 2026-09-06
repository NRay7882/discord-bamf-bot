// BamfBot core entrypoint (section 4.2). Connects to Discord, loads the module
// registry, and routes every slash command to its owning module.
//
// Secrets are read from a local .env file (see .env.example and src/config.js):
//   node src/index.js        (or: npm start)

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client, Events } from "discord.js";
import { secrets, config } from "./config.js";
import { log } from "./logger.js";
import { loadRegistry, ROOT_COMMAND_NAME } from "./registry.js";
import { loadInProcessModules } from "./inprocess.js";
import { resolvePrivileges } from "./permissions.js";
import { handleCommand } from "./router.js";
import { handleHelp, HELP_SUBCOMMAND_NAME } from "./help.js";
import { installGlobalGuards, safeRespond, GENERIC_ERROR_MESSAGE } from "./errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

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

  // In-process (first-party) module command handlers, keyed by command name.
  // Built once the client is ready so handlers can enumerate cached guilds and
  // start background work; empty until then.
  let inProcessCommands = new Map();

  client.once(Events.ClientReady, async (ready) => {
    log.info("Core is online", { tag: ready.user.tag, id: ready.user.id });
    inProcessCommands = await loadInProcessModules(modules, {
      client,
      config,
      dataDir: DATA_DIR,
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    // Every command is a child of the single `/bamf` command; ignore anything
    // else (e.g. a stale command left over from a previous deploy).
    if (interaction.commandName !== ROOT_COMMAND_NAME) return;
    try {
      const group = interaction.options.getSubcommandGroup(false);
      const leaf = interaction.options.getSubcommand(false);
      // A module command exposed as a subcommand group has group set; one exposed
      // as a plain subcommand has only leaf. The owning command name is group ?? leaf.
      const commandName = group ?? leaf;

      if (!group && leaf === HELP_SUBCOMMAND_NAME) {
        await handleHelp(interaction, commandMap);
        return;
      }
      const inProcess = inProcessCommands.get(commandName);
      if (inProcess) {
        await inProcess(interaction);
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
