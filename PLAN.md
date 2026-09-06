# BamfBot - Project Plan

> **Status:** Decisions locked · repo initialized · Discord app live · ready to build the core.
> **Owner:** NRay7882 · **Repo:** `discord-bamf-bot` · **Dev application:** `BamfBot-Dev`
> **Read me first:** §0 (current status & next steps). The rest is the full design of record.

---

## 0. Current status & next steps

**Done**
- Toolchain: Node 26.8.1 (Current line), npm 11.19.0, Git, GitHub CLI (authed to `NRay7882`), VS Code.
- Discord application **`BamfBot-Dev`** created; bot token reset.
- Privileged Gateway Intents left **OFF** (slash commands need none).
- Test/personal server created; bot **already added** to it.
- Secrets stored in **1Password** item `BamfBot-Dev` (application ID, public key, token, server ID, install URL). `op` CLI available for runtime injection.
- Local repo `discord-bamf-bot` initialized (`git init`).

**Doing now**
- Add `PLAN.md`, `README.md`, `.gitignore` (+ `LICENSE`, `.gitattributes`); first commit; create + push the GitHub remote via `gh`.

**Next (in Claude Code)** - first milestone is a working `/hello`:
1. Scaffold the JS core (ESM): `package.json`, `src/index.js` (gateway login), `src/registry.js`, `src/deploy-commands.js`, `src/router.js`, `src/help.js`, `src/errors.js`.
2. Build the **hello-world** module (JavaScript for milestone 1) as an HTTP service exposing `/health`, `/manifest`, `/invoke`.
3. Wire `.env` with `op://` references; run the core with `op run -- node src/index.js`.
4. Register commands **guild-scoped** (instant) against the test server, start core + module, confirm `/hello` replies "hello world" end-to-end.
5. Then add a second trivial module in **Python** to prove the language-agnostic contract, and build out `/help`, error handling, and the docs generator.

Everything below is the design Claude Code should build against.

---

## 1. Vision & summary

A single, **maintainer-hosted** Discord bot whose features are delivered as independent **modules**. Each module is a self-contained app that can be written in **any language**, is triggered by a **slash command**, processes the request, and returns a response the bot delivers to Discord - publicly in the channel, or privately (ephemerally) to the person who ran the command.

The key split that makes "any language" possible:

- **The Core** talks to Discord (the hard part: gateway, interactions, permissions). One language - **JavaScript / discord.js**.
- **Modules** hold the feature logic and never touch Discord directly. They just answer an HTTP request with JSON. Any language that serves HTTP + JSON qualifies.

The Core is a **router**: slash command comes in → find the module that owns it → call it → relay its answer to Discord. Contributors write and submit modules; once approved and merged, the maintainer deploys them to the shared backend, and every server the bot is in gets the new command.

---

## 2. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Deployment model | **Shared, maintainer-hosted (multi-tenant)** | One Discord app, one backend the owner runs. Admins just authorize the bot on their server - they host nothing. |
| Core language | **JavaScript + discord.js v14** (ESM) | Largest Discord ecosystem, best docs, easiest first-time path. Contributors still write modules in any language. |
| Runtime | **Node.js 26** (Current) | Installed and working. Note: 26 is the *Current* line, not LTS - see §9 if pinning to an LTS later matters for contributors. |
| Command style | **Slash commands only** | Zero privileged intents, self-documenting, and the only style that supports clean **ephemeral (private)** replies - so we can do both public and private responses. |
| Module transport | **HTTP + JSON** | Every language can serve it; lowest friction for contributors. |
| Secrets | **1Password + `op run`** (`op://` references) | Real token never written to disk. |
| License | **MIT** | Maximizes contribution and reuse. |
| First module language | **JavaScript** (milestone 1), then **Python** as polyglot proof | Fastest path to a green `/hello`, then prove the contract is language-agnostic. |

**Why prefix/mention were rejected:** prefix commands (`!hello`) require the **Message Content privileged intent** - a read-everything permission that contradicts the least-privilege goal and needs Discord approval past 100 servers. Mention commands avoid that but can't send in-channel ephemeral replies. Slash commands give both public and private replies with no privileged intents.

---

## 3. Requirements

