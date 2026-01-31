// src/openAi/manager.js
import "dotenv/config";
import express from "express";
import OpenAI from "openai";

import { systemPrompt } from "./csPrompt.js";
import { getAIMemory, saveAIDecision } from "../services/aiMemory.service.js";

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

  // 1️⃣ Ambil memory
  const mem = await getAIMemory(sessionId);

  // 2️⃣ Build prompt
  const messages = [{ role: "system", content: systemPrompt(brand) }];

  if (mem?.short) {
    messages.push({
      role: "system",
      content: `KONTEKS_SINGKAT: ${mem.short}`,
    });
  }

  messages.push({ role: "user", content: message });

  // 3️⃣ Call OpenAI
  let raw = "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.3,
      messages,
    });
    raw = completion.choices?.[0]?.message?.content || "";
  } catch (err) {
    console.error("OPENAI ERROR:", err.message);
  }

  console.log("RAW",  raw)

  const parsed = safeJsonParse(raw);


  await saveAIDecision({
    sessionId,
    intent: parsed.intent,
    context: parsed.ask || null,
    confidence: parsed.confidence || 0,
  });

  return res.json({
    ok: true,
    data: {
      intent: parsed.intent,
      reply: parsed.reply,
      trxId: parsed.trxId || null,
      msisdn: parsed.msisdn || null,
      ask: parsed.ask || null,
      confidence: parsed.confidence || 0,
    },
  });
});

export default router;
