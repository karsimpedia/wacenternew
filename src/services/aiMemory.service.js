// src/services/aiMemory.service.js
import { prisma } from "../prisma.js";

function normalizeRole(role) {
  if (role === "USER") return "user";
  if (role === "AI") return "assistant";
  if (role === "AGENT") return "assistant";
  if (role === "SYSTEM") return "system";
  return "unknown";
}

function cleanText(v = "", max = 1000) {
  const s = String(v || "").trim();
  return s ? s.slice(0, max) : "";
}

export async function getAIMemory(sessionId) {
  if (!sessionId) {
    return {
      lastIntent: "UNKNOWN",
      flowState: "CHAT",
      lastContext: null,
      lastTarget: null,
      mood: "NORMAL",
      short: "",
      summary: "",
      recentMessages: [],
    };
  }

  const [session, recent] = await Promise.all([
    prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        summary: true,
      },
    }),
    prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        role: true,
        message: true,
        intent: true,
        createdAt: true,
      },
    }),
  ]);

  const recentMessages = (recent || [])
    .slice()
    .reverse()
    .map((item) => ({
      role: normalizeRole(item.role),
      content: cleanText(item.message, 1500),
      intent: item.intent || "UNKNOWN",
      createdAt: item.createdAt,
    }))
    .filter((x) => x.content);

  return {
    lastIntent: session?.lastIntent ?? "UNKNOWN",
    flowState: session?.flowState ?? "CHAT",
    lastContext: session?.lastContext ?? null,
    lastTarget: session?.lastTarget ?? null,
    mood: session?.mood ?? "NORMAL",
    short: session?.summary?.short ?? "",
    summary: session?.summary?.summary ?? "",
    recentMessages,
  };
}

export async function saveAIDecision({
  sessionId,
  intent,
  context,
  action = "REPLY",
  confidence = 0,
}) {
  if (!sessionId) return;

  const cleanIntent =
    typeof intent === "string" && intent.trim()
      ? intent.trim().toUpperCase().slice(0, 50)
      : "UNKNOWN";

  const ctx =
    typeof context === "string" && context.trim()
      ? context.trim().slice(0, 255)
      : null;

  const score = Number(confidence);
  const safeConfidence = Number.isFinite(score) ? score : 0;

  try {
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        lastIntent: cleanIntent,
        lastContext: ctx,
      },
    });
  } catch (err) {
    console.warn("[AI MEMORY] session update skipped:", err.code || err.message);
    return;
  }

  try {
    await prisma.aIDecision.create({
      data: {
        sessionId,
        action,
        reason: ctx,
        confidence: safeConfidence,
      },
    });
  } catch (err) {
    console.warn("[AI MEMORY] decision log failed:", err.code || err.message);
  }
}

export async function saveShortMemory(sessionId, shortText = "") {
  if (!sessionId) return null;

  const short = cleanText(shortText, 500);

  try {
    return await prisma.chatSummary.upsert({
      where: { sessionId },
      update: {
        short,
      },
      create: {
        sessionId,
        summary: "",
        short,
      },
    });
  } catch (err) {
    console.warn("[AI MEMORY] saveShortMemory failed:", err.code || err.message);
    return null;
  }
}

export async function saveLongSummary(sessionId, summaryText = "") {
  if (!sessionId) return null;

  const summary = cleanText(summaryText, 5000);
  const now = new Date();

  try {
    return await prisma.chatSummary.upsert({
      where: { sessionId },
      update: {
        summary,
        lastWindow: now,
      },
      create: {
        sessionId,
        summary,
        short: "",
        lastWindow: now,
      },
    });
  } catch (err) {
    console.warn("[AI MEMORY] saveLongSummary failed:", err.code || err.message);
    return null;
  }
}

export async function updateSessionState(sessionId, data = {}) {
  if (!sessionId || !data || typeof data !== "object") return null;

  try {
    return await prisma.chatSession.update({
      where: { id: sessionId },
      data,
    });
  } catch (err) {
    console.warn("[AI MEMORY] updateSessionState failed:", err.code || err.message);
    return null;
  }
}

export async function resetSessionState(sessionId) {
  if (!sessionId) return null;

  try {
    return await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        flowState: "CHAT",
        lastIntent: "CHAT",
        lastContext: null,
        lastTarget: null,
      },
    });
  } catch (err) {
    console.warn("[AI MEMORY] resetSessionState failed:", err.code || err.message);
    return null;
  }
}