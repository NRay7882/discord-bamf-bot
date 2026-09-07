// Per-command access control (who may run a command). Discord only supports
// default_member_permissions on a top-level command, and BamfBot has exactly one
// (/bamf), so per-command gating cannot be expressed to Discord - the command
// still appears in the picker for everyone and is enforced here, at invocation.
//
// A command (and, independently, a subcommand) may declare an `access` block in
// its manifest:
//   { "permissions": ["ManageGuild"], "roles": ["Moderator"] }
// A caller passes if they have ANY listed permission OR ANY allowed role. Roles
// are matched by name (portable, but names are mutable); an operator can also map
// a command to specific role IDs per guild in bamf.local.json for precision.
//
// With nothing declared, a command is open to everyone (the default).

import { PermissionFlagsBits } from "discord.js";

/**
 * Validate a manifest `access` block, returning a normalized { permissions, roles }.
 * Throws (with a label for context) on an unknown permission name or bad shape.
 */
export function validateAccess(access, label) {
  if (access == null) return { permissions: [], roles: [] };
  if (typeof access !== "object" || Array.isArray(access)) {
    throw new Error(`${label}: access must be an object`);
  }
  const permissions = access.permissions ?? [];
  const roles = access.roles ?? [];
  if (!Array.isArray(permissions) || !Array.isArray(roles)) {
    throw new Error(`${label}: access.permissions and access.roles must be arrays`);
  }
  for (const perm of permissions) {
    if (typeof perm !== "string" || PermissionFlagsBits[perm] === undefined) {
      throw new Error(`${label}: unknown permission "${perm}"`);
    }
  }
  for (const role of roles) {
    if (typeof role !== "string" || role.length === 0) {
      throw new Error(`${label}: access.roles entries must be non-empty strings`);
    }
  }
  return { permissions, roles };
}

/**
 * Build one access requirement from a manifest access block plus any operator
 * role-ID overrides (role IDs allowed for this command in the invoking guild).
 * Returns null when nothing is required (i.e. open to everyone).
 */
export function buildRequirement({ permissions = [], roles = [], roleIds = [] } = {}) {
  const requirement = { permissions, roleNames: roles, roleIds };
  const empty = permissions.length === 0 && roles.length === 0 && roleIds.length === 0;
  return empty ? null : requirement;
}

function memberRoleIds(interaction) {
  const roles = interaction.member?.roles;
  if (!roles) return new Set();
  // GuildMember: roles.cache is a Collection keyed by id. Raw API member: an array.
  if (roles.cache) return new Set(roles.cache.keys());
  if (Array.isArray(roles)) return new Set(roles);
  return new Set();
}

function memberRoleNames(interaction) {
  const names = new Set();
  const roles = interaction.member?.roles;
  if (roles?.cache) {
    for (const role of roles.cache.values()) names.add(role.name.toLowerCase());
    return names;
  }
  // Raw API member (roles as IDs): resolve names via the guild's role cache.
  const guildRoles = interaction.guild?.roles?.cache;
  if (Array.isArray(roles) && guildRoles) {
    for (const id of roles) {
      const role = guildRoles.get(id);
      if (role) names.add(role.name.toLowerCase());
    }
  }
  return names;
}

/**
 * Does the interaction's member satisfy a requirement? A null requirement (open)
 * is always satisfied. Otherwise: any listed permission, any allowed role ID, or
 * any allowed role name (case-insensitive) passes.
 */
export function memberSatisfies(interaction, requirement) {
  if (!requirement) return true;

  const perms = interaction.memberPermissions;
  if (
    perms &&
    requirement.permissions.some((name) => perms.has(PermissionFlagsBits[name]))
  ) {
    return true;
  }

  if (requirement.roleIds.length > 0) {
    const ids = memberRoleIds(interaction);
    if (requirement.roleIds.some((id) => ids.has(id))) return true;
  }

  if (requirement.roleNames.length > 0) {
    const names = memberRoleNames(interaction);
    if (requirement.roleNames.some((n) => names.has(n.toLowerCase()))) return true;
  }

  return false;
}

/** A short human description of a requirement, for help text and refusals. */
export function describeRequirement(requirement) {
  if (!requirement) return "anyone";
  const parts = [];
  if (requirement.permissions.length) {
    parts.push(requirement.permissions.join(" or "));
  }
  if (requirement.roleNames.length) {
    parts.push(`role ${requirement.roleNames.map((r) => `"${r}"`).join(" or ")}`);
  }
  if (requirement.roleIds.length && parts.length === 0) {
    parts.push("a specific role");
  }
  return parts.join(", or ") || "anyone";
}
