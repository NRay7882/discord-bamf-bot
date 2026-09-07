// Resolve the effective base URL for an HTTP module's endpoint.
//
// A module manifest declares a fixed invokeUrl (e.g. "http://localhost:8082").
// The core normally uses it verbatim, but two operator overrides let the same
// code run in more than one topology on one host (see docs/HOSTING.md):
//
//   BAMF_MODULE_HOST         - replace the host (e.g. a Docker service name).
//   BAMF_MODULE_PORT_OFFSET  - add to the port, so a second (dev) stack can run
//                              beside prod without colliding: with offset 1000,
//                              a manifest's :8082 becomes :9082. The module
//                              process must listen on the shifted port too - it
//                              reads that from PORT, which the per-env PM2 config
//                              sets from the same offset (ecosystem.config.cjs).
//
// With neither override set (the default), the manifest URL is returned
// unchanged, so a single-environment install behaves exactly as before.

import { config } from "./config.js";

/**
 * @param {string} invokeUrl  the module's manifest runtime.invokeUrl
 * @param {{ host?: string|null, portOffset?: number }} [overrides]
 *        explicit overrides (defaults come from config / the environment)
 * @returns {string} the base URL to call, with no trailing slash
 */
export function resolveInvokeBaseUrl(invokeUrl, overrides = {}) {
  const host = overrides.host ?? config.moduleHost;
  const portOffset = overrides.portOffset ?? config.modulePortOffset;

  const url = new URL(invokeUrl);
  if (host) url.hostname = host;
  if (portOffset) {
    if (!url.port) {
      throw new Error(
        `Cannot apply a module port offset to "${invokeUrl}": it has no explicit port.`
      );
    }
    url.port = String(Number(url.port) + portOffset);
  }
  // toString() adds a trailing slash for a bare origin; drop it so the caller
  // can append "/invoke" (or "/health") cleanly, preserving any real path.
  return url.toString().replace(/\/$/, "");
}
