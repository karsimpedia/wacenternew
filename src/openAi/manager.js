// src/openAi/manager.js
import "dotenv/config";
import express from "express";
import fs from "fs";
import mime from "mime-types";
import OpenAI from "openai";

import { systemPrompt, replyPrompt } from "./csPrompt.js";
import { faqGuide } from "./faqGuide.js";
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

function normalizeTopic(v) {
  const allowedTopics = new Set([
    "REGISTER",
    "FORGOT_PIN",
    "DOWNLOAD_APP",
    "HOW_TO_DEPOSIT",
    "HOW_TO_TRANSACTION",
    "ACCOUNT_HELP",
    "DOWNLINE_INFO",
    "APP_PROBLEM",
    "SALDO_INFO",
  ]);

  const s = String(v || "").trim().toUpperCase();
  return allowedTopics.has(s) ? s : null;
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

function clampConfidence(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isDataImageUrl(v = "") {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(String(v || "").trim());
}

function normalizeImageUrl(v) {
  if (!isNonEmptyString(v)) return null;
  const s = String(v).trim();
  if (/^https?:\/\//i.test(s)) return s;
  return null;
}

function normalizeImagePath(v) {
  if (!isNonEmptyString(v)) return null;
  return String(v).trim();
}

function imagePathToDataUrl(imagePath) {
  try {
    const normalizedPath = normalizeImagePath(imagePath);
    if (!normalizedPath) return null;
    if (!fs.existsSync(normalizedPath)) return null;

    const buffer = fs.readFileSync(normalizedPath);
    const contentType = mime.lookup(normalizedPath) || "image/jpeg";

    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (err) {
    console.warn("imagePathToDataUrl failed:", err.message);
    return null;
  }
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

function buildMemoryText(mem = {}) {
  const parts = [];

  if (mem?.lastIntent && mem.lastIntent !== "UNKNOWN") {
    parts.push(`LAST_INTENT: ${mem.lastIntent}`);
  }

  if (mem?.flowState) {
    parts.push(`FLOW_STATE: ${mem.flowState}`);
  }

  if (mem?.lastContext) {
    parts.push(`LAST_CONTEXT: ${mem.lastContext}`);
  }

  if (mem?.lastTarget) {
    parts.push(`LAST_TARGET: ${mem.lastTarget}`);
  }

  if (mem?.mood) {
    parts.push(`USER_MOOD: ${mem.mood}`);
  }

  if (mem?.short) {
    parts.push(`SHORT_MEMORY: ${mem.short}`);
  }

  if (mem?.summary) {
    parts.push(`LONG_MEMORY: ${mem.summary}`);
  }

  if (Array.isArray(mem?.recentMessages) && mem.recentMessages.length) {
    parts.push(
      "RECENT_MESSAGES:\n" +
        mem.recentMessages
          .map((m) => `${m.role?.toUpperCase?.() || "UNKNOWN"}: ${m.content}`)
          .join("\n"),
    );
  }

  return parts.join("\n\n");
}

function buildUserInput({ message = "", imageUrl = null, imageDataUrl = null }) {
  const content = [];

  if (isNonEmptyString(message)) {
    content.push({
      type: "input_text",
      text: message.trim(),
    });
  }

  if (isNonEmptyString(imageUrl)) {
    content.push({
      type: "input_image",
      image_url: imageUrl.trim(),
      detail: "auto",
    });
  }

  if (isNonEmptyString(imageDataUrl) && isDataImageUrl(imageDataUrl)) {
    content.push({
      type: "input_image",
      image_url: imageDataUrl.trim(),
      detail: "auto",
    });
  }

  return {
    role: "user",
    content,
  };
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

  const topic = normalizeTopic(parsed?.topic);
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

  const data =
    parsed?.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)
      ? parsed.data
      : {};

  const confidence = clampConfidence(parsed?.confidence);

  const needsTransactionLookup =
    parsed?.needsTransactionLookup !== undefined
      ? toBool(parsed.needsTransactionLookup)
      : ["CHECK_STATUS", "COMPLAIN", "FOLLOWUP"].includes(intent) &&
        (!!trxId || !!invoiceId || !!msisdn);

  return {
    intent,
    topic,
    trxId,
    invoiceId,
    msisdn,
    ask,
    reply,
    data,
    confidence,
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

function buildFaqContext(topic) {
  if (!topic) return null;
  return faqGuide?.[topic] || null;
}

function buildFallbackReply({
  intent = "CHAT",
  topic = null,
  transaction = null,
  actionTaken = null,
}) {
  const tx = transaction || {};
  const actionType = String(actionTaken?.type || "").toUpperCase();
  const status = String(tx?.status || "").toUpperCase();

  if (actionType === "NOT_FOUND") {
    return "Maaf kak, data transaksi yang dimaksud belum ketemu. Boleh kirim invoice, trx id, atau nomor tujuan ya 🙏";
  }

  if (actionType === "SUPPLIER_CONTACT_MISSING") {
    return "Maaf kak, transaksi sudah dicek tapi kontak CS supplier belum tersedia 🙏";
  }

  if (actionType === "FOLLOWUP_SUPPLIER_SENT") {
    return "Siap kak, transaksi sudah kami bantu follow up ke supplier ya 🙏";
  }

  if (actionType === "FOLLOWUP_SUPPLIER_FAILED") {
    return "Maaf kak, follow up ke supplier belum berhasil dikirim 🙏";
  }

  if (actionType === "RESENT") {
    return `Siap kak, transaksi berstatus ${status || "-"} dan sudah kami bantu kirim ulang ya 🙏`;
  }

  if (actionType === "WAIT_ONLY") {
    return `Siap kak, transaksi saat ini berstatus ${status || "-"} ya. Mohon ditunggu dulu 🙏`;
  }

  if (actionType === "STATUS_ONLY" || status === "SUCCESS") {
    const id = tx?.id ?? "-";
    const serial = tx?.serial ?? "-";
    const msisdn = tx?.msisdn ?? "-";

    return `Status transaksi kak:\nID: ${id}\nStatus: ${status || "-"}\nSN: ${serial}\nNomor: ${msisdn}`;
  }

  if (actionType === "FINAL_STATUS") {
    return `Transaksi sudah ${status || "-"} kak. Silakan cek kembali ya 🙏`;
  }

  if (intent === "CHAT" && topic === "FORGOT_PIN") {
    return "Kalau lupa PIN, kak bisa keluar dulu dari akun, lalu di halaman login klik Lupa PIN, masukkan nomor HP yang terdaftar, input OTP, lalu buat PIN baru ya 🙂";
  }

  if (intent === "CHAT" && topic === "REGISTER") {
    return "Untuk registrasi, kak bisa buka aplikasi lalu pilih menu Daftar, isi data yang diminta, lalu verifikasi nomor HP dengan OTP ya 🙂";
  }

  if (intent === "CHAT") {
    return "Siap kak 🙂 silakan disampaikan yang ingin ditanyakan ya.";
  }

  return "Siap kak, sedang kami bantu cek ya 🙏";
}

// =====================================================
// /cs/decide
// Support text + image via imageUrl / imagePath
// =====================================================

router.post("/cs/decide", async (req, res) => {
  const sessionId = String(req.body.sessionId || "").trim();
  const userId = String(req.body.userId || "").trim();
  const message = String(req.body.message || "").trim();
  const imageUrl = normalizeImageUrl(req.body.imageUrl);
  const imagePath = normalizeImagePath(req.body.imagePath);

  let imageDataUrl = null;

  if (isNonEmptyString(req.body.imageBase64)) {
    const maybeDataUrl = String(req.body.imageBase64).trim();
    if (isDataImageUrl(maybeDataUrl)) {
      imageDataUrl = maybeDataUrl;
    }
  }

  if (!imageDataUrl && imagePath) {
    imageDataUrl = imagePathToDataUrl(imagePath);
  }

  console.log("/cs/decide", {
    sessionId,
    userId,
    message,
    hasImageUrl: !!imageUrl,
    hasImagePath: !!imagePath,
    hasImageDataUrl: !!imageDataUrl,
  });

  if (!sessionId || !userId || (!message && !imageUrl && !imageDataUrl)) {
    return res.status(400).json({
      ok: false,
      message: "Bad request",
    });
  }

  const brand = process.env.BRAND_NAME || "PulsaKu";

  try {
    const mem = await getAIMemory(sessionId);
    console.log("decide-memory", mem);

    const memoryText = buildMemoryText(mem);
    const userInput = buildUserInput({
      message,
      imageUrl,
      imageDataUrl,
    });

    const input = [
      {
        role: "system",
        content: systemPrompt(brand),
      },
    ];

    if (memoryText) {
      input.push({
        role: "system",
        content: memoryText,
      });
    }

    input.push(userInput);

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input,
      text: {
        format: {
          type: "json_object",
        },
      },
    });

    const raw = response.output_text || "";
    console.log("DECIDE RAW", raw);

    const parsed = safeJsonParse(raw) || {};
    const decision = normalizeDecision(parsed);

    await saveAIDecision({
      sessionId,
      intent: decision.intent,
      context: decision.ask || decision.topic || null,
      confidence: decision.confidence,
    });

    return res.json({
      ok: true,
      data: decision,
    });
  } catch (err) {
    console.error(
      "OPENAI /cs/decide ERROR:",
      err?.response?.data || err?.message || err,
    );

    const fallback = {
      intent: "CHAT",
      topic: null,
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
// Text only
// =====================================================

router.post("/cs/reply", async (req, res) => {
  const sessionId = String(req.body.sessionId || "").trim();
  const userId = String(req.body.userId || "").trim();
  const brand = String(req.body.brand || process.env.BRAND_NAME || "PulsaKu");
  const userMessage = String(req.body.userMessage || "").trim();
  const intent = String(req.body.intent || "CHAT").trim().toUpperCase();
  const topic = normalizeTopic(req.body.topic);

  const transaction = req.body.transaction ?? null;
  const actionTaken = req.body.actionTaken ?? null;
  const incomingExtraContext =
    req.body.extraContext && typeof req.body.extraContext === "object"
      ? req.body.extraContext
      : {};

  const faq = buildFaqContext(topic);

  const extraContext = {
    ...incomingExtraContext,
    faq: incomingExtraContext?.faq || faq || null,
  };

  console.log("/cs/reply", {
    sessionId,
    userId,
    brand,
    userMessage,
    intent,
    topic,
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
          topic,
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
      response_format: { type: "json_object" },
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
        topic,
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
    console.error(
      "OPENAI /cs/reply ERROR:",
      err?.response?.data || err?.message || err,
    );

    const fallbackReply = buildFallbackReply({
      intent,
      topic,
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