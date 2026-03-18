// src/services/chatSession.service.js
import { prisma } from "../prisma.js";

function normalizeChannel(channel = "WA") {
  const value = String(channel || "WA").trim().toUpperCase();

  if (["WA", "TELEGRAM", "WEB"].includes(value)) {
    return value;
  }

  return "WA";
}

function normalizeUserKey(userKey = "") {
  return String(userKey || "").trim();
}

export async function getOrCreateSession(channel = "WA", userKey = "") {
  const safeChannel = normalizeChannel(channel);
  const safeUserKey = normalizeUserKey(userKey);

  if (!safeUserKey) {
    throw new Error("userKey is required");
  }

  const now = new Date();

  const existing = await prisma.chatSession.findUnique({
    where: {
      channel_userKey: {
        channel: safeChannel,
        userKey: safeUserKey,
      },
    },
  });

  if (existing) {
    return prisma.chatSession.update({
      where: { id: existing.id },
      data: {
        lastMessageAt: now,
      },
    });
  }

  return prisma.chatSession.create({
    data: {
      channel: safeChannel,
      userKey: safeUserKey,
      lastIntent: "UNKNOWN",
      flowState: "CHAT",
      mood: "NORMAL",
      aiEnabled: true,
      escalated: false,
      lastMessageAt: now,
    },
  });
}

export async function getSessionById(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;

  return prisma.chatSession.findUnique({
    where: { id },
    include: {
      summary: true,
    },
  });
}

export async function getSessionByUser(channel = "WA", userKey = "") {
  const safeChannel = normalizeChannel(channel);
  const safeUserKey = normalizeUserKey(userKey);

  if (!safeUserKey) return null;

  return prisma.chatSession.findUnique({
    where: {
      channel_userKey: {
        channel: safeChannel,
        userKey: safeUserKey,
      },
    },
    include: {
      summary: true,
    },
  });
}

export async function touchSession(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;

  try {
    return await prisma.chatSession.update({
      where: { id },
      data: {
        lastMessageAt: new Date(),
      },
    });
  } catch (err) {
    console.warn("[CHAT SESSION] touchSession failed:", err.code || err.message);
    return null;
  }
}

export async function updateSession(sessionId, data = {}) {
  const id = String(sessionId || "").trim();
  if (!id || !data || typeof data !== "object") return null;

  try {
    return await prisma.chatSession.update({
      where: { id },
      data,
    });
  } catch (err) {
    console.warn("[CHAT SESSION] updateSession failed:", err.code || err.message);
    return null;
  }
}

export async function setSessionFlow(sessionId, flowState, extraData = {}) {
  const id = String(sessionId || "").trim();
  const flow = String(flowState || "").trim().toUpperCase();

  if (!id || !flow) return null;

  const allowedFlow = new Set([
    "CHAT",
    "COMPLAIN_REQUEST",
    "CONFIRM_COMPLAIN",
    "COMPLAIN_SENT",
    "COMPLAIN_CANCELED",
  ]);

  const safeFlow = allowedFlow.has(flow) ? flow : "CHAT";

  try {
    return await prisma.chatSession.update({
      where: { id },
      data: {
        flowState: safeFlow,
        ...extraData,
      },
    });
  } catch (err) {
    console.warn("[CHAT SESSION] setSessionFlow failed:", err.code || err.message);
    return null;
  }
}

export async function setLastTarget(sessionId, lastTarget = null) {
  const id = String(sessionId || "").trim();
  if (!id) return null;

  const safeTarget =
    typeof lastTarget === "string" && lastTarget.trim()
      ? lastTarget.trim().slice(0, 255)
      : null;

  try {
    return await prisma.chatSession.update({
      where: { id },
      data: {
        lastTarget: safeTarget,
      },
    });
  } catch (err) {
    console.warn("[CHAT SESSION] setLastTarget failed:", err.code || err.message);
    return null;
  }
}

export async function setMood(sessionId, mood = "NORMAL") {
  const id = String(sessionId || "").trim();
  if (!id) return null;

  const rawMood = String(mood || "NORMAL").trim().toUpperCase();
  const safeMood = ["NORMAL", "KESAL", "MARAH"].includes(rawMood)
    ? rawMood
    : "NORMAL";

  try {
    return await prisma.chatSession.update({
      where: { id },
      data: {
        mood: safeMood,
      },
    });
  } catch (err) {
    console.warn("[CHAT SESSION] setMood failed:", err.code || err.message);
    return null;
  }
}

export async function resetSession(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;

  try {
    return await prisma.chatSession.update({
      where: { id },
      data: {
        flowState: "CHAT",
        lastIntent: "CHAT",
        lastContext: null,
        lastTarget: null,
        escalated: false,
      },
    });
  } catch (err) {
    console.warn("[CHAT SESSION] resetSession failed:", err.code || err.message);
    return null;
  }
}

export async function disableAI(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;

  try {
    return await prisma.chatSession.update({
      where: { id },
      data: {
        aiEnabled: false,
      },
    });
  } catch (err) {
    console.warn("[CHAT SESSION] disableAI failed:", err.code || err.message);
    return null;
  }
}

export async function enableAI(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;

  try {
    return await prisma.chatSession.update({
      where: { id },
      data: {
        aiEnabled: true,
      },
    });
  } catch (err) {
    console.warn("[CHAT SESSION] enableAI failed:", err.code || err.message);
    return null;
  }
}