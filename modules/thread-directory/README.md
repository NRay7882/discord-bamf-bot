# thread-directory

Gives threads the visibility Discord doesn't. It keeps a channel continuously
up to date with every open thread in the server - grouped by category - and lets
any member pull that same list privately on demand. Stale entries never
accumulate: the list is rebuilt from what Discord reports live, so a thread or
channel that no longer exists simply drops off.

This is a **first-party, in-process module**. Unlike the HTTP+JSON modules
(`hello-world`), it runs inside the core with direct `discord.js` access, because
it needs to enumerate threads, react to thread/channel events, and maintain
messages on its own - none of which the HTTP module contract exposes. It declares
`"transport": "in-process"` and ships `handler.js` instead of an HTTP server.

## Commands

### `/thread-list` (any member)
Privately returns the grouped thread list.
- `scope`: `all` (default), `category` (this channel's category), or `channel` (this channel only).
- `deliver`: `here` (ephemeral, default) or `dm`.

### `/threads` (admins - requires **Manage Server**)
- `setup channel:<#channel>` - maintain the directory in that channel and build it now.
- `disable` - stop maintaining (leaves the existing messages).
- `refresh` - rebuild immediately.
- `status` - show the current channel and sort settings.
- `help` - worked examples for organizing and displaying the list.
- `sort categories:<custom|alpha|position> threads:<activity|alpha|created>` - ordering.
- `order categories:"Politics, Fun & Games, Health & Exercise, Movies & TV"` - set a custom
  category order by name (also switches category ordering to `custom`).

## How the maintained channel works

1. `/threads setup` records the channel and posts the listing.
2. The module rebuilds (debounced ~5s) on thread create/rename/delete and channel changes,
   plus a safety refresh every 15 minutes and once at startup.
3. It edits its own messages in place when the layout is unchanged, and reposts when it isn't.

Make the channel **read-only for members** (deny Send Messages to `@everyone`) so it stays a
clean, bot-maintained list. The bot keeps write access via its own role.

Set `THREAD_DIRECTORY_REFRESH_MS` to change the safety-refresh interval (default `900000`).

## Permissions

The manifest adds these to the bot's install URL union:
`ViewChannel`, `SendMessages`, `ManageMessages`, `ReadMessageHistory`, `ManageThreads`.

Because this grows the bot's required permissions beyond the earlier `0`, **re-invite the bot
with the new install URL** that `npm run deploy` prints after you add this module. Existing
servers keep working for already-granted permissions, but the directory channel upkeep needs
the ones above.

No privileged gateway intents are required - thread and channel events arrive over the base
`Guilds` intent the core already requests.

## Data

Per-guild config is stored at `data/thread-directory/<guildId>.json` (gitignored):
the directory channel, enabled flag, sort settings, custom category order, and the IDs of the
messages the bot manages. Safe to delete to reset a guild; rerun `/threads setup` afterward.

## Tests

- `npm run test:unit` - unit tests for grouping/sorting/custom order/chunking (`render.js`).
- `node scripts/test-module.js thread-directory` - manifest validation (in-process modules
  skip the HTTP checks).
