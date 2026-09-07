import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRegistry, isModuleAllowedInGuild } from "./registry.js";
import { buildBamfCommand } from "./commands.js";

async function makeModule(dir, name, manifest) {
  const moduleDir = join(dir, name);
  await mkdir(moduleDir, { recursive: true });
  await writeFile(join(moduleDir, "manifest.json"), JSON.stringify(manifest), "utf8");
}

const httpRuntime = { invokeUrl: "http://localhost:9" };

test("rejects server identifiers in a committed manifest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bamf-reg-"));
  await makeModule(dir, "bad", {
    name: "bad",
    version: "0.0.1",
    runtime: httpRuntime,
    scope: { restricted: true, guildIds: ["1"] },
    commands: [{ name: "bad-cmd", description: "x" }],
  });
  await assert.rejects(() => loadRegistry({ modulesDir: dir }), /must not list guildIds/);
  await rm(dir, { recursive: true, force: true });
});

test("rejects an unknown permission in a command access block", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bamf-reg-"));
  await makeModule(dir, "acc", {
    name: "acc",
    version: "0.0.1",
    runtime: httpRuntime,
    commands: [{ name: "cmd", description: "x", access: { permissions: ["Nope"] } }],
  });
  await assert.rejects(() => loadRegistry({ modulesDir: dir }), /unknown permission/);
  await rm(dir, { recursive: true, force: true });
});

test("restricted module is allowed only in configured guilds", async () => {
  process.env.BAMF_SCOPE_RESTRICTED_MOD = "111";
  const dir = await mkdtemp(join(tmpdir(), "bamf-reg-"));
  await makeModule(dir, "restricted-mod", {
    name: "restricted-mod",
    version: "0.0.1",
    runtime: httpRuntime,
    scope: { restricted: true },
    commands: [{ name: "secret", description: "x" }],
  });
  const { commandMap } = await loadRegistry({ modulesDir: dir });
  const mod = commandMap.get("secret").module;
  assert.equal(isModuleAllowedInGuild(mod, { guildId: "111" }), true);
  assert.equal(isModuleAllowedInGuild(mod, { guildId: "999" }), false);
  delete process.env.BAMF_SCOPE_RESTRICTED_MOD;
  await rm(dir, { recursive: true, force: true });
});

test("universal module is allowed everywhere", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bamf-reg-"));
  await makeModule(dir, "uni", {
    name: "uni",
    version: "0.0.1",
    runtime: httpRuntime,
    commands: [{ name: "hi", description: "x" }],
  });
  const { commandMap } = await loadRegistry({ modulesDir: dir });
  const mod = commandMap.get("hi").module;
  assert.equal(isModuleAllowedInGuild(mod, { guildId: "anything" }), true);
  await rm(dir, { recursive: true, force: true });
});

test("buildBamfCommand composes help + commands and is guild-only", () => {
  const cmd = buildBamfCommand([{ name: "hello", description: "hi" }]);
  assert.equal(cmd.name, "bamf");
  assert.equal(cmd.dm_permission, false);
  const names = cmd.options.map((o) => o.name);
  assert.ok(names.includes("help"));
  assert.ok(names.includes("hello"));
});
