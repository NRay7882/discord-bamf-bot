# CHANGE-ME module

> Copy this template to `modules/<your-module-name>/` and fill it in.
> Full contract and workflow: [MODULE_SPEC.md](../../MODULE_SPEC.md).

One-paragraph description of what this module does.

## Command

| Command      | Reply           | Options | Permissions |
|--------------|-----------------|---------|-------------|
| `/change-me` | public/private  | ...     | ...         |

## Run it

```
node modules/<your-module-name>/index.js
```

Listens on `http://localhost:<port>` (set `PORT` and `runtime.invokeUrl` to a
port no other module uses). No dependencies in the template; add your own in
`package.json` if you need them.

## Endpoints

- `GET /health` -> `{ "status": "ok" }`
- `GET /manifest` -> this module's `manifest.json`
- `POST /invoke` -> your command response
