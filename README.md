<p align="center">
  <img src="images/bamf.png" alt="BamfBot" width="180">
</p>

<h1 align="center">BamfBot</h1>

<p align="center">
  A modular, community-extensible Discord bot. Features are delivered as
  self-contained <strong>modules</strong> that can be written in <strong>any
  language</strong>.
</p>

---

The bot core routes a slash command to the module that owns it, the module
returns a response, and the bot delivers it to Discord - publicly in the
channel, or privately to the person who ran the command.

```
/hello -> Discord -> Core (router) -> module (HTTP) -> "hello world" -> Discord -> you
```

- **Core** (this repo, JavaScript / [discord.js](https://discord.js.org/)) is the
  only part that talks to Discord. It's a router.
- **Modules** are small HTTP services that never touch Discord - they receive a
  JSON request and return a JSON response. Any language that serves HTTP + JSON
  qualifies.
- A single, maintainer-hosted bot: server admins just authorize BamfBot.
  Contributors submit modules via pull request; once merged and deployed, every
  server gets the new command.

## Documentation

- **[MODULE_SPEC.md](./MODULE_SPEC.md)** - the module contract and how to add one.
- **[docs/AUTHORING.md](./docs/AUTHORING.md)** - options for module authors (public
  vs private replies, instant vs deferred, embeds, mentions, permissions).
- **[docs/HOSTING.md](./docs/HOSTING.md)** - running BamfBot full-time (self-hosted).
- **[docs/COMMANDS.md](./docs/COMMANDS.md)** - auto-generated list of live commands.

---

## Prerequisites

- **Node.js 24+** (developed on 26) and npm.
- A **Discord application** (bot) and a server to test in. You'll put its
  credentials (token, application ID, test server ID) in a local `.env` file.

## Setup

```bash
# 1. Clone and install
git clone https://github.com/NRay7882/discord-bamf-bot.git
cd discord-bamf-bot
npm install

# 2. Create your local env and fill in real values
cp .env.example .env      # Windows: copy .env.example .env
```

`.env` holds your real credentials and is **gitignored** - it is never
committed. Fill in the three values:

```
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
DISCORD_GUILD_ID=your-test-server-id
```

The app loads `.env` automatically at startup, so plain `node` / `npm` commands
pick it up. (Anything already set in the environment wins over the file, so a
secret manager can supply the values instead if you prefer.)

## Run it (local dev)

You need three things: register the commands, start the module, start the core.

```bash
# 1. Register slash commands to your test server (instant, guild-scoped)
npm run deploy

# 2. Start the hello-world module (new terminal) - listens on :8081
npm run module:hello

# 3. Start the core (new terminal)
npm start
```

Then type **`/hello`** in your server - the bot replies "hello world". Try
**`/help`** to see all commands.

> Guild-scoped commands appear instantly. `npm run deploy:global` registers
> globally for release (can take ~1 hour to propagate).

## Test & validate modules

The harness starts each module, checks `/health`, verifies its served
`/manifest` matches the committed one, and validates every command's `/invoke`
output against the exact contract the live bot enforces. No secrets needed.

```bash
npm test                 # all modules
npm test hello-world     # one module
```

## Add a module

1. Copy `templates/module-template/` to `modules/<your-module>/`.
2. Edit `manifest.json`, implement `invoke()`, pick a unique port.
3. `npm test <your-module>` until green.
4. `npm run deploy` and try it in Discord.
5. `npm run docs` to refresh `docs/COMMANDS.md`, then open a PR.

Full details in **[MODULE_SPEC.md](./MODULE_SPEC.md)** and
**[docs/AUTHORING.md](./docs/AUTHORING.md)**.

## Useful scripts

| Command | What it does |
|---------|--------------|
| `npm start` | Run the core. |
| `npm run deploy` | Register commands to the test guild (instant). |
| `npm run deploy:global` | Register commands globally (release). |
| `npm test [module]` | Validate module(s) against the contract. |
| `npm run docs` | Regenerate `docs/COMMANDS.md`. |
| `npm run docs:check` | Fail if `docs/COMMANDS.md` is stale (CI). |
| `npm run avatar` | Set the bot's Discord avatar to `images/bamf.png`. |

## Running full-time

See **[docs/HOSTING.md](./docs/HOSTING.md)** for self-hosting on a Windows server
with PM2 (no inbound ports required).

## License

[MIT](./LICENSE)
