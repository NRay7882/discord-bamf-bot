// The module contract, in one place (section 4.3). Both the live router and the
// offline test harness validate module responses through this file, so "valid to
// the bot" and "valid in tests" can never drift apart.

export const DISCORD_CONTENT_LIMIT = 2000;

const KNOWN_RESPONSE_KEYS = new Set([
  "content",
  "ephemeral",
  "embeds",
  "components",
  "allowedMentions",
]);

/**
 * Inspect a raw /invoke response against the contract.
 * @returns {{ errors: string[], warnings: string[], payload: object|null }}
 *   errors  - hard failures; the core would refuse to send this to Discord.
 *   warnings- things the core tolerates but an author probably wants to fix.
 *   payload - the sanitized Discord message payload (null if unrecoverable).
 */
export function inspectInvokeResponse(raw) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { errors: ["response is not a JSON object"], warnings, payload: null };
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_RESPONSE_KEYS.has(key)) {
      warnings.push(`unknown field "${key}" (ignored by the core)`);
    }
  }

  let content = "";
  if (raw.content !== undefined) {
    if (typeof raw.content !== "string") {
      errors.push("content must be a string");
    } else {
      content = raw.content;
      if (content.length > DISCORD_CONTENT_LIMIT) {
        warnings.push(
          `content is ${content.length} chars; the core truncates to ${DISCORD_CONTENT_LIMIT}`
        );
        content = content.slice(0, DISCORD_CONTENT_LIMIT - 3) + "...";
      }
    }
  }

  const embeds = raw.embeds ?? [];
  if (!Array.isArray(embeds)) errors.push("embeds must be an array");
  const components = raw.components ?? [];
  if (!Array.isArray(components)) errors.push("components must be an array");

  if (raw.ephemeral !== undefined && typeof raw.ephemeral !== "boolean") {
    errors.push("ephemeral must be a boolean");
  }
  if (raw.allowedMentions !== undefined && typeof raw.allowedMentions !== "object") {
    errors.push("allowedMentions must be an object");
  }

  const hasContent = typeof content === "string" && content !== "";
  const hasEmbeds = Array.isArray(embeds) && embeds.length > 0;
  if (!hasContent && !hasEmbeds) {
    errors.push("response must have non-empty content or at least one embed");
  }

  const payload =
    errors.length === 0
      ? {
          content: content === "" ? undefined : content,
          embeds,
          components,
          // NFR8: never ping anyone unless the module explicitly opts in.
          allowedMentions:
            raw.allowedMentions && typeof raw.allowedMentions === "object"
              ? raw.allowedMentions
              : { parse: [] },
        }
      : null;

  return { errors, warnings, payload };
}

/**
 * Sanitize a raw /invoke response for sending, throwing on hard errors.
 * Used by the live router.
 */
export function sanitizeInvokeResponse(raw) {
  const { errors, payload } = inspectInvokeResponse(raw);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return payload;
}
