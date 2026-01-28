// src/openAi/manager.js
import "dotenv/config";
import express from "express";
import OpenAI from "openai";

import { systemPrompt } from "./csPrompt.js";
import {
  getAIMemory,
  saveAIDecision,
} from "../services/aiMemory.service.js";

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

router.post("/cs/decide", async (req, res) => {
  const sessionId = String(req.body.sessionId || "").trim();
  const userId = String(req.body.userId || "").trim();
  const message = String(req.body.message || "").trim();

  if (!sessionId || !userId || !message) {
    return res.status(400).json({ ok: false });
  }

  const brand = process.env.BRAND_NAME || "PulsaKu";

  // 1️⃣ ambil memory dari DB
  const mem = await getAIMemory(sessionId);

  // 2️⃣ build messages (HEMAT TOKEN)
  const messages = [
    { role: "system", content: systemPrompt(brand) },
  ];

  if (mem.short) {
    messages.push({
      role: "system",
      content: `KONTEKS_SINGKAT: ${mem.short}`,
    });
  }

  messages.push({ role: "user", content: message });

  // 3️⃣ call OpenAI
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.3,
    messages,
  });

  const raw = completion.choices?.[0]?.message?.content || "";
  const parsed = safeJsonParse(raw);

  // 4️⃣ fallback aman
  if (!parsed?.intent || typeof parsed.reply !== "string") {
    return res.json({
      ok: true,
      data: {
        intent: "CHAT",
        trxId: null,
        reply:
          "Baik kak 🙏 Bisa dijelaskan kendalanya lebih detail? Jika ada, kirim ID transaksi ya.",
        confidence: 0.2,
      },
    });
  }

  // 5️⃣ simpan decision + memory
  const context = (() => {
    const lines = [];
    if (parsed.trxId) lines.push(`Transaksi ${parsed.trxId}`);
    if (parsed.intent === "COMPLAIN") lines.push("User komplain");
    if (parsed.intent === "CHECK_STATUS") lines.push("User cek status");
    return lines.join(" | ").slice(0, 200);
  })();

  await saveAIDecision({
    sessionId,
    intent: parsed.intent,
    context,
    confidence: parsed.confidence || 0,
  });

  return res.json({
    ok: true,
    data: {
      intent: parsed.intent,
      trxId: parsed.trxId || null,
      reply: parsed.reply,
      confidence: parsed.confidence || 0,
    },
  });
});

export default router;
