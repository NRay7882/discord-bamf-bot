// PM2 process config for running BamfBot full-time (see docs/HOSTING.md).
// Runs the core and each module as separate, auto-restarting processes.
//
//   pm2 start ecosystem.config.cjs
//   pm2 logs            # tail output
//   pm2 save            # remember these processes across reboots
//
// The core reads its secrets from a local .env file (gitignored); no external
// tooling is required for unattended restarts.

module.exports = {
  apps: [
    {
      name: "bamf-core",
      script: "src/index.js",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
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
      env: {
        PORT: "8081",
      },
      // Modules hold no Discord secrets, so they don't need op. Add
      // BAMF_SHARED_SECRET here (and to the core's env) once you enable it.
    },
  ],
};
