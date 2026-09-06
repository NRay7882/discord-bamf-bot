// Sets the bot's Discord avatar to images/bamf.png (or another path via arg).
// One-time / occasional use. Discord rate-limits avatar changes (a couple per
// hour), so don't script this on a loop.
//
//   node scripts/set-avatar.js                 (or: npm run avatar)
//   node scripts/set-avatar.js images/bamf.png

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { REST, Routes } from "discord.js";
import { secrets } from "../src/config.js";
import { log } from "../src/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif" };

async function main() {
  const relPath = process.argv[2] ?? "images/bamf.png";
  const imagePath = join(__dirname, "..", relPath);
  const ext = extname(imagePath).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`Unsupported image type "${ext}". Use PNG, JPG, or GIF.`);

  const bytes = await readFile(imagePath);
  // Discord caps avatars around 10 MB; warn well before that.
  if (bytes.length > 8 * 1024 * 1024) {
    log.warn("Image is large; Discord may reject it", { bytes: bytes.length });
  }
  const dataUri = `data:${mime};base64,${bytes.toString("base64")}`;

  const rest = new REST({ version: "10" }).setToken(secrets.token);
  const me = await rest.patch(Routes.user("@me"), { body: { avatar: dataUri } });

  log.info("Bot avatar updated", { path: relPath, username: me.username });
  log.info("Note: square images look best; non-square ones are cropped to a circle.");
}

main().catch((error) => {
  log.error("Failed to set avatar", { error: error.message });
  process.exitCode = 1;
});
