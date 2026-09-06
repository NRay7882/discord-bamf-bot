# Module authoring guide

A reference for the options you have when building a BamfBot module. For the
contract mechanics and the step-by-step to add one, see
[MODULE_SPEC.md](../MODULE_SPEC.md). This page is about the *choices* you make.

Everything here is set either in your `manifest.json` (per command) or in the
JSON your `/invoke` returns (per response).

---

## 1. Where the reply shows up: public vs private

Set per command in the manifest with `ephemeral`.

| `ephemeral` | Result |
|-------------|--------|
| `false` | **Public** - the reply is posted in the channel for everyone to see. |
| `true`  | **Private (ephemeral)** - only the person who ran the command sees it; it isn't saved to the channel. |

```json
{ "name": "secret", "description": "Only you see this", "ephemeral": true }
```

Notes:
- The core decides public/private from this manifest flag and locks it in *before*
  calling your module, so it must live in the manifest - a module can't change it
  at response time.
- Private replies are great for anything noisy, personal, or error-prone (config,
  lookups, "your" data). Public replies are for shared results everyone benefits
  from.

---

## 2. How the reply is delivered: instant vs thinking

Set per command in the manifest with `instant`.

| `instant` | Behavior | Use when |
|-----------|----------|----------|
| omitted / `false` (default) | The core **defers** first (Discord shows "BamfBot is thinking...") then edits in your result. | Anything that makes a network call, hits a DB, or could ever take more than ~2 seconds. Safe default. |
| `true` | The core replies **directly** with no "thinking..." step. | Only when your module is reliably fast (pure/local work). |

```json
{ "name": "roll", "description": "Roll a die", "instant": true }
```

The tradeoff: Discord requires *some* acknowledgement within **3 seconds**. A
deferred reply buys you up to 15 minutes to answer; an instant reply must land
inside that 3-second window. If an `instant` command's module is slow or down,
the user gets an error instead of a clean "thinking..." Only mark a command
instant if you're sure it's quick. When in doubt, leave it deferred.

---

## 3. What you can put in a reply

Your `/invoke` returns a Discord message payload. Fields the core understands:

