// BamfBot module template (JavaScript, zero dependencies).
//
// To make a new module:
//   1. Copy templates/module-template/ to modules/<your-module-name>/
//   2. Edit manifest.json (name, description, command(s), any permissions).
//   3. Pick a unique port in runtime.invokeUrl and PORT below.
//   4. Implement invoke() - that is the only logic you must write.
//
// The three endpoints below are the module contract (see MODULE_SPEC.md);
// leave them as-is unless you know you need to change them.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8090); // pick a unique port per module

const SHARED_SECRET = process.env.BAMF_SHARED_SECRET ?? null;
const manifest = JSON.parse(await readFile(join(__dirname, "manifest.json"), "utf8"));

// ---- Your logic goes here. ---------------------------------------------------
// request = { requestId, command, subcommand, options, invoker, context }
// Return a Discord message payload. content is capped at 2000 chars by the core.
function invoke(request) {
  const text = request.options?.text;
  return {
    content: text ? `You said: ${text}` : "Hello from the module template.",
    ephemeral: false,
    allowedMentions: { parse: [] }, // ping nobody by default (keep this)
  };
}
// -----------------------------------------------------------------------------

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, { status: "ok" });
    }
    if (req.method === "GET" && req.url === "/manifest") {
      return sendJson(res, 200, manifest);
    }
    if (req.method === "POST" && req.url === "/invoke") {
      if (SHARED_SECRET && req.headers["x-bamf-secret"] !== SHARED_SECRET) {
        return sendJson(res, 401, { error: "unauthorized" });
      }
      const request = await readBody(req);
      return sendJson(res, 200, invoke(request));
    }
    return sendJson(res, 404, { error: "not found" });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`[${manifest.name}] listening on http://localhost:${PORT}`);
});