### 3.1 Functional
- **FR1** - Core connects to Discord and receives slash-command interactions.
- **FR2** - Modules are self-contained services callable over a defined HTTP + JSON contract (§4.3).
- **FR3** - Modules may be written in any language; the only requirement is serving the contract.
- **FR4** - Each module ships a **manifest** declaring its commands, options, required permissions/intents, and who may invoke each command.
- **FR5** - The framework registers slash commands with Discord from the manifests (guild-scoped in dev, global in prod).
- **FR6** - The framework routes an invocation to the correct module and relays its response to Discord.
- **FR7** - Responses can be **public** (channel) or **ephemeral** (private to the invoker), per command/module.
- **FR8** - **Least privilege:** the framework computes the minimal OAuth scopes, permission bitfield, and gateway intents from all modules, and generates the correct install URL from that union (§4.4).
- **FR9** - Built-in **`/help`** lists available commands with examples; `/help command:<name>` shows detail. Sourced from the manifests.
- **FR10** - Graceful handling when a command's module is unavailable, always pointing the user to `/help`.
- **FR11** - Auto-generate a `docs/COMMANDS.md` (and a publishable page) from the manifests, kept in sync via CI.
- **FR12** - A **hello-world** module returns "hello world" publicly, exercising the entire path end-to-end.
- **FR13** - Respect Discord's 3-second acknowledgement rule via deferral for slower modules (§4.5).

### 3.2 Non-functional
- **NFR1** - Contributor-friendly: minimal boilerplate to add a module; a scaffold template is provided.
- **NFR2** - Cross-platform dev on Windows 11 and macOS (Apple Silicon / M5).
- **NFR3** - Secrets never committed; injected at runtime via 1Password + `op`.
- **NFR4** - Module isolation: a crashing or slow module must not take down the core or sibling modules.
- **NFR5** - Setup reproducible by a Discord newcomer.
- **NFR6** - Contributions go through PRs with CI validation (manifest schema, docs freshness, lint).
- **NFR7** - Basic observability: structured logging of invocations and errors, with a request ID.
- **NFR8** - **Security:** sanitize echoed content; default `allowed_mentions` to none so the bot can't be tricked into pinging `@everyone` (§4.8).

---

## 4. Architecture

### 4.1 High-level flow

```
   User in Discord
        │  /hello
        ▼
   Discord Gateway ──(interaction)──►  BOT CORE  (JavaScript / discord.js)
                                          │  1. look up "hello" in the Registry
                                          │  2. defer if the module may be slow
                                          │  3. POST /invoke  ─────────────┐
                                          │                                 ▼
                                          │                     HELLO-WORLD MODULE
                                          │                     (any language, HTTP)
                                          │   {content, ephemeral, ...}     │
                                          ◄─────────────────────────────────┘
        ┌─────────────────────────────────┘
        ▼
   Discord  ──(interaction response)──►  message shown to the user
```

### 4.2 Component responsibilities
- **Gateway client** - logs into Discord, receives interactions. (discord.js.)
- **Registry** - loads all module manifests at startup; single source of truth for "what commands exist and who owns them." Powers command registration, `/help`, and the docs generator.
- **Router** - maps an incoming command to a module, calls it over HTTP, turns the JSON into a Discord reply. Handles deferral, timeouts, and errors.
- **Permissions resolver** - computes the least-privilege union across modules → the install URL + the gateway intents to request (§4.4).
- **Help system** - the built-in `/help` command (§4.6).
- **Deploy-commands script** - pushes command definitions to Discord (guild in dev, global in prod).
- **Docs generator** - turns manifests into `docs/COMMANDS.md` / a docs page (§4.7).

### 4.3 The module contract
Two parts: a **static manifest** (committed, reviewed on PR) and a **runtime HTTP interface**.

**A) Manifest - `modules/<name>/manifest.json`:**
```json
{
  "name": "hello-world",
  "version": "0.1.0",
  "description": "Replies with 'hello world'.",
  "language": "javascript",
  "runtime": { "invokeUrl": "http://hello-world:8081" },
  "commands": [
    {
      "name": "hello",
      "description": "Get a friendly hello world",
      "options": [],
      "ephemeral": false,
      "defaultMemberPermissions": null
    }
  ],
  "discord": {
    "oauthScopes": ["bot", "applications.commands"],
    "botPermissions": [],
    "gatewayIntents": []
  }
}
```

