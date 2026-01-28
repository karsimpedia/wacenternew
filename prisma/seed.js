// prisma/seed.js
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding CS AI database...");

  // =========================
  // Chat Session Dummy
  // =========================
  const session = await prisma.chatSession.upsert({
    where: {
      channel_userKey: {
        channel: "WA",
        userKey: "628111111111",
      },
    },
    update: {},
    create: {
      channel: "WA",
      userKey: "628111111111",
      lastIntent: "PENDING",
      lastContext: "cek status transaksi",
      mood: "KESAL",
      lastMessageAt: new Date(),
    },
  });

  // =========================
  // Messages
  // =========================
  await prisma.chatMessage.createMany({
    data: [
      {
        sessionId: session.id,
        role: "USER",
        message: "Transaksi saya pending",
        intent: "PENDING",
        externalId: "wa-msg-001",
      },
      {
        sessionId: session.id,
        role: "AI",
        message: "Baik, saya cek dulu ya transaksi Anda 🙏",
        intent: "PENDING",
      },
    ],
  });

  // =========================
  // Summary (Memory AI)
  // =========================
  await prisma.chatSummary.upsert({
    where: { sessionId: session.id },
    update: {},
    create: {
      sessionId: session.id,
      summary:
        "User mengeluh transaksi pending dan meminta dicek statusnya.",
      short: "pending trx",
    },
  });

  // =========================
  // Intent Log
  // =========================
  await prisma.chatIntent.create({
    data: {
      sessionId: session.id,
      intent: "PENDING",
      confidence: 0.92,
      source: "seed",
    },
  });

  // =========================
  // AI Decision Log
  // =========================
  await prisma.aIDecision.create({
    data: {
      sessionId: session.id,
      action: "REPLY",
      reason: "User menanyakan status transaksi",
      confidence: 0.91,
      promptHash: "seed-hash",
    },
  });

  // =========================
  // Escalation Sample
  // =========================
  await prisma.chatEscalation.create({
    data: {
      sessionId: session.id,
      reason: "User mulai kesal, perlu monitoring",
      status: "OPEN",
    },
  });

  console.log("✅ Seed selesai");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
