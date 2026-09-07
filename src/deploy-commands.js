// Registers slash commands with Discord (section 4.2).
//   node src/deploy-commands.js            -> guild-scoped (instant, for dev)
//   node src/deploy-commands.js --global   -> global (all servers, ~1h to propagate)
//
// The token is read from a local .env file (see src/config.js):
//   node src/deploy-commands.js      (or: npm run deploy)
//
// This registers the `/bamf` command. Restricted (server-specific) modules are
// added per-guild by the core at runtime (see src/registrar.js), so:
//   --global : universal modules only.
//   guild    : universal + any restricted module allowed in the test guild
//              (DISCORD_GUILD_ID, matched by ID), for instant local testing.

import { REST, Routes } from "discord.js";
import { secrets } from "./config.js";
import { log } from "./logger.js";
import { loadRegistry, isModuleAllowedInGuild } from "./registry.js";
import { buildBamfCommand } from "./commands.js";
import { resolvePrivileges, buildInstallUrl } from "./permissions.js";

async function main() {
  const isGlobal = process.argv.includes("--global");
  const { modules, commandMap } = await loadRegistry();

  const selected = [];
  for (const { module, command } of commandMap.values()) {
    if (isGlobal) {
      if (!module.__restricted) selected.push(command);
    } else if (isModuleAllowedInGuild(module, { guildId: secrets.guildId })) {
      selected.push(command);
    }
  }

  const bamf = buildBamfCommand(selected);
  const commands = [bamf];

  const privileges = resolvePrivileges(modules);
  const installUrl = buildInstallUrl(secrets.clientId, privileges);

  const rest = new REST({ version: "10" }).setToken(secrets.token);

  const route = isGlobal
    ? Routes.applicationCommands(secrets.clientId)
    : Routes.applicationGuildCommands(secrets.clientId, secrets.guildId);

  log.info("Deploying slash commands", {
    scope: isGlobal ? "global" : "guild",
    guildId: isGlobal ? undefined : secrets.guildId,
    command: bamf.name,
    subcommands: bamf.options.map((s) => s.name),
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
    log.info("Restricted modules are registered per-guild by the core at runtime.");
  }
}

main().catch((error) => {
  log.error("Command deployment failed", { error: error.message, stack: error.stack });
  process.exitCode = 1;
});