**B) Runtime HTTP interface - every module exposes three endpoints:**
- `GET /health` → `{ "status": "ok" }`
- `GET /manifest` → returns the manifest (self-describe; lets the core validate at boot)
- `POST /invoke` → the actual call.

Request the core sends:
```json
{
  "requestId": "uuid",
  "command": "hello",
  "subcommand": null,
  "options": {},
  "invoker": { "id": "123", "username": "nray", "displayName": "NRay" },
  "context": { "guildId": "...", "channelId": "...", "locale": "en-US" }
}
```

Response the module returns:
```json
{
  "content": "hello world",
  "ephemeral": false,
  "embeds": [],
  "components": [],
  "allowedMentions": { "parse": [] }
}
```

A contributor implements one POST handler and they're done. `allowedMentions.parse: []` = "ping nobody" by default (§4.8).

### 4.4 Permissions & least privilege (shared-bot model)
In a shared bot, **all approved modules are available to all servers**, so an admin authorizing the bot grants the **union of every module's required permissions**. Least privilege therefore means keeping that whole-bot union as small as possible.

What that means concretely today:
- **Slash commands need no privileged intents.** The Message Content / Server Members / Presence intents stay **OFF**. This is the single biggest least-privilege win and keeps the 100-server verification path (see below) painless.
- **`/hello` needs zero bot permissions.** The initial reply to a slash command is delivered over a special interaction webhook and does **not** require Send Messages. So the current install permission integer is **0**.
- **Command registration is global in production** (so every server sees the commands) and **guild-scoped in development** (instant updates on the test server).
- **The 100-server gate:** once the bot is in 100+ servers, Discord requires verification and approval for any *privileged* intents it uses. Because we use none, this stays smooth. Introducing a module that needs a privileged intent is a deliberate decision with that approval cost attached.
- **When a future module needs a new (non-privileged) bot permission**, the resolver grows the install permission integer; existing servers' admins re-authorize with the new URL, or a server admin grants the bot's role that permission. Document this per module.
- **Per-guild module enable/disable** (letting a server turn specific modules off) is a **future** feature - it needs a datastore. v1: all modules available everywhere.

Each manifest still declares exactly what it needs (`botPermissions`, `gatewayIntents`, `defaultMemberPermissions`); the resolver unions them, generates the install URL, and configures the client intents from that union.

### 4.5 Interaction timing (a real gotcha)
Discord requires a response **within 3 seconds**, or a **deferred** acknowledgement first and a follow-up **within 15 minutes**. Rule:
- Instant module (like hello-world) → reply directly.
- Possibly-slow module → the core **defers** ("thinking…"), calls the module, then edits the deferred reply.
- Module HTTP calls get a sane timeout; on timeout, edit the reply with a friendly failure and log it.

### 4.6 Help & unknown-command handling
Slash commands are picked from a validated menu, so a truly "unknown" command basically can't be sent. The cases we still handle:
- **`/help`** - built into the core, generated from the Registry: every command + one-line description + example. `/help command:<name>` shows options/usage. This is the "how do I see what's available" answer (FR9).
- **Module down / unregistered** - the router replies "That command isn't available right now - try `/help`" and logs it.
- **Stale global command** (registered, module later removed) - same graceful handling.

No prefix/mention parsing (decided against - §2).

### 4.7 Publishing the command list
One source of truth (the manifests) feeds both the live bot and the docs:
- **Runtime:** `/help` reads the Registry.
- **Repo:** `scripts/generate-docs.js` reads every manifest → writes `docs/COMMANDS.md` (and optionally JSON a website can consume).
- **CI:** regenerate and diff - fail the PR if `COMMANDS.md` is stale. Optionally publish to **GitHub Pages** on merge.

### 4.8 Security notes
- **Mentions:** default `allowed_mentions` to `{ parse: [] }` so an echoed message can never ping `@everyone`, `@here`, roles, or arbitrary users unless a module explicitly opts in.
- **Secrets:** injected at runtime via `op run` with `op://` references; real token never written to disk. Commit only `.env.example` (references, no secrets).
- **Module isolation:** wrap every module call in try/catch + timeout so one bad module can't crash the core.
- **Input/length:** trim and length-limit echoed content to Discord's 2000-char message limit; validate module responses against a schema before sending.
- **(Shared-backend hardening)** add a shared secret / signature between core and modules so only the core can invoke them.

---

## 5. Repository layout (JavaScript, single hosted backend)

