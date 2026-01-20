import WASession from "./session.js";

const sessions = new Map();

export async function getSession(sessionId, webhook) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);

  const wa = new WASession(sessionId, webhook);
  await wa.init();
  sessions.set(sessionId, wa);
  return wa;
}

export function getState(sessionId) {
  return sessions.get(sessionId)?.state || null;
}
