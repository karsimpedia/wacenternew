// src/openAi/session.js




const sessions = new Map();

export function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      history: [],
      lastReplyAt: 0,
      strikes: 0,
      humanMode: false,
    });
  }
  return sessions.get(userId);
}

export function pushHistory(userId, role, content) {
  const s = getSession(userId);
  s.history.push({ role, content });
  if (s.history.length > 10) s.history.shift();
}

export function resetHistory(userId) {
  const s = getSession(userId);
  s.history = [];
}

export function canReplyNow(userId, cooldownMs = 8000) {
  const s = getSession(userId);
  const now = Date.now();
  if (now - s.lastReplyAt < cooldownMs) return false;
  s.lastReplyAt = now;
  return true;
}
