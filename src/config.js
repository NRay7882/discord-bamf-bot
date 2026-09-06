// Central runtime configuration, read once from the environment.
//
// Secrets (DISCORD_TOKEN etc.) are injected at runtime by `op run` and are
// never written to disk. See .env.example for the op:// references.

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Run through 1Password, e.g.  op run --env-file=.env -- <command>`
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
