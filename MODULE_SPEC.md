# BamfBot module spec

A **module** is a self-contained feature. It never talks to Discord - it just
answers HTTP requests with JSON. Any language that can serve HTTP + JSON
qualifies. The core routes a slash command to the module that owns it, calls it,
and relays the response to Discord.

This document is the contract and the step-by-step for adding a new module.

---

## 1. Anatomy of a module

Every module is one directory under `modules/<name>/`:

```
modules/<name>/
├── manifest.json     # what commands this module owns + what it needs (reviewed on PR)
├── index.js          # the service: /health, /manifest, /invoke  (any language)
├── package.json      # module's own deps (or requirements.txt, go.mod, ... )
└── README.md         # what it does, how to run it, its endpoints
```

The directory name, the `name` in the manifest, and each command name must be
unique across the whole repo. The core refuses to start if two modules claim the
same command.

### Everything is a subcommand of `/bamf`

You declare commands normally, but the core does **not** register them as
top-level slash commands. It rolls every module's commands up under a single
`/bamf` command, so users type `/bamf <your-command>`:

- A command with no subcommands (like `hello`) becomes `/bamf hello`. Its
  options ride along: `/bamf roll <sides>`.
- A command whose options are subcommands (like `threads`) becomes a subcommand
  group: `/bamf threads list`, `/bamf threads setup`, and so on.

This is transparent to your module - the `/invoke` request still reports your
`command` and `subcommand` names exactly as before. Two consequences to know:

- **Nesting depth.** Discord allows at most `/bamf <command> <subcommand>`. Your
  command may hold subcommands, but not subcommand *groups* (that would be a
  fourth level). The core rejects a too-deep manifest at load with a clear error.
- **`help` is reserved** by the core (it owns `/bamf help`).
- **Per-command permission gating** is done with the `access` block (section 4.8),
  enforced by the core at invocation. Discord's own `default_member_permissions`
  only applies to a top-level command, and there's just one (`/bamf`), so a gated
  command still appears in the picker and is refused on use (section 7).

---

## 2. The manifest (`manifest.json`)

Committed and reviewed on every PR. It is the single source of truth for
command registration, `/help`, the docs, and the least-privilege install URL.

```json
{
  "name": "hello-world",
  "version": "0.1.0",
  "description": "Replies with 'hello world'.",
  "language": "javascript",
  "runtime": { "invokeUrl": "http://localhost:8081" },
  "commands": [
    {
      "name": "hello",
      "description": "Get a friendly hello world",
      "options": [],
      "ephemeral": false
    }
  ],
  "discord": {
    "oauthScopes": ["bot", "applications.commands"],
    "botPermissions": [],
    "gatewayIntents": []
  }
}
```

**Fields**

| Field | Meaning |
|-------|---------|
| `name` | Unique module id (kebab-case). |
| `version` | Semver string. |
| `description` | One line, shown in the docs. |
| `language` | Informational (e.g. `javascript`, `python`). |
| `runtime.invokeUrl` | Base URL the core calls. Each module needs a unique port locally. |
| `commands[]` | The slash commands this module owns. |
| `discord.oauthScopes` | OAuth scopes. Almost always just `bot` + `applications.commands`. |
| `discord.botPermissions` | Guild permission names (from discord.js `PermissionFlagsBits`). Keep empty if you can. |
| `discord.gatewayIntents` | Intent names (from discord.js `GatewayIntentBits`). Avoid **privileged** intents (Message Content, Server Members, Presence) - they trigger Discord verification past 100 servers. |

**Command fields**

| Field | Meaning |
|-------|---------|
| `name` | Command name (`1-32` chars, letters/numbers/hyphen). |
| `description` | Shown in the Discord picker and `/help`. |
| `options[]` | See option types below. Omit or `[]` for none. |
| `ephemeral` | `true` = reply is private to the invoker; `false` = posted in the channel. |
| `access` | Optional `{ "permissions": [...], "roles": [...] }` restricting who may run the command. Omit for everyone. Also allowed on an individual subcommand. See section 7. |

**Option types:** `string`, `integer`, `boolean`, `number`, `user`, `channel`,
`role`, `mentionable`, `attachment`. Each option is
`{ "name", "description", "type", "required": true|false, "choices": [...] }`
(`choices` optional; entries may be scalars or `{ "name", "value" }`).

---

## 3. The runtime interface

Every module, in any language, exposes exactly three endpoints.

**`GET /health`** ->
```json
{ "status": "ok" }
```

**`GET /manifest`** -> returns the module's manifest verbatim (lets the core
self-validate at boot).

**`POST /invoke`** -> the actual call. The core sends:
```json
{
  "requestId": "uuid",
  "command": "hello",
  "subcommand": null,
  "options": { "text": "hi" },
  "invoker": { "id": "123", "username": "nray", "displayName": "NRay" },
  "context": { "guildId": "...", "channelId": "...", "locale": "en-US" }
}
```

The module returns a Discord message payload:
```json
{
  "content": "hello world",
  "ephemeral": false,
  "embeds": [],
  "components": [],
  "allowedMentions": { "parse": [] }
}
```

