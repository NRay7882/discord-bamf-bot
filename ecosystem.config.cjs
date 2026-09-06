// PM2 process config for running BamfBot full-time (see docs/HOSTING.md).
// Runs the core and each HTTP module as separate, auto-restarting processes.
//
// Only HTTP modules (manifest has `runtime.invokeUrl`) get their own entry here,
// like bamf-hello-world. In-process modules (manifest has
// `transport: "in-process"`, e.g. thread-directory) run inside bamf-core and are
// loaded by src/inprocess.js at boot, so they have no process of their own -
// don't add a PM2 entry for them; they start and restart with bamf-core.
//
//   pm2 start ecosystem.config.cjs
//   pm2 logs            # tail output
//   pm2 save            # remember these processes across reboots
//
// The core reads its secrets from a local .env file (gitignored); no external
// tooling is required for unattended restarts.
//
// `pmx: false` disables PM2's built-in pm2.io instrumentation, which throws
// EPIPE on Windows with recent Node and crash-loops the process. We don't use
// pm2.io monitoring, so we turn it off.

module.exports = {
  apps: [
    {
      name: "bamf-core",
      script: "src/index.js",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      pmx: false,
      // The core loads .env itself (see src/config.js) and holds the Discord
      // connection.
    },
    {
      name: "bamf-hello-world",
      script: "node",
      args: ["modules/hello-world/index.js"],
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      pmx: false,
      env: {
        PORT: "8081",
      },
      // Modules hold no Discord secrets. Add BAMF_SHARED_SECRET here (and to the
      // core's env) once you enable it.
    },
  ],
};
