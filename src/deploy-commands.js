// Registers slash commands with Discord (section 4.2).
//   node src/deploy-commands.js            -> guild-scoped (instant, for dev)
//   node src/deploy-commands.js --global   -> global (all servers, ~1h to propagate)
//
// The token is read from a local .env file (see src/config.js):
//   node src/deploy-commands.js      (or: npm run deploy)

import { REST, Routes } from "discord.js";
import { secrets } from "./config.js";
import { log } from "./logger.js";
import { loadRegistry, toBamfSubcommand, ROOT_COMMAND_NAME } from "./registry.js";
import { buildHelpSubcommand } from "./help.js";
import { resolvePrivileges, buildInstallUrl } from "./permissions.js";

// Discord allows at most 25 options (subcommands/groups) on one command.
const MAX_SUBCOMMANDS = 25;

async function main() {
  const isGlobal = process.argv.includes("--global");
  const { modules, commandMap } = await loadRegistry();

  // Every command rolls up under a single `/bamf` command: the core's help plus
  // one child per module command (a subcommand, or a subcommand group when the
  // command owns subcommands of its own).
  const subcommands = [buildHelpSubcommand()];
  for (const { command } of commandMap.values()) {
    subcommands.push(toBamfSubcommand(command));
  }

  if (subcommands.length > MAX_SUBCOMMANDS) {
    throw new Error(
      `/${ROOT_COMMAND_NAME} would have ${subcommands.length} subcommands; Discord allows at most ${MAX_SUBCOMMANDS}. ` +
        `Group commands into subcommands or split into a second top-level command.`
    );
  }

  const commands = [
    {
      name: ROOT_COMMAND_NAME,
      description: "BamfBot commands.",
      options: subcommands,
    },
  ];

  const privileges = resolvePrivileges(modules);
  const installUrl = buildInstallUrl(secrets.clientId, privileges);

  const rest = new REST({ version: "10" }).setToken(secrets.token);

  const route = isGlobal
    ? Routes.applicationCommands(secrets.clientId)
    : Routes.applicationGuildCommands(secrets.clientId, secrets.guildId);

  log.info("Deploying slash commands", {
    scope: isGlobal ? "global" : "guild",
    guildId: isGlobal ? undefined : secrets.guildId,
    count: commands.length,
    command: ROOT_COMMAND_NAME,
    subcommands: subcommands.map((s) => s.name),
  });

  const result = await rest.put(route, { body: commands });

  log.info("Slash commands deployed", {
    scope: isGlobal ? "global" : "guild",
    registered: result.length,
  });
  log.info("Least-privilege install URL (union of all modules)", {
    permissions: privileges.permissionInteger,
    intents: privileges.intentNames,
    scopes: privileges.oauthScopes,
    url: installUrl,
  });

  if (!isGlobal) {
    log.info("Guild-scoped commands appear instantly on the test server.");
  } else {
    log.info("Global commands can take up to ~1 hour to propagate.");
  }
}

main().catch((error) => {
  log.error("Command deployment failed", { error: error.message, stack: error.stack });
  process.exitCode = 1;
});
