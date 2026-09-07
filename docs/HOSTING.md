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

**No DNS / no-ip / dynamic DNS needed either.** Because nothing on the internet
connects *in* to reach the bot, BamfBot needs no domain name and no dynamic-DNS
record. That's the opposite of a Minecraft server, where players connect *in* to
your machine and a no-ip hostname is what points them at your changing home IP.
Reuse your no-ip setup for Minecraft; the bot needs none of it. (The only thing
that would change this is a future module that exposes a *public* web page or
uses Discord's HTTP "Interactions Endpoint" instead of the gateway - not the
case today, since modules bind to localhost only.)

---

## Self-hosting on the Windows server (free)

### 1. One-time setup on the server
- Install **Node 24+** (the dev machine uses 26) and **git**.
- Clone the repo and install deps:
  ```
  git clone https://github.com/NRay7882/discord-bamf-bot.git
  cd discord-bamf-bot
  npm install
  ```
- Create `.env` from the example and fill in the real values:
  ```
  copy .env.example .env
  ```
  `.env` is gitignored and holds the real bot token, application ID, and test
  server ID. The bot loads it automatically at startup - no external tooling.

### 2. Keep `.env` safe
`.env` holds the real bot token in plain text, so it is the one file to protect:

- It is **gitignored** - never commit it or paste it anywhere public. A leaked
  token lets anyone drive the bot; if that happens, reset it in the Discord
  developer portal and update `.env`.
- Restrict the folder to the account the bot runs as (default NTFS permissions
  on a single-user home server are usually fine).
- Because the bot reads `.env` directly, unattended restarts after a reboot need
  nothing extra - PM2 relaunches `node`, which reloads `.env` on its own.

### 3. Register the commands (once, and after any command change)
```
npm run deploy
```
Guild-scoped for the test server (instant). Use `npm run deploy:global` for the
public release (propagates in up to ~1 hour). `scripts\update.ps1` runs this for
you automatically whenever a module manifest changes.

### 4. Run it full-time with PM2 (one command)
[PM2](https://pm2.keymetrics.io/) is a free process manager that keeps the core
and modules alive and restarts them on crash, driven by the included
`ecosystem.config.cjs`.

Run the one-time setup script from an **elevated** (Run as Administrator)
PowerShell on the host:

```
.\scripts\service-setup.ps1
```

It checks prerequisites (including that `.env` exists with a real token),
installs `pm2` + `pm2-windows-startup`, starts the core and modules, registers
PM2 to resurrect on boot, and saves the process list.

<details>
<summary>What that runs, if you'd rather do it by hand</summary>

```
npm install -g pm2 pm2-windows-startup
pm2 start ecosystem.config.cjs
pm2-startup install      # register boot-start (needs an elevated shell)
pm2 save                 # remember this process list
pm2 logs                 # watch output
pm2 status               # see the processes
```
</details>

Alternative if you prefer a true Windows service:
[NSSM](https://nssm.cc/) can wrap `node src/index.js` (with the working directory
set to the repo so `.env` is found) as a service, plus one service per module.
PM2 is simpler to start with.

### 5. Living alongside Minecraft
- BamfBot is light (idle: tens of MB RAM, negligible CPU). It won't compete with
  a Minecraft server for resources in any meaningful way.
- Just make sure module ports (8081, etc.) don't collide with anything else on
  the box. Each module has its own port; change it in the module's manifest
  (`runtime.invokeUrl`) and its `PORT`.

### 6. Updating
When new modules or fixes are published, RDP in and run:

```
.\scripts\update.ps1
```

It fast-forwards `git pull`, then does only what the diff actually requires:
`npm install` only if the root lockfile changed, re-deploys slash commands only
if a module manifest changed, and `pm2 restart all` only if runtime code changed
(a docs-only update leaves the bot running untouched). If nothing changed, it
says so and does nothing.

Flags: `-Global` deploys command changes globally instead of guild-scoped;
`-NoDeploy` skips command registration; `-Force` restarts even with no changes.

<details>
<summary>The equivalent manual steps</summary>

```
git pull
npm install          # if package-lock.json changed
npm run deploy       # if a module manifest changed
pm2 restart all      # if code changed
```
</details>

---

## Running dev and prod side by side (one host)

To test changes against a **dev** bot before promoting them to the **prod** bot
that other servers use, run both environments at once on the same machine.

**Two Discord applications.** Dev and prod are separate Discord apps, each with
its own token/ID. The dev bot lives in your test server; the prod bot is the
public one. Testing (restarts, command redeploys, half-built modules) never
touches real users because it's a different bot entirely.

**Two working copies, one PM2 daemon.** Keep a copy of the repo per environment
so each has its own `.env` (dev app creds vs prod app creds) and its own `data/`
directory. A `git worktree` is the tidy way - one repo, two checkouts:

```
# from your existing clone (e.g. C:\bots\bamf), make a prod and a dev worktree
git worktree add ..\bamf-prod main
git worktree add ..\bamf-dev  dev      # a long-lived dev branch
```

`BAMF_ENV` (set for you by the setup/update scripts) selects everything else:

| Environment | PM2 process names | Module ports | Command scope |
|-------------|-------------------|--------------|---------------|
| **prod** (default) | `bamf-core`, `bamf-hello-world`, ... | 8081 / 8082 | global |
| **dev** (`-Env dev`) | `bamf-dev-core`, `bamf-dev-...` | 9081 / 9082 | guild-scoped |

The name prefix keeps the two sets distinct in the shared PM2 daemon; the port
offset (1000 for dev) keeps their modules from colliding. The core reaches only
its own environment's modules - it learns the offset at startup (see
`src/module-url.js`), so dev-core never calls a prod module.

