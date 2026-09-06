// Module test/validation harness (NFR6). For each module it checks:
//   1. the manifest is valid (the registry loads it without error);
//   2. GET /health returns { status: "ok" };
//   3. GET /manifest matches the committed manifest.json exactly;
//   4. every command's POST /invoke returns output the bot can send to Discord,
//      validated through the SAME contract the live router uses (src/contract.js).
//
//   node scripts/test-module.js                 # test every module
//   node scripts/test-module.js hello-world     # test one module
//   node scripts/test-module.js --no-spawn      # test modules already running
//
// A module may ship an optional modules/<name>/tests.json with sample invoke
// requests and expected output (see MODULE_SPEC.md / docs/AUTHORING.md).

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadRegistry } from "../src/registry.js";
import { inspectInvokeResponse } from "../src/contract.js";

const SPAWN_TIMEOUT_MS = 8000;
let TEST_PORT_BASE = 41000;

function stable(value) {
  // Order-independent JSON for comparing manifests.
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stable(value[key]);
        return acc;
      }, {});
  }
  return value;
}
const deepEqual = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

function sampleOptionValue(option) {
  switch (option.type) {
    case "string": return "test";
    case "integer": return 1;
    case "number": return 1.5;
    case "boolean": return true;
    case "user": return "100000000000000000";
    case "channel": return "200000000000000000";
    case "role": return "300000000000000000";
    case "mentionable": return "400000000000000000";
    case "attachment": return "500000000000000000";
    default: return "test";
  }
}

function buildAutoRequest(command) {
  const options = {};
  for (const option of command.options ?? []) {
    if (option.required) options[option.name] = sampleOptionValue(option);
  }
  return {
    requestId: "test-" + command.name,
    command: command.name,
    subcommand: null,
    options,
    invoker: { id: "1", username: "tester", displayName: "Tester" },
    context: { guildId: "1", channelId: "1", locale: "en-US" },
  };
}

async function getJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  return { status: res.status, body };
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + SPAWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const { status, body } = await getJson(baseUrl + "/health");
      if (status === 200 && body?.status === "ok") return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function loadTestCases(module) {
  try {
    const raw = await readFile(join(module.__dir, "tests.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function checkExpect(expect, payload, raw) {
  const problems = [];
  if (expect.content !== undefined && raw.content !== expect.content) {
    problems.push(`expected content ${JSON.stringify(expect.content)}, got ${JSON.stringify(raw.content)}`);
  }
  if (expect.ephemeral !== undefined && Boolean(raw.ephemeral) !== expect.ephemeral) {
    problems.push(`expected ephemeral=${expect.ephemeral}, got ${Boolean(raw.ephemeral)}`);
  }
  if (expect.contentIncludes !== undefined && !String(raw.content ?? "").includes(expect.contentIncludes)) {
    problems.push(`expected content to include ${JSON.stringify(expect.contentIncludes)}`);
  }
  return problems;
}

async function testModule(module, { spawnModules }) {
  const results = [];
  const record = (ok, label, detail) => results.push({ ok, label, detail });

  // In-process modules run inside the core with no HTTP server. The registry
  // already validated their manifest; their Discord-free logic is covered by
  // their own unit tests (e.g. `node --test`).
  if (module.transport === "in-process") {
    record(true, "in-process module (manifest valid; logic covered by unit tests)");
    return results;
  }

  const manifestUrl = module.runtime.invokeUrl.replace(/\/$/, "");
  let baseUrl = manifestUrl;
  let child = null;

  const isJs = (module.language ?? "").toLowerCase() === "javascript";
  if (spawnModules && isJs) {
    const port = TEST_PORT_BASE++;
    baseUrl = `http://localhost:${port}`;
    child = spawn(process.execPath, ["index.js"], {
      cwd: module.__dir,
      env: { ...process.env, PORT: String(port), BAMF_SHARED_SECRET: "" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const up = await waitForHealth(baseUrl);
    if (!up) {
      record(false, "module started", stderr.trim() || "did not become healthy in time");
      child.kill();
      return results;
    }
    record(true, "module started");
  } else {
    const up = await waitForHealth(baseUrl);
    if (!up) {
      record(false, "module reachable", `nothing healthy at ${baseUrl} (start it, or drop --no-spawn)`);
      return results;
    }
    record(true, "module reachable");
  }

  try {
    // 2. health
    const health = await getJson(baseUrl + "/health");
    record(
      health.status === 200 && health.body?.status === "ok",
      "GET /health -> { status: ok }",
      JSON.stringify(health.body)
    );

    // 3. served manifest matches committed manifest
    const committed = JSON.parse(await readFile(join(module.__dir, "manifest.json"), "utf8"));
    const served = await getJson(baseUrl + "/manifest");
    record(
      served.status === 200 && deepEqual(served.body, committed),
      "GET /manifest matches manifest.json",
      served.status === 200 ? undefined : `HTTP ${served.status}`
    );

    // 4. per-command /invoke contract validation
    const cases = await loadTestCases(module);
    for (const command of module.commands) {
      const commandCases = cases?.[command.name] ?? [{ name: "auto", request: {} }];
      for (const testCase of commandCases) {
        const request = { ...buildAutoRequest(command), ...(testCase.request ?? {}) };
        if (testCase.request?.options) request.options = testCase.request.options;
        let invoke;
        try {
          invoke = await getJson(baseUrl + "/invoke", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request),
          });
        } catch (error) {
          record(false, `POST /invoke (${command.name}/${testCase.name ?? "case"})`, error.message);
          continue;
        }

        const label = `POST /invoke (${command.name}/${testCase.name ?? "case"})`;
        if (invoke.status !== 200) {
          record(false, label, `HTTP ${invoke.status}: ${JSON.stringify(invoke.body).slice(0, 120)}`);
          continue;
        }
        const { errors, warnings, payload } = inspectInvokeResponse(invoke.body);
        const expectProblems = testCase.expect ? checkExpect(testCase.expect, payload, invoke.body) : [];
        const problems = [...errors, ...expectProblems];
        record(problems.length === 0, label, problems.length ? problems.join("; ") : undefined);
        for (const w of warnings) record(true, `${label} [warning]`, w);
      }
    }
  } finally {
    if (child) child.kill();
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const spawnModules = !args.includes("--no-spawn");
  const names = args.filter((a) => !a.startsWith("--"));

  const { modules } = await loadRegistry();
  const targets = names.length
    ? modules.filter((m) => names.includes(m.name))
    : modules;

  if (names.length && targets.length !== names.length) {
    const found = new Set(targets.map((m) => m.name));
    const missing = names.filter((n) => !found.has(n));
    console.error(`Unknown module(s): ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (targets.length === 0) {
    console.log("No modules to test.");
    return;
  }

  let failures = 0;
  for (const module of targets) {
    console.log(`\n=== ${module.name} v${module.version} ===`);
    const results = await testModule(module, { spawnModules });
    for (const r of results) {
      const mark = r.ok ? "  ok  " : " FAIL ";
      console.log(`[${mark}] ${r.label}${r.detail ? ` - ${r.detail}` : ""}`);
      if (!r.ok) failures++;
    }
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("Test harness crashed:", error.message);
  process.exitCode = 1;
});
