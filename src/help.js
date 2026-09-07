// Built-in help command (FR9, section 4.6). Sourced entirely from the Registry,
// so it always reflects the modules that are actually loaded. Owned by the core,
// not by any module. Exposed as `/bamf help`, alongside every module command.

import { MessageFlags } from "discord.js";
import { ROOT_COMMAND_NAME, isModuleAllowedInGuild } from "./registry.js";
import { buildRequirement, describeRequirement } from "./access.js";

/** A short "(needs ...)" note for a command/subcommand's declared access, or "". */
function accessNote(access) {
  const req = buildRequirement({
    permissions: access?.permissions ?? [],
    roles: access?.roles ?? [],
  });
  return req ? ` _(needs ${describeRequirement(req)})_` : "";
}

export const HELP_SUBCOMMAND_NAME = "help";

/** The Discord definition for the help subcommand, to nest under `/bamf`. */
export function buildHelpSubcommand() {
  return {
    type: 1, // subcommand
    name: HELP_SUBCOMMAND_NAME,
    description: "List BamfBot's commands, or show detail for one.",
    options: [
      {
        type: 3, // string
        name: "command",
        description: "Show usage detail for a specific command.",
        required: false,
      },
    ],
  };
}

/** The subcommands a command owns (if any), else null. */
function subcommandsOf(command) {
  const subs = (command.options ?? []).filter((o) => o.type === "subcommand");
  return subs.length > 0 ? subs : null;
}

function optionArgs(options) {
  return (options ?? [])
    .filter((o) => o.type !== "subcommand" && o.type !== "subcommand_group")
    .map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`))
    .join(" ");
}

/** A user-facing invocation path, e.g. `/bamf hello` or `/bamf threads list`. */
function usageLine(command) {
  const subs = subcommandsOf(command);
  if (subs) {
    return `/${ROOT_COMMAND_NAME} ${command.name} <${subs.map((s) => s.name).join("|")}>`;
  }
  const args = optionArgs(command.options);
  return args
    ? `/${ROOT_COMMAND_NAME} ${command.name} ${args}`
    : `/${ROOT_COMMAND_NAME} ${command.name}`;
}

function renderList(commandMap) {
  const lines = ["**BamfBot commands**", "", `All commands live under \`/${ROOT_COMMAND_NAME}\`.`, ""];
  const entries = [...commandMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, { command }] of entries) {
    const subs = subcommandsOf(command);
    if (subs) {
      lines.push(`- \`/${ROOT_COMMAND_NAME} ${name}\` - ${command.description}${accessNote(command.access)}`);
      for (const sub of subs) {
        lines.push(
          `  - \`/${ROOT_COMMAND_NAME} ${name} ${sub.name}\` - ${sub.description}${accessNote(sub.access)}`
        );
      }
    } else {
      lines.push(`- \`/${ROOT_COMMAND_NAME} ${name}\` - ${command.description}${accessNote(command.access)}`);
    }
  }
  lines.push("", `Use \`/${ROOT_COMMAND_NAME} help command:<name>\` for details on one command.`);
  return lines.join("\n");
}

function renderDetail(entry) {
  const { module, command } = entry;
  const lines = [
    `**\`/${ROOT_COMMAND_NAME} ${command.name}\`** - ${command.description}`,
    "",
    `Usage: \`${usageLine(command)}\``,
    `Module: \`${module.name}\` v${module.version}`,
    `Reply: ${command.ephemeral ? "private (only you see it)" : "public (posted in channel)"}`,
  ];
  const cmdReq = buildRequirement({
    permissions: command.access?.permissions ?? [],
    roles: command.access?.roles ?? [],
  });
  if (cmdReq) lines.push(`Access: ${describeRequirement(cmdReq)}`);

  const subs = subcommandsOf(command);
  if (subs) {
    lines.push("", "Subcommands:");
    for (const sub of subs) {
      const args = optionArgs(sub.options);
      const usage = args
        ? `/${ROOT_COMMAND_NAME} ${command.name} ${sub.name} ${args}`
        : `/${ROOT_COMMAND_NAME} ${command.name} ${sub.name}`;
      lines.push(`- \`${usage}\` - ${sub.description}${accessNote(sub.access)}`);
    }
    return lines.join("\n");
  }

  const options = command.options ?? [];
  if (options.length > 0) {
    lines.push("", "Options:");
    for (const o of options) {
      lines.push(
        `- \`${o.name}\` (${o.type}${o.required ? ", required" : ""}) - ${o.description ?? o.name}`
      );
    }
  }
  return lines.join("\n");
}

/**
 * Handle a `/bamf help` interaction.
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @param {Map<string, {module: object, command: object}>} commandMap
 */
export async function handleHelp(interaction, commandMap) {
  // Only list what's actually available in this server (restricted modules that
  // aren't allowed here are omitted entirely).
  const ctx = { guildId: interaction.guildId, guildName: interaction.guild?.name };
  const visible = new Map();
  for (const [name, entry] of commandMap) {
    if (isModuleAllowedInGuild(entry.module, ctx)) visible.set(name, entry);
  }

  const requested = interaction.options.getString("command");
  let content;

  if (requested) {
    // Accept "threads", "/threads", "/bamf threads", or "bamf threads".
    const key = requested
      .replace(/^\//, "")
      .replace(new RegExp(`^${ROOT_COMMAND_NAME}\\s+`), "")
      .trim()
      .split(/\s+/)[0];
    const entry = visible.get(key);
    content = entry
      ? renderDetail(entry)
      : `No command named \`/${ROOT_COMMAND_NAME} ${key}\`. Run \`/${ROOT_COMMAND_NAME} help\` to see everything available.`;
  } else if (visible.size === 0) {
    content = "No commands are available yet.";
  } else {
    content = renderList(visible);
  }

  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}
