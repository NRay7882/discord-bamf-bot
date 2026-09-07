// Registry (section 4.2): loads and validates every module manifest at startup.
// It is the single source of truth for "what commands exist and who owns them,"
// powering command registration, /help, and the docs generator.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config, overrides } from "./config.js";
import { log } from "./logger.js";
import { validateAccess } from "./access.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODULES_DIR = join(__dirname, "..", "modules");

// Every command in the bot is exposed as a child of a single top-level slash
// command, so users type `/bamf hello`, `/bamf threads list`, etc. instead of a
// separate `/command` per module. Command names that would collide with the
// core's own children are reserved.
export const ROOT_COMMAND_NAME = "bamf";
const RESERVED_COMMAND_NAMES = new Set(["help"]);

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
  validateScope(name, manifest.scope);
  for (const command of manifest.commands) {
    if (typeof command.name !== "string" || !/^[\w-]{1,32}$/.test(command.name)) {
      fail(name, `command name "${command.name}" is invalid (1-32 chars, word/hyphen)`);
    }
    if (RESERVED_COMMAND_NAMES.has(command.name)) {
      fail(name, `command name "${command.name}" is reserved by the core (it owns /${ROOT_COMMAND_NAME} ${command.name})`);
    }
    if (typeof command.description !== "string" || command.description.length === 0) {
      fail(name, `command "${command.name}" needs a non-empty description`);
    }
    // Per-command access gating (who may run it). The core enforces this at
    // invocation - see access.js. A subcommand may narrow it further (below).
    try {
      validateAccess(command.access, `command "${command.name}"`);
    } catch (error) {
      fail(name, error.message);
    }
    // Rolling every command under /bamf spends one nesting level, so a command
    // may hold subcommands but not subcommand groups (Discord allows at most
    // /bamf <group> <subcommand>). Reject the too-deep shape here with a clear
    // message rather than letting Discord reject the whole deploy.
    for (const option of command.options ?? []) {
      if (option.type === "subcommand") {
        try {
          validateAccess(option.access, `command "${command.name}" subcommand "${option.name}"`);
        } catch (error) {
          fail(name, error.message);
        }
      }
      if (option.type === "subcommand_group") {
        fail(
          name,
          `command "${command.name}" uses a subcommand group, which cannot roll up under ` +
            `/${ROOT_COMMAND_NAME} (max depth is /${ROOT_COMMAND_NAME} <command> <subcommand>). Flatten it to subcommands.`
        );
      }
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

// A module may declare that it is server-specific, but NEVER which servers - the
// allowlist lives only in the operator's gitignored config (env / bamf.local.json)
// so a public repo never carries anyone's guild identifiers. We reject server
// identifiers found in a committed manifest to enforce that.
function validateScope(moduleName, scope) {
  if (scope == null) return;
  if (typeof scope !== "object" || Array.isArray(scope)) {
    fail(moduleName, "'scope' must be an object");
  }
  if (scope.restricted !== undefined && typeof scope.restricted !== "boolean") {
    fail(moduleName, "'scope.restricted' must be a boolean");
  }
  if ("guildIds" in scope || "guildNames" in scope) {
    fail(
      moduleName,
      "'scope' must not list guildIds/guildNames in a committed manifest. Set only " +
        '{ "restricted": true } and configure the allowlist via BAMF_SCOPE_<MODULE> or bamf.local.json.'
    );
  }
}

/**
 * Resolve a module's effective scope from its manifest plus operator overrides
 * (env + bamf.local.json), attaching the result to the manifest for later checks.
 */
function applyScope(manifest, localModule) {
  const restricted = manifest.scope?.restricted === true;
  manifest.__restricted = restricted;
  manifest.__allowedGuildIds = new Set();
  manifest.__allowedGuildNames = new Set();
  if (!restricted) return;

  for (const id of overrides.envScopeFor(manifest.name)) manifest.__allowedGuildIds.add(id);
  for (const id of localModule.guildIds ?? []) manifest.__allowedGuildIds.add(id);
  for (const nm of localModule.guildNames ?? []) manifest.__allowedGuildNames.add(String(nm).toLowerCase());

  if (manifest.__allowedGuildIds.size === 0 && manifest.__allowedGuildNames.size === 0) {
    log.warn("Restricted module has no allowlist; it will be available in no server", {
      module: manifest.name,
      hint: `set BAMF_SCOPE_${manifest.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")} or bamf.local.json`,
    });
  }
}

/**
 * Whether a (possibly restricted) module is available in a given guild.
 * Universal modules are available everywhere; restricted modules only where the
 * operator listed the guild's ID or name.
 */
export function isModuleAllowedInGuild(manifest, { guildId, guildName } = {}) {
  if (!manifest.__restricted) return true;
  if (guildId && manifest.__allowedGuildIds.has(guildId)) return true;
  if (guildName && manifest.__allowedGuildNames.has(String(guildName).toLowerCase())) return true;
  return false;
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

/**
 * Convert one manifest command into a child of the top-level `/bamf` command:
 *   - a command whose options are subcommands -> a subcommand *group*
 *     (`/bamf threads list`)
 *   - any other command -> a plain subcommand, carrying its own options
 *     (`/bamf hello`, `/bamf roll <sides>`)
 *
 * Note: Discord only supports `default_member_permissions` on the top-level
 * command, so a module's `defaultMemberPermissions` cannot gate an individual
 * `/bamf <command>`. Modules that need to restrict a command must enforce it in
 * their handler (see thread-directory), and `/help` still reflects the intended
 * visibility.
 */
export function toBamfSubcommand(command) {
  const options = command.options ?? [];
  const hasSubcommands = options.some((o) => o.type === "subcommand");

  if (hasSubcommands) {
    return {
      type: OPTION_TYPES.subcommand_group,
      name: command.name,
      description: command.description,
      options: options.map(buildOption),
    };
  }

  const built = {
    type: OPTION_TYPES.subcommand,
    name: command.name,
    description: command.description,
  };
  const built_options = options.map(buildOption);
  if (built_options.length > 0) built.options = built_options;
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

    // Operator overrides (never committed): turn a module off, or supply the
    // guild allowlist for a restricted one.
    const localModule = overrides.local?.modules?.[manifest.name] ?? {};
    if (overrides.disabledModules.has(manifest.name.toLowerCase()) || localModule.enabled === false) {
      log.info("Module disabled by operator config; skipping", { module: manifest.name });
      continue;
    }
    applyScope(manifest, localModule);

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
