// src/logger.mjs
// Minimal structured logger. Level-gated, no dependencies.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger(name = "tiki", level = "info") {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const emit = (lvl, msg, meta) => {
    if (LEVELS[lvl] < threshold) return;
    const line = {
      at: new Date().toISOString(),
      level: lvl,
      scope: name,
      msg,
      ...(meta && typeof meta === "object" ? { meta } : meta !== undefined ? { meta } : {})
    };
    const out = JSON.stringify(line);
    if (lvl === "error" || lvl === "warn") process.stderr.write(out + "\n");
    else process.stdout.write(out + "\n");
  };
  return {
    debug: (m, meta) => emit("debug", m, meta),
    info: (m, meta) => emit("info", m, meta),
    warn: (m, meta) => emit("warn", m, meta),
    error: (m, meta) => emit("error", m, meta),
    child: (sub) => createLogger(`${name}:${sub}`, level)
  };
}
