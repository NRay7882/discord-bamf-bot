// PM2 process config for running BamfBot full-time (see docs/HOSTING.md).
// Runs the core and each module as separate, auto-restarting processes, each
// wrapped in `op run` so secrets are injected at runtime and never hit disk.
//
//   pm2 start ecosystem.config.cjs
//   pm2 logs            # tail output
//   pm2 save            # remember these processes across reboots
//
// Requires the 1Password CLI (`op`) on PATH and non-interactive auth
// (OP_SERVICE_ACCOUNT_TOKEN) for unattended restarts - see docs/HOSTING.md.

module.exports = {
  apps: [
    {
      name: "bamf-core",
      script: "op",
      args: ["run", "--env-file=.env", "--", "node", "src/index.js"],
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      // The core needs secrets; op supplies them from .env references.
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
