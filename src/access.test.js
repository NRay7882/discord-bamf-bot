import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import {
  validateAccess,
  buildRequirement,
  memberSatisfies,
  describeRequirement,
} from "./access.js";

function mockInteraction({ perms = [], roles = [] } = {}) {
  const bits = perms.map((p) => PermissionFlagsBits[p]);
  const cache = new Map(roles.map((r) => [r.id, { id: r.id, name: r.name }]));
  return {
    memberPermissions: { has: (bit) => bits.includes(bit) },
    member: { roles: { cache } },
    guild: { roles: { cache: new Map() } },
  };
}

test("validateAccess rejects unknown permission names", () => {
  assert.throws(() => validateAccess({ permissions: ["NotAThing"] }, "x"), /unknown permission/);
});

test("validateAccess accepts a valid block and normalizes", () => {
  const out = validateAccess({ permissions: ["ManageGuild"], roles: ["Mod"] }, "x");
  assert.deepEqual(out, { permissions: ["ManageGuild"], roles: ["Mod"] });
  assert.deepEqual(validateAccess(null, "x"), { permissions: [], roles: [] });
});

test("buildRequirement is null when nothing is required (open)", () => {
  assert.equal(buildRequirement({}), null);
  assert.equal(buildRequirement({ permissions: [], roles: [], roleIds: [] }), null);
});

test("open requirement is satisfied by anyone", () => {
  assert.equal(memberSatisfies(mockInteraction(), null), true);
});

test("permission requirement passes when the member has it", () => {
  const req = buildRequirement({ permissions: ["ManageGuild"] });
  assert.equal(memberSatisfies(mockInteraction({ perms: ["ManageGuild"] }), req), true);
  assert.equal(memberSatisfies(mockInteraction({ perms: [] }), req), false);
});

test("role-name requirement matches case-insensitively", () => {
  const req = buildRequirement({ roles: ["Moderator"] });
  assert.equal(
    memberSatisfies(mockInteraction({ roles: [{ id: "1", name: "moderator" }] }), req),
    true
  );
  assert.equal(
    memberSatisfies(mockInteraction({ roles: [{ id: "1", name: "Member" }] }), req),
    false
  );
});

test("role-id requirement matches by id", () => {
  const req = buildRequirement({ roleIds: ["999"] });
  assert.equal(memberSatisfies(mockInteraction({ roles: [{ id: "999", name: "X" }] }), req), true);
  assert.equal(memberSatisfies(mockInteraction({ roles: [{ id: "1", name: "X" }] }), req), false);
});

test("any of permission OR role passes (OR semantics)", () => {
  const req = buildRequirement({ permissions: ["ManageGuild"], roles: ["Mod"] });
  assert.equal(memberSatisfies(mockInteraction({ roles: [{ id: "1", name: "Mod" }] }), req), true);
  assert.equal(memberSatisfies(mockInteraction({ perms: ["ManageGuild"] }), req), true);
  assert.equal(memberSatisfies(mockInteraction({ perms: ["KickMembers"] }), req), false);
});

test("describeRequirement is human-readable", () => {
  assert.equal(describeRequirement(null), "anyone");
  assert.match(describeRequirement(buildRequirement({ permissions: ["ManageGuild"] })), /ManageGuild/);
  assert.match(describeRequirement(buildRequirement({ roles: ["Mod"] })), /Mod/);
});
