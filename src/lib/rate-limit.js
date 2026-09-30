const WINDOW_MS = 60000;
const MAX_REQUESTS = 240;
const CLEANUP_INTERVAL_MS = 300000;

/** windowMs / max 可覆盖：登录接口要用更严的阈值（默认仍是全站那套）。 */
export function createRateLimiter({ now = Date.now, windowMs = WINDOW_MS, max = MAX_REQUESTS } = {}) {
  const state = new Map();

  function cleanup(timestamp) {
    for (const [ip, entry] of state) {
      if (timestamp - entry.window > windowMs * 2) state.delete(ip);
    }
  }

  function check(ip) {
    const timestamp = now();
    if (!state.lastCleanup) state.lastCleanup = timestamp;
    if (timestamp - state.lastCleanup > CLEANUP_INTERVAL_MS) {
      cleanup(timestamp);
      state.lastCleanup = timestamp;
    }

    const entry = state.get(ip) || { count: 0, window: timestamp };
    if (timestamp - entry.window > windowMs) {
      entry.count = 0;
      entry.window = timestamp;
    }
    entry.count += 1;
    state.set(ip, entry);
    return entry.count <= max;
  }

  return { check };
}
