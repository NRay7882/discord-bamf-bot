// Runtime gate for a `/bamf` invocation: is this module available in this server,
// and may this member run this command? Both checks run in the core before any
// module (in-process or HTTP) is called, so a module never has to hand-roll them.
//
// Scope is normally also enforced by registration (a restricted module isn't even
// registered where it's not allowed); this is defense in depth against a global
// command that hasn't been shadowed yet. Access can only be enforced here -
// Discord's per-command permission setting doesn't reach a subcommand of /bamf -
// so a gated command still shows in the picker and is refused on use.

import { ROOT_COMMAND_NAME, isModuleAllowedInGuild } from "./registry.js";
import { buildRequirement, memberSatisfies, describeRequirement } from "./access.js";
import { overrides } from "./config.js";

/** The access requirement for one node (command or subcommand), or null if open. */
function requirementFor(access, commandPath, guildId) {
  return buildRequirement({
    permissions: access?.permissions ?? [],
    roles: access?.roles ?? [],
    roleIds: overrides.roleIdsFor(commandPath, guildId),
  });
}

/**
 * Evaluate scope + access for an invocation.
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @param {{ module: object, command: object }} entry
 * @param {string|null} subName  the invoked subcommand, if any
 * @returns {{ allowed: boolean, message?: string }}
 */
export function checkGuards(interaction, entry, subName) {
  const { module, command } = entry;
  const guildId = interaction.guildId;
  const guildName = interaction.guild?.name;

  // Scope: is the module available in this server at all?
  if (!isModuleAllowedInGuild(module, { guildId, guildName })) {
    return { allowed: false, message: "That command isn't available in this server." };
  }

  // Access: the command is a floor; a subcommand may narrow it further. Every
  // applicable requirement must be satisfied.
  const requirements = [];
  const cmdReq = requirementFor(command.access, command.name, guildId);
  if (cmdReq) requirements.push(cmdReq);

  if (subName) {
    const sub = (command.options ?? []).find(
      (o) => o.type === "subcommand" && o.name === subName
    );
    const subReq = requirementFor(sub?.access, `${command.name} ${subName}`, guildId);
    if (subReq) requirements.push(subReq);
  }

  const failing = requirements.find((req) => !memberSatisfies(interaction, req));
  if (failing) {
    const path = subName ? `${command.name} ${subName}` : command.name;
    return {
      allowed: false,
      message: `You don't have permission to use \`/${ROOT_COMMAND_NAME} ${path}\` (requires ${describeRequirement(
        failing
      )}).`,
    };
  }

  return { allowed: true };
}