Rules the core enforces so a module can't misbehave:
- `content` is capped at Discord's 2000 characters (truncated if longer).
- A response with neither `content` nor `embeds` is rejected.
- `allowedMentions` defaults to `{ "parse": [] }` (ping nobody). Only set it if
  you deliberately need to mention someone.
- The actual public/private choice is fixed by the command's `ephemeral` flag in
  the manifest (the core defers the reply before calling you), so it must match.

**Optional shared secret:** if the core runs with `BAMF_SHARED_SECRET`, it sends
that value as the `x-bamf-secret` header. A module may reject calls that don't
match. Recommended once modules run on a shared backend.

---

## 4. Add a new module (the publishing pattern)

1. **Scaffold** - copy the template:
   ```
   cp -r templates/module-template modules/<your-module-name>
   ```
2. **Fill in `manifest.json`** - set `name`, `description`, the command(s), and
   only the permissions/intents you actually need. Pick a `runtime.invokeUrl`
   port no other module uses.
3. **Implement `invoke()`** in `index.js` (or write the service in your language
   of choice, keeping the three endpoints).
4. **Run it locally** and smoke-test:
   ```
   node modules/<your-module-name>/index.js
   curl http://localhost:<port>/health
   curl -X POST http://localhost:<port>/invoke -H "content-type: application/json" -d "{}"
   ```
5. **Register commands** against the test server (guild-scoped, instant):
   ```
   npm run deploy
   ```
6. **Run the core** and try the command in Discord:
   ```
   npm start
   ```
7. **Regenerate the docs** (CI will fail if you skip this):
   ```
   npm run docs
   ```
8. **Open a PR.** Once reviewed and merged, the maintainer deploys the module to
   the shared backend and every server the bot is in gets the new command.

### If your module needs a new bot permission
Adding a non-privileged `botPermissions` entry grows the whole-bot install
permission integer. Existing servers' admins re-authorize with the new install
URL (printed by `npm run deploy`), or a server admin grants the bot's role that
permission. Call this out in your PR and the module README. Adding a
**privileged** intent is a deliberate, maintainer-level decision because of the
100-server verification cost - discuss it first.

---

## 5. Checklist before you open a PR

- [ ] Directory, module `name`, and command name(s) are unique.
- [ ] `manifest.json` validates (the core loads it without error).
- [ ] `/health`, `/manifest`, `/invoke` all respond.
- [ ] Permissions/intents are the minimum the module needs (ideally none).
- [ ] `npm run docs` was run and `docs/COMMANDS.md` is committed.
- [ ] Module `README.md` documents the command(s), port, and any permissions.
- [ ] A server-specific module declares only `"scope": { "restricted": true }` -
      no guild IDs or names in the committed manifest (section 6).
- [ ] Any `access` block lists valid permission names / role names (section 7).

---

## 6. Availability: universal vs server-specific modules

By default a module is **universal** - registered in the global `/bamf` command,
usable in every server. A module meant for one community declares itself
**restricted**:

```json
"scope": { "restricted": true }
```

A committed manifest **must not** name the servers (the core rejects
`scope.guildIds` / `scope.guildNames` in a manifest). Server identifiers live
only in the operator's gitignored config, so a public repo never carries anyone's
guild IDs, and a fork points a module at its own server:

- **`.env`** - `BAMF_SCOPE_<MODULE>=<guildId>,<guildId>` (module name upper-cased,
  non-alphanumerics as `_`). Also `BAMF_DISABLED_MODULES=<name>,<name>` to turn
  modules off.
- **`bamf.local.json`** (gitignored; see `bamf.local.example.json`) - richer
  config: server-name matching, per-module enable/disable, and per-guild role-ID
  overrides for access gating.

The core registers a restricted module **per guild**, only where the operator
allowed it (matched by guild ID, or by name as a convenience - names are mutable
and non-unique, so IDs are canonical). A restricted module with no allowlist is
available in no server. `/bamf help` and the docs only show what a server can use.

## 7. Access: who may run a command

Add an `access` block to a command (or an individual subcommand) to restrict it.
Omit it and the command is open to everyone (the default).

```json
{ "name": "purge", "description": "Clear messages",
  "access": { "permissions": ["ManageMessages"], "roles": ["Moderator"] } }
```

- `permissions` - Discord permission names (from `PermissionFlagsBits`);
  `["Administrator"]` is "admin-only". Admins satisfy any permission automatically.
- `roles` - role **names**, matched case-insensitively (portable, but names are
  mutable). For precise or private role gating, an operator maps the command to
  role **IDs** per guild in `bamf.local.json`.
- A caller passes if they have **any** listed permission **or** an allowed role.
- A command's `access` is a floor; a subcommand's `access` narrows it further
  (both must pass). To gate only one subcommand, leave the command open and add
  `access` to that subcommand.

The core enforces this before calling the module, so a module never re-checks it.
Because Discord's per-command permission setting can't reach a subcommand of
`/bamf`, a gated command still shows in the picker and is refused on use.