```
discord-bamf-bot/
├── README.md
├── PLAN.md                     # this file
├── LICENSE                     # MIT
├── .gitignore
├── .gitattributes              # "* text=auto eol=lf"  (Win/Mac line-ending peace)
├── .env.example                # op:// references only - NO real secrets
├── package.json                # ESM ("type": "module"), discord.js dep
├── src/                        # the bot core
│   ├── index.js                # entrypoint: gateway client + login
│   ├── registry.js             # load + validate module manifests
│   ├── router.js               # interaction → module HTTP → reply (defer/timeout)
│   ├── permissions.js          # least-privilege union + install-URL generator
│   ├── help.js                 # /help command
│   ├── deploy-commands.js      # register slash commands (guild/global)
│   └── errors.js               # global error + unavailable-command handling
├── modules/
│   └── hello-world/            # first module (JS for milestone 1)
│       ├── manifest.json
│       ├── index.js            # serves /health, /manifest, /invoke
│       ├── package.json
│       └── README.md
├── scripts/
│   └── generate-docs.js
├── docs/
│   └── COMMANDS.md             # AUTO-GENERATED - do not edit by hand
├── docker-compose.yml          # run core + modules together locally (later)
└── .github/
    └── workflows/
        └── ci.yml              # lint + manifest schema + COMMANDS.md freshness
```

Modules are self-contained services (own deps, own runtime). Locally, run the core and each module as separate processes (or `docker-compose up`). In production they run behind the core on the maintainer's backend.

---

## 6. The hello-world module (first build spec)
- **Command:** `/hello` - public reply, no options, no special permissions.
- **Manifest:** as in §4.3 (`botPermissions: []`, `gatewayIntents: []`).
- **Service:** tiny HTTP app exposing `/health`, `/manifest`, `/invoke`. `/invoke` returns `{"content":"hello world","ephemeral":false,"allowedMentions":{"parse":[]}}`.
- **Success criteria:** run the module, run the core, type `/hello` in the test server, see "hello world." That single round-trip validates the gateway connection, command registration, the registry, the router, the module contract, and the zero-permission install - the whole skeleton.
- **Then:** duplicate the idea as a Python module (`/hello-py` or similar) to prove the contract is language-agnostic.

---

## 7. Environment & secrets

### 7.1 Already set up
Node 26.8.1 / npm 11.19.0, Git, GitHub CLI (authed), VS Code, the `BamfBot-Dev` Discord app, the test server, the bot added to it, and secrets in 1Password.

### 7.2 Secrets via 1Password + `op`
Store no real secrets in the repo. Use a committed `.env.example` (and a local, git-ignored `.env`) containing **`op://` references** that `op run` resolves at runtime. Adjust the vault name and field labels to match your `BamfBot-Dev` item:
```
DISCORD_TOKEN=op://<vault>/BamfBot-Dev/<token-field>
DISCORD_CLIENT_ID=op://<vault>/BamfBot-Dev/<application-id-field>
DISCORD_GUILD_ID=op://<vault>/BamfBot-Dev/<server-id-field>
```
Run everything through `op`:
```
op run --env-file=.env -- node src/index.js
op run --env-file=.env -- node src/deploy-commands.js
```
The real values are injected into the process; nothing sensitive touches disk.

### 7.3 Local run + test loop
1. `op run --env-file=.env -- node src/deploy-commands.js` - register `/hello` to the test server (instant, guild-scoped).
2. Start the module: `node modules/hello-world/index.js` (listens on :8081).
3. Start the core: `op run --env-file=.env -- node src/index.js`.
4. In the test server, type `/hello` → bot replies "hello world."
Guild commands update instantly; restart the core after changes (or add a watcher).

### 7.4 Guild vs global commands
- **Guild-scoped** - appear instantly in one server → development.
- **Global** - available in every server the bot joins, up to ~1 hour to propagate → release.

### 7.5 Keeping Win11 and Mac in sync
- Drive everything through `npm run <script>` (and/or `docker-compose`) so both machines use identical entrypoints regardless of shell.
- `.gitattributes` (`* text=auto eol=lf`) avoids CRLF/LF churn.

---

## 8. Task breakdown (phased)

### Phase 0 - Repo & planning  (finishing now)
- [x] `git init` locally.
- [ ] Add `PLAN.md`, `README.md`, `.gitignore`, `LICENSE`, `.gitattributes`; first commit.
- [ ] `gh repo create NRay7882/discord-bamf-bot --source=. --public --push`.

