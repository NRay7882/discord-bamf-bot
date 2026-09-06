// Registers slash commands with Discord (section 4.2).
//   node src/deploy-commands.js            -> guild-scoped (instant, for dev)
//   node src/deploy-commands.js --global   -> global (all servers, ~1h to propagate)
//
// Run through 1Password so the token is injected at runtime:
//   op run --env-file=.env -- node src/deploy-commands.js

import { REST, Routes } from "discord.js";
import { secrets } from "./config.js";
import { log } from "./logger.js";
import { loadRegistry, toDiscordCommand } from "./registry.js";
import { buildHelpCommand } from "./help.js";
import { resolvePrivileges, buildInstallUrl } from "./permissions.js";

async function main() {
  const isGlobal = process.argv.includes("--global");
  const { modules, commandMap } = await loadRegistry();

  const commands = [buildHelpCommand()];
  for (const { command } of commandMap.values()) {
    commands.push(toDiscordCommand(command));
  }

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
    commands: commands.map((c) => c.name),
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
