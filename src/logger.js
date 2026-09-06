// Minimal structured (JSON-line) logger. NFR7: log invocations and errors,
// each carrying a request ID where one exists.

import { config } from "./config.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function emit(level, message, fields) {
  if (LEVELS[level] < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  };
  const text = JSON.stringify(line);
  if (level === "error" || level === "warn") {
    process.stderr.write(text + "\n");
  } else {
    process.stdout.write(text + "\n");
  }
}

export const log = {
  debug: (message, fields = {}) => emit("debug", message, fields),
  info: (message, fields = {}) => emit("info", message, fields),
  warn: (message, fields = {}) => emit("warn", message, fields),
  error: (message, fields = {}) => emit("error", message, fields),
};
