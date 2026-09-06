# Hosting BamfBot

How to run BamfBot full-time. The near-term target is **self-hosting for free**
on a Windows machine you already run (e.g. a home server that also runs
Minecraft); a cloud option is sketched at the end for later.

## What has to run

BamfBot is a set of long-running processes:

- **the core** (`src/index.js`) - one process, holds the Discord connection.
- **each module** - one process per module (e.g. `modules/hello-world/index.js`).

All of them must be running for a command to work. The core reaches the modules
over `localhost` HTTP; modules never talk to Discord.

**No inbound ports required.** The core makes an *outbound* WebSocket connection
to Discord, and modules listen only on `localhost`. You do **not** need to
port-forward or open the firewall on a home server. Keep module ports bound to
localhost and unexposed.

---

## Self-hosting on the Windows server (free)

### 1. One-time setup on the server
- Install **Node 24+** (the dev machine uses 26), **git**, and the
  **1Password CLI** (`op`).
- Clone the repo and install deps:
  ```
  git clone https://github.com/NRay7882/discord-bamf-bot.git
  cd discord-bamf-bot
  npm install
  ```
- Create `.env` from the example (it holds only `op://` references, no secrets):
  ```
  copy .env.example .env
  ```

### 2. Let `op` work unattended
Interactive `op run` is fine while you're at the keyboard, but a full-time bot
must survive reboots without someone signing in. Use a **1Password Service
Account**:

1. In 1Password, create a Service Account with **read** access to the vault
   holding the `BamfBot-Dev` item.
2. Put its token in the environment the bot runs under:
   ```
   setx OP_SERVICE_ACCOUNT_TOKEN "ops_..."   (then reopen the shell)
   ```
   `op run` then resolves the `op://` references with no interactive sign-in.

> If your 1Password plan doesn't offer service accounts, you can still run
> `op run` in a signed-in terminal session for testing - it just won't come back
> automatically after a reboot. Don't work around this by writing resolved
> secrets into `.env`; that defeats the whole secrets model.

### 3. Register the commands (once, and after any command change)
```
op run --env-file=.env -- npm run deploy
```
Guild-scoped for the test server (instant). Use `npm run deploy:global` for the
public release (propagates in up to ~1 hour).

### 4. Run it full-time with PM2
[PM2](https://pm2.keymetrics.io/) is a free process manager that keeps the core
and modules alive and restarts them on crash. An `ecosystem.config.cjs` is
included.

```
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 logs            # watch output
pm2 status          # see the processes
pm2 save            # remember this process list
```

**Start on boot (Windows):** PM2's `startup` needs a helper on Windows. Either:
- `npm install -g pm2-windows-startup && pm2-startup install`, then `pm2 save`; or
- create a **Task Scheduler** task "At startup" that runs
  `pm2 resurrect` (after a one-time `pm2 save`).

Make sure `OP_SERVICE_ACCOUNT_TOKEN` is set for the account the task runs as, or
the core can't get its token on an unattended restart.

Alternative to PM2 if you prefer a true Windows service:
[NSSM](https://nssm.cc/) can wrap `op run --env-file=.env -- node src/index.js`
as a service, with a second service per module. PM2 is simpler to start with.

### 5. Living alongside Minecraft
- BamfBot is light (idle: tens of MB RAM, negligible CPU). It won't compete with
  a Minecraft server for resources in any meaningful way.
- Just make sure module ports (8081, etc.) don't collide with anything else on
  the box. Each module has its own port; change it in the module's manifest
  (`runtime.invokeUrl`) and its `PORT`.

### 6. Updating
```
git pull
npm install
op run --env-file=.env -- npm run deploy   # only if commands changed
pm2 restart all
```

---

## Later: a small cloud host (fly.io or similar)

If it outgrows the home server, the same processes move to a container platform
with a free/cheap tier:

- Containerize the core and modules (a `docker-compose.yml` is on the roadmap).
- Store secrets with the platform's secret manager (e.g. `fly secrets set
  DISCORD_TOKEN=...`) instead of `op run`, or run a 1Password Connect sidecar.
- No inbound ports needed there either - only the outbound Discord connection.

Stay on the free self-hosted setup until traffic or reliability actually
demands otherwise.
