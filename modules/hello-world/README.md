# hello-world module

The first BamfBot module and the reference implementation of the module contract
([MODULE_SPEC.md](../../MODULE_SPEC.md)). It proves the whole path end-to-end:
gateway connection, command registration, the registry, the router, and the
zero-permission install.

## Command

| Command  | Reply  | Options | Permissions |
|----------|--------|---------|-------------|
| `/hello` | public | none    | none        |

`/hello` returns `hello world` in the channel.

## Run it

```
node modules/hello-world/index.js
```

Listens on `http://localhost:8081` (override with `PORT`). No dependencies.

## Endpoints

- `GET /health` -> `{ "status": "ok" }`
- `GET /manifest` -> this module's `manifest.json`
- `POST /invoke` -> `{ "content": "hello world", "ephemeral": false, "allowedMentions": { "parse": [] } }`

## Quick check

```
curl http://localhost:8081/health
curl -X POST http://localhost:8081/invoke -H "content-type: application/json" -d "{}"
```