**One-time setup (run each in its own copy, elevated PowerShell):**

```
cd C:\bots\bamf-prod
copy .env.example .env      # fill in the PROD app's token/ID
.\scripts\service-setup.ps1

cd C:\bots\bamf-dev
copy .env.example .env      # fill in the DEV app's token/ID + test server ID
.\scripts\service-setup.ps1 -Env dev
```

**The build -> test -> promote loop:**

1. Build on your Win11 machine; push a feature branch and merge it into `dev`.
2. On the server, update the dev copy and try it with the dev bot in your test
   server:
   ```
   cd C:\bots\bamf-dev
   .\scripts\update.ps1 -Env dev
   ```
   Dev deploys commands guild-scoped, so they appear instantly.
3. When it looks good, promote it: merge `dev` into `main`, then update prod:
   ```
   cd C:\bots\bamf-prod
   .\scripts\update.ps1
   ```
   Prod deploys commands globally (every server the bot is in; up to ~1h to
   propagate). Restricted modules (e.g. `astrogoblin`) are still registered
   per-guild at runtime, so scope them with `BAMF_SCOPE_<MODULE>` in each
   environment's `.env`.

**Handy PM2 targeting** (names are prefixed, so you act on one environment):

```
pm2 status                       # both sets at once
pm2 logs bamf-dev-core           # just the dev core
pm2 restart bamf-dev-astrogoblin # just one dev module
```

If your test server has both bots, you'll see two `/bamf` commands in the
picker (one per app) - pick the dev app's while testing.

### Auto-deploying merged changes (scheduled poll)

Rather than deploy by hand, let the server pull merged changes on a schedule.
Because the box has no inbound ports, it **polls** GitHub instead of GitHub
reaching in: a Windows Scheduled Task runs `update.ps1` every 30 minutes.
`update.ps1` is idempotent - it fast-forwards the branch and only restarts or
redeploys when something actually changed - so a poll that finds nothing does
nothing. Register one task per environment, each from its own working copy:

```
cd C:\bots\bamf-dev
.\scripts\schedule-setup.ps1 -Env dev     # polls the dev branch every 30 min

cd C:\bots\bamf-prod
.\scripts\schedule-setup.ps1              # polls main (prod) every 30 min
```

So a change flows out with no manual step on the server: merge a feature branch
into `dev` -> within 30 min the dev bot has it; promote `dev` into `main` ->
within 30 min the prod bot has it. Change the cadence with `-IntervalMinutes`,
run a poll immediately with `Start-ScheduledTask -TaskName BamfBot-Update-dev`,
and remove a task with `.\scripts\schedule-setup.ps1 -Env dev -Remove`. Each
run appends to `logs\update-<env>.log`.

The task runs as you (S4U logon: no stored password, runs whether or not you're
signed in). It needs `git pull` to succeed unattended, so make sure your git
credentials are cached (the Windows credential manager, or a PAT via a git
credential helper) rather than prompting.

---

## Later: a small cloud host (fly.io or similar)

If it outgrows the home server, the same processes move to a container platform
with a free/cheap tier:

- Containerize the core and modules (a `docker-compose.yml` is on the roadmap).
- Store secrets with the platform's secret manager (e.g. `fly secrets set
  DISCORD_TOKEN=...`); the app reads them straight from the environment.
- No inbound ports needed there either - only the outbound Discord connection.

Stay on the free self-hosted setup until traffic or reliability actually
demands otherwise.
