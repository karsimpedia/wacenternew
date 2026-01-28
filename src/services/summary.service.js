
//src/services/summary.service.js

import OpenAI from "openai";
import { prisma } from "../prisma.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const WINDOW_SIZE = Number(process.env.SUMMARY_WINDOW_MESSAGES || 10);
const IDLE_MIN = Number(process.env.SUMMARY_IDLE_MINUTES || 5);

function minutesAgo(min) {
  return new Date(Date.now() - min * 60 * 1000);
}

export async function summarizeSession(sessionId) {
  // ambil pesan terakhir
  const messages = await prisma.chatMessage.findMany({
    where: {
      sessionId,
      role: { in: ["USER", "AI"] },
    },
    orderBy: { createdAt: "desc" },
    take: WINDOW_SIZE,
  });

  if (messages.length < 3) return; // belum cukup konteks

  const ordered = messages.reverse();

  const convo = ordered
    .map((m) => `${m.role}: ${m.message}`)
    .join("\n")
    .slice(0, 3000); // safety

  const prompt = `
Ringkas percakapan berikut untuk kebutuhan CUSTOMER SERVICE AI.

Aturan:
- Fokus pada MAKSUD USER
- Simpan ID transaksi jika ada
- Jangan pakai bahasa formal
- Maks 3 kalimat

Percakapan:
${convo}

Jawaban dalam bentuk teks biasa.
`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.2,
    messages: [{ role: "system", content: prompt }],
  });

  const summary =
    completion.choices?.[0]?.message?.content?.trim();

  if (!summary) return;

  const short = summary.slice(0, 180);

  await prisma.chatSummary.upsert({
    where: { sessionId },
    update: {
      summary,
      short,
      lastWindow: new Date(),
    },
    create: {
      sessionId,
      summary,
      short,
      lastWindow: new Date(),
    },
  });
}

// ==============================
// batch worker
// ==============================
export async function runAutoSummary() {
  const idleBefore = minutesAgo(IDLE_MIN);

  const sessions = await prisma.chatSession.findMany({
    where: {
      lastMessageAt: { lte: idleBefore },
      aiEnabled: true,
    },
    select: { id: true },
  });

  for (const s of sessions) {
    try {
      await summarizeSession(s.id);
    } catch (e) {
      console.error("SUMMARY ERROR:", s.id, e.message);
    }
  }
}
