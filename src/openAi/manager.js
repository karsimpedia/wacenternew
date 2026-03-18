// src/openAi/manager.js
import "dotenv/config";
import express from "express";
import OpenAI from "openai";

import { systemPrompt, replyPrompt } from "./csPrompt.js";
import { getAIMemory, saveAIDecision } from "../services/aiMemory.service.js";

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// =====================================================
// Helpers
// =====================================================

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function onlyDigits(text = "") {
  return String(text || "").replace(/\D/g, "");
}

function normalizeMsisdn(v) {
  const d = onlyDigits(v);
  return d.length >= 5 ? d : null;
}

function normalizeTrxId(v) {
  const s = String(v || "").trim();
  return s.length ? s : null;
}

function normalizeInvoiceId(v) {
  const s = String(v || "").trim();
  return s.length ? s : null;
}

function toBool(v, fallback = false) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const x = v.trim().toLowerCase();
    if (x === "true") return true;
    if (x === "false") return false;
  }
  return fallback;
}

function buildMemoryMessages(mem = {}) {
  const messages = [];

  if (mem?.lastIntent && mem.lastIntent !== "UNKNOWN") {
    messages.push({
      role: "system",
      content: `LAST_INTENT: ${mem.lastIntent}`,
    });
  }

  if (mem?.flowState) {
    messages.push({
      role: "system",
      content: `FLOW_STATE: ${mem.flowState}`,
    });
  }

  if (mem?.lastContext) {
    messages.push({
      role: "system",
      content: `LAST_CONTEXT: ${mem.lastContext}`,
    });
  }

  if (mem?.lastTarget) {
    messages.push({
      role: "system",
      content: `LAST_TARGET: ${mem.lastTarget}`,
    });
  }

  if (mem?.mood) {
    messages.push({
      role: "system",
      content: `USER_MOOD: ${mem.mood}`,
    });
  }

  if (mem?.short) {
    messages.push({
      role: "system",
      content: `SHORT_MEMORY: ${mem.short}`,
    });
  }

  if (mem?.summary) {
    messages.push({
      role: "system",
      content: `LONG_MEMORY: ${mem.summary}`,
    });
  }

  if (Array.isArray(mem?.recentMessages) && mem.recentMessages.length) {
    messages.push({
      role: "system",
      content:
        "RECENT_MESSAGES:\n" +
        mem.recentMessages
          .map((m) => `${m.role?.toUpperCase?.() || "UNKNOWN"}: ${m.content}`)
          .join("\n"),
    });
  }

  return messages;
}

function normalizeDecision(parsed = {}) {
  const allowedIntents = new Set([
    "CHAT",
    "CHECK_STATUS",
    "COMPLAIN",
    "FOLLOWUP",
    "CANCEL_COMPLAIN",
    "DEPOSIT_COMPLAIN",
    "UNKNOWN",
  ]);

  const rawIntent = String(parsed?.intent || "CHAT").trim().toUpperCase();
  const intent = allowedIntents.has(rawIntent) ? rawIntent : "CHAT";

  const trxId = normalizeTrxId(parsed?.trxId);
  const invoiceId = normalizeInvoiceId(parsed?.invoiceId);
  const msisdn = normalizeMsisdn(parsed?.msisdn);

  const ask =
    typeof parsed?.ask === "string" && parsed.ask.trim()
      ? parsed.ask.trim().slice(0, 255)
      : null;

  const reply =
    typeof parsed?.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : null;

  const confidence = Number(parsed?.confidence || 0);

  const needsTransactionLookup =
    parsed?.needsTransactionLookup !== undefined
      ? toBool(parsed.needsTransactionLookup)
      : ["CHECK_STATUS", "COMPLAIN", "FOLLOWUP"].includes(intent) &&
        (!!trxId || !!invoiceId || !!msisdn);

  const data =
    parsed?.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)
      ? parsed.data
      : {};

  return {
    intent,
    trxId,
    invoiceId,
    msisdn,
    ask,
    reply,
    data,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    needsTransactionLookup,
  };
}

function normalizeReply(parsed = {}) {
  const reply =
    typeof parsed?.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : null;

  return { reply };
}

