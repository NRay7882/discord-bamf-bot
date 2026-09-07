// Compose the single top-level `/bamf` command from a set of module commands.
// Shared by the CLI deploy (global/universal) and the core's per-guild registrar
// (guild overlays that add a server's restricted modules), so both build the
// exact same shape.

import { toBamfSubcommand, ROOT_COMMAND_NAME } from "./registry.js";
import { buildHelpSubcommand } from "./help.js";

// Discord allows at most 25 options (subcommands/groups) on one command.
const MAX_SUBCOMMANDS = 25;

/**
 * Build the `/bamf` application command from an array of manifest command objects.
 * Always includes the core `help` subcommand. The command is guild-only
 * (dm_permission: false): every module assumes a guild, and scope/access checks
 * need one.
 * @param {object[]} commands  manifest command objects (the `command` of each entry)
 */
export function buildBamfCommand(commands) {
  const subcommands = [buildHelpSubcommand()];
  for (const command of commands) subcommands.push(toBamfSubcommand(command));

  if (subcommands.length > MAX_SUBCOMMANDS) {
    throw new Error(
      `/${ROOT_COMMAND_NAME} would have ${subcommands.length} subcommands; Discord allows at most ${MAX_SUBCOMMANDS}. ` +
        `Group commands into subcommands, or split into a second top-level command.`
    );
  }

  return {
    name: ROOT_COMMAND_NAME,
    description: "BamfBot commands.",
    dm_permission: false,
    options: subcommands,
  };
}
