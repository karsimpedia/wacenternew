const mem = new Map();
// key: userId -> { summary: string, lastTrxId: string|null, updatedAt: number }

export function getMem(userId) {
  return mem.get(userId) || { summary: "", lastTrxId: null, updatedAt: 0 };
}

export function setMem(userId, patch) {
  const cur = getMem(userId);
  const next = { ...cur, ...patch, updatedAt: Date.now() };

  // limit summary
  if (typeof next.summary === "string" && next.summary.length > 600) {
    next.summary = next.summary.slice(0, 600);
  }

  mem.set(userId, next);
}

export function clearMem(userId) {
  mem.delete(userId);
}
