import { prisma } from "../prisma.js";

export async function updateMemory(sessionId, { intent, context }) {
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      lastIntent: intent,
      lastContext: context,
        lastTarget: trx.target, 
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
