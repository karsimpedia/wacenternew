// src/services/chatMessage.service.js
import { prisma } from "../prisma.js";

function cleanText(v = "", max = 5000) {
  const s = String(v || "").trim();
  return s ? s.slice(0, max) : "";
}

function normalizeIntent(intent = "UNKNOWN") {
  const raw = String(intent || "UNKNOWN").trim().toUpperCase();

  const allowed = new Set([
    "CHAT",
    "CHECK_STATUS",
    "COMPLAIN",
    "FOLLOWUP",
    "CANCEL_COMPLAIN",
    "DEPOSIT_COMPLAIN",
    "UNKNOWN",
  ]);

  return allowed.has(raw) ? raw : "UNKNOWN";
}

function normalizeRole(role = "USER") {
  const raw = String(role || "USER").trim().toUpperCase();

  const allowed = new Set(["USER", "AI", "SYSTEM", "AGENT"]);
  return allowed.has(raw) ? raw : "USER";
}

export async function saveIncomingMessage({
  sessionId,
  message,
  externalId = null,
  rawPayload = null,
  intent = "UNKNOWN",
}) {
  const safeSessionId = String(sessionId || "").trim();
  const safeMessage = cleanText(message, 5000);
  const safeExternalId =
    typeof externalId === "string" && externalId.trim()
      ? externalId.trim().slice(0, 255)
      : null;

  if (!safeSessionId || !safeMessage) return null;

  try {
    return await prisma.chatMessage.create({
      data: {
        sessionId: safeSessionId,
        role: "USER",
        message: safeMessage,
        intent: normalizeIntent(intent),
        externalId: safeExternalId,
        rawPayload: rawPayload ?? null,
      },
    });
  } catch (e) {
    if (e.code === "P2002") {
      return null;
    }
    throw e;
  }
}

export async function saveAIReply({
  sessionId,
  message,
  intent = "UNKNOWN",
  rawPayload = null,
}) {
  const safeSessionId = String(sessionId || "").trim();
  const safeMessage = cleanText(message, 5000);

  if (!safeSessionId || !safeMessage) return null;

  return prisma.chatMessage.create({
    data: {
      sessionId: safeSessionId,
      role: "AI",
      message: safeMessage,
      intent: normalizeIntent(intent),
      rawPayload: rawPayload ?? null,
    },
  });
}

export async function saveSystemMessage({
  sessionId,
  message,
  intent = "UNKNOWN",
  rawPayload = null,
}) {
  const safeSessionId = String(sessionId || "").trim();
  const safeMessage = cleanText(message, 5000);

  if (!safeSessionId || !safeMessage) return null;

  return prisma.chatMessage.create({
    data: {
      sessionId: safeSessionId,
      role: "SYSTEM",
      message: safeMessage,
      intent: normalizeIntent(intent),
      rawPayload: rawPayload ?? null,
    },
  });
}

export async function saveAgentMessage({
  sessionId,
  message,
  intent = "UNKNOWN",
  rawPayload = null,
}) {
  const safeSessionId = String(sessionId || "").trim();
  const safeMessage = cleanText(message, 5000);

  if (!safeSessionId || !safeMessage) return null;

  return prisma.chatMessage.create({
    data: {
      sessionId: safeSessionId,
      role: "AGENT",
      message: safeMessage,
      intent: normalizeIntent(intent),
      rawPayload: rawPayload ?? null,
    },
  });
}

export async function saveChatMessage({
  sessionId,
  role = "USER",
  message,
  intent = "UNKNOWN",
  externalId = null,
  rawPayload = null,
}) {
  const safeSessionId = String(sessionId || "").trim();
  const safeMessage = cleanText(message, 5000);
  const safeExternalId =
    typeof externalId === "string" && externalId.trim()
      ? externalId.trim().slice(0, 255)
      : null;

  if (!safeSessionId || !safeMessage) return null;

  try {
    return await prisma.chatMessage.create({
      data: {
        sessionId: safeSessionId,
        role: normalizeRole(role),
        message: safeMessage,
        intent: normalizeIntent(intent),
        externalId: safeExternalId,
        rawPayload: rawPayload ?? null,
      },
    });
  } catch (e) {
    if (e.code === "P2002") {
      return null;
    }
    throw e;
  }
}

export async function getRecentMessages(sessionId, limit = 10) {
  const safeSessionId = String(sessionId || "").trim();
  const safeLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(50, Number(limit)))
    : 10;

  if (!safeSessionId) return [];

  return prisma.chatMessage.findMany({
    where: {
      sessionId: safeSessionId,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: safeLimit,
  });
}

export async function getMessagesBySession(sessionId, limit = 50) {
  const safeSessionId = String(sessionId || "").trim();
  const safeLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(200, Number(limit)))
    : 50;

  if (!safeSessionId) return [];

  const rows = await prisma.chatMessage.findMany({
    where: {
      sessionId: safeSessionId,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: safeLimit,
  });

  return rows;
}

export async function deleteMessagesBySession(sessionId) {
  const safeSessionId = String(sessionId || "").trim();
  if (!safeSessionId) return { count: 0 };

  try {
    return await prisma.chatMessage.deleteMany({
      where: {
        sessionId: safeSessionId,
      },
    });
  } catch (err) {
    console.warn(
      "[CHAT MESSAGE] deleteMessagesBySession failed:",
      err.code || err.message,
    );
    return { count: 0 };
  }
}