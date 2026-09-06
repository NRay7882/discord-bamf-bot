// Least-privilege resolver (FR8, section 4.4).
//
// Each module manifest declares exactly what it needs:
//   discord.oauthScopes     - e.g. ["bot", "applications.commands"]
//   discord.botPermissions  - e.g. ["SendMessages"]  (names from PermissionFlagsBits)
//   discord.gatewayIntents  - e.g. ["GuildMessages"] (names from GatewayIntentBits)
//
// We union those across every module, compute the install permission integer
// and the gateway intents the client should request, and generate the OAuth
// install URL from the union. Keeping the whole-bot union small IS the
// least-privilege goal in a shared, multi-tenant bot.

import { GatewayIntentBits, PermissionFlagsBits } from "discord.js";

// discord.js needs the Guilds intent to receive guild interactions
// (slash commands). This is always part of the union.
const BASE_INTENTS = ["Guilds"];

function resolveIntentBits(names) {
  let bits = 0n;
  for (const name of names) {
    const bit = GatewayIntentBits[name];
    if (bit === undefined) {
      throw new Error(`Unknown gateway intent "${name}" in a module manifest.`);
    }
    bits |= BigInt(bit);
  }
  return bits;
}

function resolvePermissionBits(names) {
  let bits = 0n;
  for (const name of names) {
    const bit = PermissionFlagsBits[name];
    if (bit === undefined) {
      throw new Error(`Unknown bot permission "${name}" in a module manifest.`);
    }
    bits |= BigInt(bit);
  }
  return bits;
}

/**
 * Compute the least-privilege union across all module manifests.
 * @param {object[]} manifests
 * @returns {{
 *   oauthScopes: string[],
 *   permissionBits: bigint,
 *   permissionInteger: string,
 *   intentNames: string[],
 *   intentBits: number
 * }}
 */
export function resolvePrivileges(manifests) {
  const scopeSet = new Set(["bot", "applications.commands"]);
  const permissionNameSet = new Set();
  const intentNameSet = new Set(BASE_INTENTS);

  for (const manifest of manifests) {
    const discord = manifest.discord ?? {};
    for (const scope of discord.oauthScopes ?? []) scopeSet.add(scope);
    for (const perm of discord.botPermissions ?? []) permissionNameSet.add(perm);
    for (const intent of discord.gatewayIntents ?? []) intentNameSet.add(intent);
  }

  const intentNames = [...intentNameSet];
  const intentBits = resolveIntentBits(intentNames);
  const permissionBits = resolvePermissionBits([...permissionNameSet]);

  return {
    oauthScopes: [...scopeSet],
    permissionBits,
    permissionInteger: permissionBits.toString(),
    intentNames,
    // discord.js accepts a resolvable; a Number is fine for the intent set.
    intentBits: Number(intentBits),
  };
}

/**
 * Build the OAuth2 install URL from the resolved privilege union.
 */
export function buildInstallUrl(clientId, privileges) {
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: privileges.permissionInteger,
    integration_type: "0",
    scope: privileges.oauthScopes.join(" "),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
