// astrogoblin module (BamfBot module contract). On /invoke it searches the
// fan-run Astrogoblin transcript search (search.astrogoblin.jammaloo.com) for
// spoken words and returns the matching videos, exact matches favored. It never
// touches Discord - it fetches an external page and returns a message payload.
//
//   GET  /health   -> { "status": "ok" }
//   GET  /manifest -> this module's manifest.json
//   POST /invoke   -> the command response
//
// Run:  node modules/astrogoblin/index.js   (listens on :8082, or $PORT)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseResults } from "./parse.js";
import { buildResponse, searchUrl } from "./format.js";

// Load the repo-root .env (best effort) so operator config like a custom title
// emoji can live there, out of the committed repo. Values already in the
// environment (e.g. PORT from PM2) take precedence.
try {
  process.loadEnvFile();
} catch {
  // No .env here (e.g. the test harness runs from the module dir) - that's fine.
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8082);
const SHARED_SECRET = process.env.BAMF_SHARED_SECRET ?? null;
// Keep this under the core's module timeout (default 8000ms) so we fail cleanly.
const FETCH_TIMEOUT_MS = Number(process.env.ASTROGOBLIN_TIMEOUT_MS ?? 6000);
// Optional custom emoji for the reply title, as its full token "<:goblin:ID>"
// (server-specific; never committed). The bot must be in the emoji's server.
const TITLE_EMOJI = (process.env.ASTROGOBLIN_TITLE_EMOJI ?? "").trim();
const MAX_QUERY = 200;

const manifest = JSON.parse(await readFile(join(__dirname, "manifest.json"), "utf8"));

async function fetchSearchPage(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(searchUrl(query), {
      signal: controller.signal,
      headers: { "user-agent": "BamfBot/astrogoblin (+discord)" },
    });
    if (!res.ok) throw new Error(`search site returned HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---- The command handler. ---------------------------------------------------
async function invoke(request) {
  const query = String(request?.options?.query ?? "").trim().slice(0, MAX_QUERY);
  if (query.length < 2) {
    return {
      content:
        "Give me something that was said, e.g. `/bamf astrogoblin search query:motor running`.",
      ephemeral: true,
      allowedMentions: { parse: [] },
    };
  }

  let html;
  try {
    html = await fetchSearchPage(query);
  } catch (error) {
    const why = error.name === "AbortError" ? "timed out" : "is unavailable";
    return {
      content: `The Astrogoblin search site ${why}. Try again shortly, or search directly: ${searchUrl(query)}`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    };
  }

  try {
    const results = parseResults(html);
    if (!results.query) results.query = query; // fall back to the user's query
    return buildResponse(results, { titleEmoji: TITLE_EMOJI });
  } catch {
    // The site responded but with something we couldn't parse (e.g. its markup
    // changed, or a challenge page). Fail friendly rather than erroring out.
    return {
      content: `I couldn't read the Astrogoblin search results just now. Try again, or search directly: ${searchUrl(query)}`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    };
  }
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
      return sendJson(res, 200, await invoke(request));
    }
    return sendJson(res, 404, { error: "not found" });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`[astrogoblin] listening on http://localhost:${PORT}`);
});
