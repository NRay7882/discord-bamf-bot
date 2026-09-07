// PM2 process config for running BamfBot full-time (see docs/HOSTING.md).
// Runs the core and each HTTP module as separate, auto-restarting processes.
//
// Only HTTP modules (manifest has `runtime.invokeUrl`) get their own entry here,
// like bamf-hello-world. In-process modules (manifest has
// `transport: "in-process"`, e.g. thread-directory) run inside bamf-core and are
// loaded by src/inprocess.js at boot, so they have no process of their own -
// don't add a PM2 entry for them; they start and restart with bamf-core.
//
//   pm2 start ecosystem.config.cjs                 # prod (default)
//   $env:BAMF_ENV="dev"; pm2 start ecosystem.config.cjs   # dev, beside prod
//   pm2 logs            # tail output
//   pm2 save            # remember these processes across reboots
//
// The core reads its secrets from a local .env file (gitignored); no external
// tooling is required for unattended restarts.
//
// --- Dual environment (prod + dev on one host) -------------------------------
// BAMF_ENV selects which environment this process set is:
//   prod (default) -> names "bamf-*",     module ports 8081/8082 (offset 0)
//   dev            -> names "bamf-dev-*",  module ports 9081/9082 (offset 1000)
// The name prefix keeps the two sets distinct in one PM2 daemon; the port offset
// keeps their modules from colliding. The core learns the same offset via its
// env below and reaches only its own modules (see src/module-url.js). Run each
// environment from its own working copy (a `git worktree` is ideal) so each has
// its own .env (dev app token vs prod app token) and its own data/ directory.
// Override the offset explicitly with BAMF_MODULE_PORT_OFFSET if you prefer.
//
// `pmx: false` disables PM2's built-in pm2.io instrumentation, which throws
// EPIPE on Windows with recent Node and crash-loops the process. We don't use
// pm2.io monitoring, so we turn it off.

const ENV = (process.env.BAMF_ENV || "prod").toLowerCase();
const isDev = ENV === "dev";
const prefix = isDev ? "bamf-dev" : "bamf";
const offset =
  Number(process.env.BAMF_MODULE_PORT_OFFSET ?? (isDev ? 1000 : 0)) || 0;
const port = (base) => String(base + offset);

// Shared PM2 options. `namespace` groups an environment's processes so
// `pm2 <action> <prefix>` can act on just that environment if you want.
const common = {
  cwd: __dirname,
  autorestart: true,
  max_restarts: 10,
  restart_delay: 3000,
  pmx: false,
  namespace: prefix,
};

module.exports = {
  apps: [
    {
      ...common,
      name: `${prefix}-core`,
      script: "src/index.js",
      // The core loads .env itself (see src/config.js) and holds the Discord
      // connection. We pass the environment + port offset so it reaches this
      // environment's modules; anything already in .env still wins over these.
      env: {
        BAMF_ENV: ENV,
        BAMF_MODULE_PORT_OFFSET: String(offset),
      },
    },
    {
      ...common,
      name: `${prefix}-hello-world`,
      script: "node",
      args: ["modules/hello-world/index.js"],
      env: {
        PORT: port(8081),
      },
      // Modules hold no Discord secrets. Add BAMF_SHARED_SECRET here (and to the
      // core's env) once you enable it.
    },
    {
      ...common,
      name: `${prefix}-astrogoblin`,
      script: "node",
      args: ["modules/astrogoblin/index.js"],
      env: {
        PORT: port(8082),
      },
      // Restricted module: allow it in a server with BAMF_SCOPE_ASTROGOBLIN in
      // the CORE's .env (the guild ID(s), comma-separated). This process only
      // serves search results and needs no Discord secrets.
    },
  ],
};
