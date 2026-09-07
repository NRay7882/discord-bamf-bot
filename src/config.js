// Central runtime configuration, read once from the environment.
//
// Secrets (DISCORD_TOKEN etc.) come from a local .env file that is never
// committed (see .env.example for the keys). Loading it here means every entry
// point - the core, command deploy, the avatar script - picks it up from a
// plain `node` invocation with no external tooling.
//
// Values already present in the environment take precedence over the file, so
// other injection methods (a container's or platform's secret store) keep
// working unchanged.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

try {
  process.loadEnvFile();
} catch {
  // No .env present (e.g. the test/docs scripts, or an environment that
  // supplies real vars directly). Fall through; required() reports any secret
  // that is actually missing the first time it is used.
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Create a .env from .env.example with real values (it is gitignored).`
    );
  }
  return value.trim();
}

function optional(name, fallback) {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

// Secrets are validated lazily (only when actually needed) so that scripts
// like the docs generator can run without a full Discord environment.
export const secrets = {
  get token() {
    return required("DISCORD_TOKEN");
  },
  get clientId() {
    return required("DISCORD_CLIENT_ID");
  },
  get guildId() {
    return required("DISCORD_GUILD_ID");
  },
};

export const config = {
  moduleTimeoutMs: Number(optional("MODULE_TIMEOUT_MS", "8000")),
  sharedSecret: optional("BAMF_SHARED_SECRET", null),
  logLevel: optional("LOG_LEVEL", "info"),
  modulesDir: optional("BAMF_MODULES_DIR", null), // resolved by registry if null

  // Which environment this instance is: "prod" (default) or "dev". Purely
  // informational for the core (it drives the PM2 name prefix / port offset in
  // ecosystem.config.cjs); handy in logs when prod and dev run on one host.
  env: optional("BAMF_ENV", "prod"),

  // How the core reaches HTTP modules. By default it uses each module's manifest
  // invokeUrl verbatim. These two overrides let a second (dev) stack run beside
  // prod on the same machine, or a containerized stack address modules by name:
  //   BAMF_MODULE_HOST        - replace the module host (e.g. a Docker service).
  //   BAMF_MODULE_PORT_OFFSET - add to each module port, so dev (offset 1000)
  //                             talks to its own modules on 9081/9082 instead of
  //                             prod's 8081/8082. Modules pick up the shifted
  //                             port from PORT (set per-env in ecosystem.config).
  moduleHost: optional("BAMF_MODULE_HOST", null),
  modulePortOffset: Number(optional("BAMF_MODULE_PORT_OFFSET", "0")) || 0,
};

// --- Operator overrides (never committed) -----------------------------------
//
// Server-specific choices live outside the tracked repo so a public fork never
// ships anyone's guild/role IDs (FR: non-universal modules). Two gitignored
// sources, both optional:
//   .env             - simple per-module scoping and on/off switches
//   bamf.local.json  - richer config (server-name lists, per-guild role IDs)
//
// bamf.local.json shape:
//   {
//     "modules": {
//       "<module-name>": { "enabled": false, "guildIds": ["..."], "guildNames": ["..."] }
//     },
//     "access": {
//       "<command path>": { "roleIds": { "<guildId>": ["<roleId>", ...] } }
//     }
//   }
// where "<command path>" is "command" or "command subcommand".

function loadLocalConfig() {
  try {
    const raw = readFileSync(join(ROOT_DIR, "bamf.local.json"), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`bamf.local.json is present but not valid JSON: ${error.message}`);
  }
}

function splitList(value) {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// A module name maps to an env key by upper-casing and turning any run of
// non-alphanumerics into a single underscore, e.g. "my-module" -> "MY_MODULE".
function moduleEnvKey(name) {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

const localConfig = loadLocalConfig();

export const overrides = {
  local: localConfig,

  // Modules the operator has turned off entirely (env list; per-module JSON
  // "enabled": false is handled by the registry).
  disabledModules: new Set(splitList(process.env.BAMF_DISABLED_MODULES).map((s) => s.toLowerCase())),

  /** Guild IDs granted to a restricted module via `BAMF_SCOPE_<MODULE>`. */
  envScopeFor(moduleName) {
    return splitList(process.env[`BAMF_SCOPE_${moduleEnvKey(moduleName)}`]);
  },

  /** Operator role-ID overrides for a command path in one guild (or []). */
  roleIdsFor(commandPath, guildId) {
    return localConfig.access?.[commandPath]?.roleIds?.[guildId] ?? [];
  },
};