| Field | Type | Notes |
|-------|------|-------|
| `content` | string | Plain text (supports Discord markdown). Capped at **2000 chars** - the core truncates longer text. |
| `embeds` | array | Up to 10 [Discord embed objects](https://discord.com/developers/docs/resources/message#embed-object) for rich, formatted cards. |
| `components` | array | Buttons / select menus (Discord action rows). Advanced - interactive component callbacks aren't wired yet, so use for links/visuals for now. |
| `allowedMentions` | object | Controls who the message may ping. **Defaults to `{ "parse": [] }` (ping nobody).** |
| `ephemeral` | boolean | Informational only - the manifest flag is authoritative (see section 1). Keep it consistent to avoid confusion. |

A response must have **non-empty `content` or at least one embed**, or the core
rejects it.

Minimal text reply:
```json
{ "content": "hello world", "allowedMentions": { "parse": [] } }
```

Embed reply:
```json
{
  "content": "Here you go:",
  "embeds": [{ "title": "Result", "description": "Details here", "color": 5793266 }],
  "allowedMentions": { "parse": [] }
}
```

---

## 4. Mentions (pinging people) - opt in only

By default the core sends `allowedMentions: { "parse": [] }`, so even if your
`content` literally contains `@everyone` or `<@123>`, nobody is pinged (NFR8).
This stops a module from being tricked into mass-pinging a server.

To deliberately ping, opt in:
```json
{ "content": "Heads up <@123>", "allowedMentions": { "users": ["123"] } }
```
`parse` may include `"users"`, `"roles"`, `"everyone"`. Prefer explicit `users`
/ `roles` id lists over `parse` where you can, and never ping `everyone` unless
it is genuinely the point of the command.

---

## 5. Command options (inputs from the user)

Declare inputs in the manifest; the core registers them with Discord and passes
the values to `/invoke` under `options`.

```json
{
  "name": "greet",
  "description": "Greet someone",
  "options": [
    { "name": "who", "description": "Who to greet", "type": "user", "required": true },
    { "name": "loud", "description": "Shout it", "type": "boolean", "required": false }
  ]
}
```

Available `type` values: `string`, `integer`, `number`, `boolean`, `user`,
`channel`, `role`, `mentionable`, `attachment`. For `string`/`integer`/`number`
you can also add `choices` (a fixed menu):
```json
{ "name": "size", "type": "string", "description": "Pick a size",
  "choices": [{ "name": "Small", "value": "s" }, { "name": "Large", "value": "l" }] }
```

At runtime your module receives:
```json
{ "options": { "who": "123456789", "loud": true } }
```
(`user`/`channel`/`role` come through as Discord snowflake id strings.)

---

## 6. Who can run a command

Set `defaultMemberPermissions` in the manifest to restrict a command:

| Value | Meaning |
|-------|---------|
| `null` | Anyone can run it (default). |
| array of permission names | Only members with those guild permissions, e.g. `["ManageGuild"]`. |
| numeric bitfield string | Same, expressed as a raw Discord permission integer. |

```json
{ "name": "purge", "description": "Admin only", "defaultMemberPermissions": ["ManageMessages"] }
```
Server admins can further adjust command access in Discord's UI.

---

## 7. Permissions and intents your module needs

In `manifest.json` under `discord`:
- `botPermissions` - guild permissions the *bot* needs to carry out the command
  (names from discord.js `PermissionFlagsBits`). Most modules need **none**,
  because replying to a slash command doesn't require Send Messages.
- `gatewayIntents` - event streams the bot must subscribe to. Slash commands
  need none. **Avoid privileged intents** (Message Content, Server Members,
  Presence) - they trigger Discord verification once the bot is in 100+ servers.

Keep both as small as possible: the whole bot's install permissions are the
*union* across every module, so one greedy module raises the bar for all servers.
Adding a permission means existing servers must re-authorize with the new install
URL (printed by `npm run deploy`). Call this out in your PR.

---

## 8. Handling latency and failure

- If your work can be slow, keep the command **deferred** (don't set `instant`).
  You have up to 15 minutes after the defer, but be reasonable - the core also
  applies a request timeout (`MODULE_TIMEOUT_MS`, default 8s) and will show the
  user a friendly "not available right now" if you exceed it.
- Return a normal payload for expected "empty" results (e.g.
  `{ "content": "No matches found." }`) rather than an error - errors read as the
  bot being broken.
- If something truly fails, returning a non-200 or malformed JSON makes the core
  show the generic error message and log it with the request id.

---

## 9. Test your module before you PR

Every module response is validated against the exact same contract the live bot
uses. Run the harness:

```
npm test                 # all modules
npm test hello-world     # one module
```

It starts your module, checks `/health`, verifies `/manifest` matches your
committed manifest, and validates every command's `/invoke` output.

Add sample cases and expectations in `modules/<name>/tests.json`:
```json
{
  "greet": [
    { "name": "basic",
      "request": { "options": { "who": "123", "loud": false } },
      "expect": { "contentIncludes": "123", "ephemeral": false } }
  ]
}
```
`expect` supports `content` (exact), `contentIncludes` (substring), and
`ephemeral`. Without a `tests.json`, the harness still runs an auto-generated
call per command and validates the shape of what comes back.

---

## Quick reference

| I want to... | Do this |
|--------------|---------|
| Reply in the channel | `"ephemeral": false` (manifest) |
| Reply privately | `"ephemeral": true` (manifest) |
| Skip the "thinking..." step | `"instant": true` (manifest, fast modules only) |
| Show a rich card | return `embeds: [ ... ]` |
| Ping a user | `allowedMentions: { "users": ["<id>"] }` |
| Take user input | add `options: [ ... ]` (manifest) |
| Limit who can run it | `defaultMemberPermissions` (manifest) |
| Prove it works | `npm test <module>` + a `tests.json` |
