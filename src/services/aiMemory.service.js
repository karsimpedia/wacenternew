// src/services/aiMemory.service.js
import { prisma } from "../prisma.js";

export async function getAIMemory(sessionId) {
  if (!sessionId) {
    return {
      lastIntent: "UNKNOWN",
      lastContext: null,
      short: "",
      summary: "",
    };
  }

  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: { summary: true },
  });

  return {
    lastIntent: session?.lastIntent ?? "UNKNOWN",
    lastContext: session?.lastContext ?? null,
    short: session?.summary?.short ?? "",
    summary: session?.summary?.summary ?? "",
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

  const ctx =
    typeof context === "string" && context.trim()
      ? context.trim().slice(0, 255) // ✂️ aman utk short memory
      : null;

  try {
    // 1️⃣ Update session memory
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        lastIntent: intent,
        lastContext: ctx,
      },
    });
  } catch (err) {
    // session bisa saja sudah di-reset / dihapus
    console.warn("[AI MEMORY] session update skipped:", err.code);
    return;
  }

  // 2️⃣ Log AI decision (audit trail)
  try {
    await prisma.aIDecision.create({
      data: {
        sessionId,
        action,
        reason: ctx,
        confidence,
      },
    });
  } catch (err) {
    console.warn("[AI MEMORY] decision log failed:", err.code);
  }

  // 3️⃣ Upsert short summary (tidak timpa long summary)
  try {
    await prisma.chatSummary.upsert({
      where: { sessionId },
      update: {
        short: ctx,
      },
      create: {
        summary: "",
        short: ctx,
        session: {
          connect: { id: sessionId },
        },
      },
    });
  } catch (err) {
    console.warn("[AI MEMORY] summary upsert failed:", err.code);
  }
}
