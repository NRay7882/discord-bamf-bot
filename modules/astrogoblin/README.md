# astrogoblin

Search Astrogoblin videos by the words spoken in them, from Discord. It queries
the fan-made transcript search at
[search.astrogoblin.jammaloo.com](https://search.astrogoblin.jammaloo.com/) and
replies with the matching videos, exact phrase matches favored.

Built for the [Astrogoblin](https://www.patreon.com/c/Astrogoblin) community, so
it ships as a **restricted** module - it appears only in the servers the operator
allows (see below), not in every server the bot is in.

## Command

```
/bamf astrogoblin search query:<words>
```

- `query` (required) - words that were said, e.g. `motor running`.
- The reply is **ephemeral** (only the person who searched sees it).

The reply is a titled message (`Astrogoblin YT Video Search`) plus an embed: an
overall count, a link to the full jammaloo results, and the top videos ranked by
relevance - each with the video title (deep-linked to the matched moment on
YouTube), posted date, match count (and how many are exact), and the first
matching caption. Videos with the exact phrase rank above ones that only matched
loosely (those are flagged `loose match`). The **top result's** YouTube thumbnail
is shown on the embed (an embed has a single image slot).

The search title shows a 🔍 by default. It can instead carry a custom emoji via
`ASTROGOBLIN_TITLE_EMOJI` (see Configuration), shown in the message content since
Discord doesn't render custom emoji in embed titles. **A custom emoji only renders
on servers the bot is a member of** - anywhere else it appears as raw text - so
leave it unset unless the bot is in the emoji's server.

## How it works

- Pure request -> response over the BamfBot module contract (HTTP + JSON); it
  never talks to Discord and needs no bot permissions or gateway intents.
- On `/invoke` it GETs the jammaloo results page, parses it (`parse.js`), and
  formats an embed (`format.js`). Both are Discord-free and unit-tested against
  saved HTML fixtures in `fixtures/`.
- Fetch timeout is 6s (under the core's 8s module timeout); if the site is slow
  or down, it replies with a friendly message and the direct search link.

## Endpoints

- `GET /health` -> `{ "status": "ok" }`
- `GET /manifest` -> this module's `manifest.json`
- `POST /invoke` -> the command response

## Run locally

```
node modules/astrogoblin/index.js      # listens on :8082 (or $PORT)
npm run test:unit                      # parse/format unit tests (offline)
npm test astrogoblin                   # contract check via the harness
```

## Enabling it for a server (operator config, never committed)

The module declares only `"scope": { "restricted": true }` - no guild IDs live in
the repo. Allow it in your server with its guild ID in `.env`:

```
BAMF_SCOPE_ASTROGOBLIN=<astrogoblin-guild-id>
```

(or `bamf.local.json` for name-matching). The core then registers the command
only in that server. See `MODULE_SPEC.md` sections 6-7.

## Configuration

The module reads the repo-root `.env` (like the core), so operator config below
can live there.

| Env var | Default | Meaning |
|---------|---------|---------|
| `PORT` | `8082` | Port the module listens on. |
| `ASTROGOBLIN_TIMEOUT_MS` | `6000` | Timeout for the request to the search site. |
| `ASTROGOBLIN_TITLE_EMOJI` | 🔍 | Overrides the default title emoji with a custom one, as its full token `<:name:id>`. Only renders on servers the bot is a member of (otherwise shows as raw text); an application emoji on the bot's own app renders everywhere. Get a guild emoji's token by typing `\:name:` in Discord and sending. |

## Notes

- Depends on the jammaloo site's current HTML; the fixture-based tests are what
  catch a breaking change in its markup.
- Not affiliated with Astrogoblin or the jammaloo search site; it just links to
  public results.
