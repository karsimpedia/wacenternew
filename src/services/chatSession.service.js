import { prisma } from "../prisma.js";

export async function getOrCreateSession(channel, userKey) {
  return prisma.chatSession.upsert({
    where: {
      channel_userKey: { channel, userKey },
    },
    update: {
      lastMessageAt: new Date(),
    },
    create: {
      channel,
      userKey,
      lastMessageAt: new Date(),
    },
  });
}
