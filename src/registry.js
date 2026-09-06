// Registry (section 4.2): loads and validates every module manifest at startup.
// It is the single source of truth for "what commands exist and who owns them,"
// powering command registration, /help, and the docs generator.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PermissionFlagsBits } from "discord.js";
import { config } from "./config.js";
import { log } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODULES_DIR = join(__dirname, "..", "modules");

// Discord application command option type numbers.
const OPTION_TYPES = {
  subcommand: 1,
  subcommand_group: 2,
  string: 3,
  integer: 4,
  boolean: 5,
  user: 6,
  channel: 7,
  role: 8,
  mentionable: 9,
  number: 10,
  attachment: 11,
};

function fail(moduleName, message) {
  throw new Error(`Invalid manifest for module "${moduleName}": ${message}`);
}

function validateManifest(manifest, source) {
  const name = manifest?.name ?? source;
  if (!manifest || typeof manifest !== "object") fail(name, "not an object");
  if (typeof manifest.name !== "string") fail(name, "missing string 'name'");
  if (typeof manifest.version !== "string") fail(name, "missing string 'version'");
  // In-process (first-party) modules run inside the core with direct discord.js
  // access instead of answering an HTTP /invoke, so they declare a handler file
  // rather than an invokeUrl. Everything else about the manifest is identical.
  if (manifest.transport === "in-process") {
    if (typeof manifest.runtime?.handler !== "string") {
      fail(name, "in-process module needs string 'runtime.handler'");
    }
  } else if (typeof manifest.runtime?.invokeUrl !== "string") {
    fail(name, "missing string 'runtime.invokeUrl'");
  }
  if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
    fail(name, "must declare at least one command in 'commands'");
  }
  for (const command of manifest.commands) {
    if (typeof command.name !== "string" || !/^[\w-]{1,32}$/.test(command.name)) {
      fail(name, `command name "${command.name}" is invalid (1-32 chars, word/hyphen)`);
    }
    if (typeof command.description !== "string" || command.description.length === 0) {
      fail(name, `command "${command.name}" needs a non-empty description`);
    }
    for (const option of command.options ?? []) {
      validateOption(name, command, option);
    }
  }
}

// Validate an option and any nested options (subcommands / subcommand groups).
function validateOption(moduleName, command, option) {
  if (!OPTION_TYPES[option.type]) {
    fail(
      moduleName,
      `command "${command.name}" has option "${option.name}" with unknown type "${option.type}"`
    );
  }
  for (const nested of option.options ?? []) {
    validateOption(moduleName, command, nested);
  }
}

function resolveMemberPermissions(value) {
  // Accept null, a numeric string bitfield, or an array of permission names.
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    let bits = 0n;
    for (const perm of value) {
      const bit = PermissionFlagsBits[perm];
      if (bit === undefined) throw new Error(`Unknown permission "${perm}"`);
      bits |= BigInt(bit);
    }
    return bits.toString();
  }
  throw new Error(`Unsupported defaultMemberPermissions: ${JSON.stringify(value)}`);
}

// Build one option (recursively, so subcommands and subcommand groups carry
// their own nested options through to Discord).
function buildOption(option) {
  const built = {
    type: OPTION_TYPES[option.type],
    name: option.name,
    description: option.description ?? option.name,
  };
  if (option.type === "subcommand" || option.type === "subcommand_group") {
    // Containers do not take `required` or `choices`; they hold nested options.
    const nested = (option.options ?? []).map(buildOption);
    if (nested.length > 0) built.options = nested;
  } else {
    built.required = Boolean(option.required);
    if (Array.isArray(option.choices)) {
      built.choices = option.choices.map((choice) =>
        typeof choice === "object"
          ? { name: choice.name, value: choice.value }
          : { name: String(choice), value: choice }
      );
    }
  }
  return built;
}

/** Convert one manifest command into the JSON Discord expects for registration. */
export function toDiscordCommand(command) {
  const options = (command.options ?? []).map(buildOption);

  const built = {
    name: command.name,
    description: command.description,
    default_member_permissions: resolveMemberPermissions(command.defaultMemberPermissions),
  };
  if (options.length > 0) built.options = options;
  return built;
}

/**
 * Load every module manifest under the modules directory.
 * @returns {Promise<{
 *   modules: object[],
 *   commandMap: Map<string, { module: object, command: object }>
 * }>}
 */
export async function loadRegistry({ modulesDir } = {}) {
  const dir = modulesDir ?? config.modulesDir ?? DEFAULT_MODULES_DIR;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      log.warn("No modules directory found", { dir });
      return { modules: [], commandMap: new Map() };
    }
    throw error;
  }

  const modules = [];
  const commandMap = new Map();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(dir, entry.name, "manifest.json");
    let raw;
    try {
      raw = await readFile(manifestPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        log.warn("Module directory has no manifest.json; skipping", { module: entry.name });
        continue;
      }
      throw error;
    }

    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch (error) {
      fail(entry.name, `manifest.json is not valid JSON (${error.message})`);
    }

    validateManifest(manifest, entry.name);
    manifest.__dir = join(dir, entry.name);
    manifest.transport = manifest.transport === "in-process" ? "in-process" : "http";

    for (const command of manifest.commands) {
      if (commandMap.has(command.name)) {
        const owner = commandMap.get(command.name).module.name;
        fail(manifest.name, `command "${command.name}" already owned by module "${owner}"`);
      }
      commandMap.set(command.name, { module: manifest, command });
    }

    modules.push(manifest);
    log.debug("Loaded module manifest", {
      module: manifest.name,
      version: manifest.version,
      commands: manifest.commands.map((c) => c.name),
    });
  }

  return { modules, commandMap };
}
