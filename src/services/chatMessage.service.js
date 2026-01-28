import { prisma } from "../prisma.js";

export async function saveIncomingMessage({
  sessionId,
  message,
  externalId,
  rawPayload,
}) {
  try {
    return await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "USER",
        message,
        externalId,
        rawPayload,
      },
    });
  } catch (e) {
    // duplicate message (WA resend)
    if (e.code === "P2002") return null;
    throw e;
  }
}

export async function saveAIReply({ sessionId, message, intent }) {
  return prisma.chatMessage.create({
    data: {
      sessionId,
      role: "AI",
      message,
      intent,
    },
  });
}