### Phase 1 - Discord app + local env  (done)
- [x] Create the `BamfBot-Dev` application; capture token, application ID.
- [x] Create a test server; capture server ID.
- [x] Store all credentials in 1Password.
- [x] Install Node 26, Git, gh, VS Code.
- [x] Generate the zero-permission install URL and add the bot to the test server.

### Phase 2 - Core skeleton  ← start here in Claude Code
- [ ] `package.json` (ESM, discord.js v14) + `src/index.js` gateway login.
- [ ] `src/registry.js` loads + validates module manifests.
- [ ] `src/deploy-commands.js` registers guild-scoped commands.
- [ ] `src/router.js` dispatches interaction → module HTTP call → reply.
- [ ] `src/errors.js` global error handling + deferral support.

### Phase 3 - Hello-world module
- [ ] `manifest.json` (`/hello`, public, no perms).
- [ ] HTTP service with `/health`, `/manifest`, `/invoke`.
- [ ] Wire into the registry; verify `/hello` end-to-end.
- [ ] Add a Python module as the polyglot proof.

### Phase 4 - Help, errors, docs
- [ ] `/help` from the registry (list + per-command detail).
- [ ] Unavailable-command handling.
- [ ] `scripts/generate-docs.js` → `docs/COMMANDS.md`.

### Phase 5 - Least-privilege permissions
- [ ] `src/permissions.js` computes the union bitfield / intents / scopes.
- [ ] Install-URL generator (script or admin command).
- [ ] Per-command `default_member_permissions`.
- [ ] Document the re-authorization flow when the module set changes.

### Phase 6 - Contribution & CI
- [ ] `MODULE_SPEC.md` + `templates/module-template/`.
- [ ] `CONTRIBUTING.md` (how to propose a module, the PR/approval process).
- [ ] GitHub Actions: lint + manifest schema validation + `COMMANDS.md` freshness.
- [ ] `docker-compose.yml` to run core + modules locally.

### Phase 7 - Productionize
- [ ] Global command registration.
- [ ] Choose a host for the backend + secrets management in prod.
- [ ] Datastore for per-guild module toggles / config.
- [ ] Bot verification once approaching 100 servers.
- [ ] Publish `docs/COMMANDS.md` to GitHub Pages on merge.

---

## 9. Decisions log & remaining open items

**Locked:** shared/maintainer-hosted bot · JavaScript + discord.js v14 (ESM) · slash commands only · HTTP+JSON modules · 1Password+`op` secrets · MIT license · hello-world in JS then a Python module.

**Still open (not blocking milestone 1):**
- **Backend hosting target** for production (VPS vs. container platform) - TBD.
- **Datastore** for per-guild config / module toggles - deferred to Phase 7.
- **LTS pin:** Node 26 is the *Current* line; consider pinning contributors to an LTS (24, or the unified-LTS releases from Node 27+) once the project has outside contributors. Non-blocking.
- **CI specifics** (linter choice, schema tool) - decide in Phase 6.
- **Inter-service auth** between core and modules on the shared backend - Phase 5/6.

---

## 10. Glossary (Discord terms)
- **Application / Bot** - your entry in the Developer Portal; the bot user is part of it.
- **Token** - the bot's password. Secret. Injected via `op`, never committed.
- **Application (Client) ID** - public identifier for your app; used when registering commands.
- **Public Key** - used to verify requests if you ever adopt the HTTP-interactions model.
- **Guild** - Discord's internal word for a **server**.
- **Slash command** - a `/command` users pick from a validated menu.
- **Interaction** - the event Discord sends when someone uses a command/button/etc.
- **Ephemeral message** - a reply only the invoker can see (private); interaction-only.
- **Defer / ACK** - acknowledging within 3s ("thinking…") so you can reply within 15 min.
- **Gateway** - the persistent WebSocket connection the bot keeps open to Discord.
- **Intents** - which event types the bot receives; **privileged** ones need portal opt-in (we use none).
- **OAuth2 scopes** - what the bot is authorized to do at install (`bot`, `applications.commands`).
- **Permission bitfield** - the numeric set of guild permissions requested in the install URL (currently `0`).
- **`default_member_permissions`** - controls who may invoke a given command.
