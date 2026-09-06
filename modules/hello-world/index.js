// hello-world module (section 6). A self-contained HTTP service that never
// touches Discord: it just answers the BamfBot module contract (section 4.3).
//
//   GET  /health   -> { "status": "ok" }
//   GET  /manifest -> this module's manifest.json (self-describe at boot)
//   POST /invoke   -> the actual command response
//
// Run:  node modules/hello-world/index.js   (listens on :8081, or $PORT)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8081);

// Optional shared-secret check: if the core sets BAMF_SHARED_SECRET, it sends
// the value as x-bamf-secret and we reject anyone who doesn't match.
const SHARED_SECRET = process.env.BAMF_SHARED_SECRET ?? null;

const manifest = JSON.parse(await readFile(join(__dirname, "manifest.json"), "utf8"));

// ---- The only part a contributor really writes: the command handler. --------
function invoke(request) {
  // request = { requestId, command, subcommand, options, invoker, context }
  return {
    content: "hello world",
    ephemeral: false,
    allowedMentions: { parse: [] },
  };
}
// -----------------------------------------------------------------------------

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
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
  console.log(`[hello-world] listening on http://localhost:${PORT}`);
});
