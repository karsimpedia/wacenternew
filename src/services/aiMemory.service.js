import { prisma } from "../prisma.js";

export async function getAIMemory(sessionId) {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: { summary: true },
  });

  return {
    lastIntent: session?.lastIntent || "UNKNOWN",
    lastContext: session?.lastContext || null,
    short: session?.summary?.short || null,
    summary: session?.summary?.summary || null,
  };
}

export async function saveAIDecision({
  sessionId,
  intent,
  context,
  action = "REPLY",
  confidence = 0,
}) {
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      lastIntent: intent,
      lastContext: context,
    },
  });

  await prisma.aIDecision.create({
    data: {
      sessionId,
      action,
      reason: context,
      confidence,
    },
  });

  await prisma.chatSummary.upsert({
    where: { sessionId },
    update: {
      short: context,
    },
    create: {
      sessionId,
      summary: context,
      short: context,
    },
  });
}
