# BamfBot

A modular, community-extensible Discord bot. Features are delivered as self-contained **modules** that can be written in **any language** - the bot core routes a slash command to the module that owns it, the module returns a response, and the bot delivers it to Discord (publicly, or privately to the person who ran the command).

> 🚧 **Early development.** The framework and first module are being built. See **[PLAN.md](./PLAN.md)** for the full design, requirements, and roadmap.

## How it works

- **Core** (this repo, JavaScript / [discord.js](https://discord.js.org/)) connects to Discord and acts as a router. It's the only part that talks to Discord.
- **Modules** are small HTTP services that never touch Discord directly - they receive a JSON request and return a JSON response. Any language that can serve HTTP + JSON qualifies.
- A single, maintainer-hosted bot: server admins just authorize BamfBot on their server. Contributors submit modules via pull request; once merged and deployed, every server gets the new command.

```
/hello ─► Discord ─► Core (router) ─► module (HTTP) ─► "hello world" ─► Discord ─► you
```

## Status & roadmap

The near-term goal is a working `/hello` end-to-end (core + first module), then a second module in another language to prove the contract is language-agnostic, followed by a built-in `/help`, error handling, and auto-generated command docs. Full phased plan in **[PLAN.md](./PLAN.md)**.

## Tech

- Node.js + discord.js v14 (ESM) for the core
- Slash commands (no privileged intents required)
- Modules: any language, over an HTTP + JSON contract
- Secrets managed with 1Password (`op`) - never committed

## Contributing

A module spec and contribution guide are coming (see the roadmap in PLAN.md). The short version: a module is a directory under `modules/` with a `manifest.json` (declaring its commands and any permissions) and a small service implementing `GET /health`, `GET /manifest`, and `POST /invoke`.

## License

[MIT](./LICENSE)
