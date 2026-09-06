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

## Later: a small cloud host (fly.io or similar)

If it outgrows the home server, the same processes move to a container platform
with a free/cheap tier:

- Containerize the core and modules (a `docker-compose.yml` is on the roadmap).
- Store secrets with the platform's secret manager (e.g. `fly secrets set
  DISCORD_TOKEN=...`); the app reads them straight from the environment.
- No inbound ports needed there either - only the outbound Discord connection.

Stay on the free self-hosted setup until traffic or reliability actually
demands otherwise.
