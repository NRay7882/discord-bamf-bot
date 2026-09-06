// Built-in /help command (FR9, section 4.6). Sourced entirely from the Registry,
// so it always reflects the modules that are actually loaded. Owned by the core,
// not by any module.

import { MessageFlags } from "discord.js";

export const HELP_COMMAND_NAME = "help";

/** The Discord command definition for /help, for the deploy script to register. */
export function buildHelpCommand() {
  return {
    name: HELP_COMMAND_NAME,
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

function usageLine(command) {
  const args = (command.options ?? [])
    .map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`))
    .join(" ");
  return args ? `/${command.name} ${args}` : `/${command.name}`;
}

function renderList(commandMap) {
  const lines = ["**BamfBot commands**", ""];
  const entries = [...commandMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, { command }] of entries) {
    lines.push(`- \`/${name}\` - ${command.description}`);
  }
  lines.push("", "Use `/help command:<name>` for details on one command.");
  return lines.join("\n");
}

function renderDetail(name, entry) {
  const { module, command } = entry;
  const lines = [
    `**\`/${command.name}\`** - ${command.description}`,
    "",
    `Usage: \`${usageLine(command)}\``,
    `Module: \`${module.name}\` v${module.version}`,
    `Reply: ${command.ephemeral ? "private (only you see it)" : "public (posted in channel)"}`,
  ];
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
 * Handle a /help interaction.
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @param {Map<string, {module: object, command: object}>} commandMap
 */
export async function handleHelp(interaction, commandMap) {
  const requested = interaction.options.getString("command");
  let content;

  if (requested) {
    const key = requested.replace(/^\//, "");
    const entry = commandMap.get(key);
    content = entry
      ? renderDetail(key, entry)
      : `No command named \`/${key}\`. Run \`/help\` to see everything available.`;
  } else if (commandMap.size === 0) {
    content = "No commands are available yet.";
  } else {
    content = renderList(commandMap);
  }

  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}