function buildFallbackReply({
  intent = "CHAT",
  transaction = null,
  actionTaken = null,
}) {
  const tx = transaction || {};
  const actionType = String(actionTaken?.type || "").toUpperCase();
  const status = String(tx?.status || "").toUpperCase();

  if (actionType === "NOT_FOUND") {
    return "Transaksi tidak ditemukan kak 🙏";
  }

  if (actionType === "SUPPLIER_CONTACT_MISSING") {
    return "Saya sudah cek transaksinya kak, tapi kontak CS supplier belum tersedia 🙏";
  }

  if (actionType === "FOLLOWUP_SUPPLIER_SENT") {
    return "Siap kak 🙏 sudah saya follow up ke supplier. Mohon ditunggu ya.";
  }

  if (actionType === "FOLLOWUP_SUPPLIER_FAILED") {
    return "Maaf kak 🙏 saya belum berhasil kirim follow up ke supplier.";
  }

  if (actionType === "RESENT") {
    return `Siap kak 🙏 transaksi saat ini berstatus *${status || "-"}* dan sudah saya bantu kirim ulang. Mohon ditunggu ya kak.`;
  }

  if (actionType === "WAIT_ONLY") {
    return `Siap kak 🙏 transaksi saat ini berstatus *${status || "-"}*. Mohon ditunggu dulu ya kak.`;
  }

  if (actionType === "STATUS_ONLY" || status === "SUCCESS") {
    const id = tx?.id ?? "-";
    const serial = tx?.serial ?? "-";
    const msisdn = tx?.msisdn ?? "-";

    return `📄 *Status Transaksi*\nID: ${id}\nStatus: *${status || "-"}*\nSN: *${serial}*\nMSISDN: *${msisdn}*`;
  }

  if (actionType === "FINAL_STATUS") {
    return `Transaksi sudah *${status || "-"}* kak. Coba cek kembali ID, invoice, atau nomor tujuan ya 🙏`;
  }

  if (intent === "CHAT") {
    return "Siap kak 😊 silakan ditanyakan.";
  }

  return "Siap kak 🙏 sedang saya bantu cek ya.";
}

// =====================================================
// /cs/decide
// =====================================================

router.post("/cs/decide", async (req, res) => {
  const sessionId = String(req.body.sessionId || "").trim();
  const userId = String(req.body.userId || "").trim();
  const message = String(req.body.message || "").trim();

  console.log("/cs/decide", req.body);

  if (!sessionId || !userId || !message) {
    return res.status(400).json({
      ok: false,
      message: "Bad request",
    });
  }

  const brand = process.env.BRAND_NAME || "PulsaKu";

  try {
    const mem = await getAIMemory(sessionId);
    console.log("decide-memory", mem);

    const messages = [
      { role: "system", content: systemPrompt(brand) },
      ...buildMemoryMessages(mem),
      { role: "user", content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",     
      messages,
    });

    const raw = completion.choices?.[0]?.message?.content || "";
    console.log("DECIDE RAW", raw);

    const parsed = safeJsonParse(raw) || {};
    const decision = normalizeDecision(parsed);

    await saveAIDecision({
      sessionId,
      intent: decision.intent,
      context: decision.ask,
      confidence: decision.confidence,
    });

    return res.json({
      ok: true,
      data: decision,
    });
  } catch (err) {
    console.error("OPENAI /cs/decide ERROR:", err.response?.data || err.message);

    const fallback = {
      intent: "CHAT",
      trxId: null,
      invoiceId: null,
      msisdn: null,
      ask: null,
      reply: null,
      data: {},
      confidence: 0,
      needsTransactionLookup: false,
    };

    try {
      await saveAIDecision({
        sessionId,
        intent: fallback.intent,
        context: null,
        confidence: 0,
      });
    } catch (e) {
      console.warn("saveAIDecision fallback failed:", e.code || e.message);
    }

    return res.json({
      ok: true,
      data: fallback,
    });
  }
});

// =====================================================
// /cs/reply
// =====================================================

router.post("/cs/reply", async (req, res) => {
  const sessionId = String(req.body.sessionId || "").trim();
  const userId = String(req.body.userId || "").trim();
  const brand = String(req.body.brand || process.env.BRAND_NAME || "PulsaKu");
  const userMessage = String(req.body.userMessage || "").trim();
  const intent = String(req.body.intent || "CHAT").trim().toUpperCase();

  const transaction = req.body.transaction ?? null;
  const actionTaken = req.body.actionTaken ?? null;
  const extraContext = req.body.extraContext ?? null;

  console.log("/cs/reply", {
    sessionId,
    userId,
    brand,
    userMessage,
    intent,
    transaction,
    actionTaken,
    extraContext,
  });

  if (!sessionId || !userId) {
    return res.status(400).json({
      ok: false,
      message: "Bad request",
    });
  }

  try {
    const mem = await getAIMemory(sessionId);
    console.log("reply-memory", mem);

    const messages = [
      {
        role: "system",
        content: replyPrompt({
          brand,
          userMessage,
          intent,
          transaction,
          actionTaken,
          extraContext,
        }),
      },
      ...buildMemoryMessages(mem),
      {
        role: "user",
        content: "Buat balasan final untuk user sesuai data yang tersedia.",
      },
    ];

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",    
      messages,
    });

    const raw = completion.choices?.[0]?.message?.content || "";
    console.log("REPLY RAW", raw);

    const parsed = safeJsonParse(raw) || {};
    const normalized = normalizeReply(parsed);

    const finalReply =
      normalized.reply ||
      buildFallbackReply({
        intent,
        transaction,
        actionTaken,
      });

    return res.json({
      ok: true,
      data: {
        reply: finalReply,
      },
    });
  } catch (err) {
    console.error("OPENAI /cs/reply ERROR:", err.response?.data || err.message);

    const fallbackReply = buildFallbackReply({
      intent,
      transaction,
      actionTaken,
    });

    return res.json({
      ok: true,
      data: {
        reply: fallbackReply,
      },
    });
  }
});

export default router;