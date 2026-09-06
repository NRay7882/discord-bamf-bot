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
try {
  process.loadEnvFile();
} catch {
  // No .env present (e.g. the test/docs scripts, or an environment that
  // supplies real vars directly). Fall through; required() reports any secret
  // that is actually missing the first time it is used.
}

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
};
