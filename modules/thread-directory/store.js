// Per-guild configuration store for the thread directory. One JSON file per
// guild under <dataDir>/thread-directory/<guildId>.json. Writes are atomic
// (temp file + rename) so a crash mid-write can never corrupt a config. No
// external dependencies - just node:fs.
//
// This is the minimal datastore PLAN.md deferred to "Phase 7"; kept intentionally
// small and swappable for a real database later.

import { mkdir, readFile, writeFile, rename, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const SUBDIR = "thread-directory";

export const DEFAULT_SORT = {
  categoryOrder: "position", // "position" | "alpha" | "custom"
  customCategoryOrder: [], // category IDs, used when categoryOrder === "custom"
  threadOrder: "activity", // "activity" | "alpha" | "created"
  includeArchived: false,
};

/** Fill in any missing fields so callers always get a complete config. */
export function withDefaults(config = {}) {
  return {
    channelId: config.channelId ?? null,
    enabled: config.enabled ?? false,
    sort: { ...DEFAULT_SORT, ...(config.sort ?? {}) },
    managedMessageIds: Array.isArray(config.managedMessageIds) ? config.managedMessageIds : [],
    updatedAt: config.updatedAt ?? null,
  };
}

export class ConfigStore {
  constructor(dataDir) {
    this.dir = join(dataDir, SUBDIR);
  }

  #pathFor(guildId) {
    return join(this.dir, `${guildId}.json`);
  }

  async #ensureDir() {
    await mkdir(this.dir, { recursive: true });
  }

  /** Read one guild's config (with defaults applied). Missing file -> defaults. */
  async get(guildId) {
    try {
      const raw = await readFile(this.#pathFor(guildId), "utf8");
      return withDefaults(JSON.parse(raw));
    } catch (error) {
      if (error.code === "ENOENT") return withDefaults();
      throw error;
    }
  }

  /** Merge patch into a guild's config and persist it atomically. Returns the result. */
  async update(guildId, patch) {
    const current = await this.get(guildId);
    const next = withDefaults({
      ...current,
      ...patch,
      sort: { ...current.sort, ...(patch.sort ?? {}) },
      updatedAt: Date.now(),
    });
    await this.#ensureDir();
    const target = this.#pathFor(guildId);
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, target);
    return next;
  }

  /** List the guild IDs that have a stored config. */
  async guildIds() {
    try {
      const files = await readdir(this.dir);
      return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  /** Remove a guild's config entirely. */
  async remove(guildId) {
    try {
      await unlink(this.#pathFor(guildId));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
