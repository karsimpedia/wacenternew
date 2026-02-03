import WASession from "./session.js";

const sessions = new Map();

export function getSession(sessionId, webhook) {
  let wa = sessions.get(sessionId);

  // 1️⃣ session belum ada → buat
  if (!wa) {
    wa = new WASession(sessionId, webhook);
    wa._initializing = true;

    // init async, JANGAN await
    wa.init()
      .catch(err => {
        console.error("[WA INIT ERROR]", err.message);
      })
      .finally(() => {
        wa._initializing = false;
      });

    sessions.set(sessionId, wa);
  }

  return wa;
}

export function getState(sessionId) {
  return sessions.get(sessionId)?.state || null;
}
