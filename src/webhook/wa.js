// src/webhook/wa.js — CLEAN FINAL (stable)

import express from "express";
import axios from "axios";
import { prisma } from "../prisma.js";

import { getTrxStatus } from "../services/mainApi.js";
import { getOrCreateSession } from "../services/chatSession.service.js";
import {
  saveIncomingMessage,
  saveAIReply,
} from "../services/chatMessage.service.js";
import { dispatchToSupplier } from "../services/supplierDispatcher.js";

const router = express.Router();

const PORT = process.env.PORT;
const WA_BASE = process.env.WA_API_BASE || `http://localhost:${PORT}`;
const AI_DECIDE_URL = `http://localhost:${PORT}/ai/cs/decide`;
const DEFAULT_SESSION = process.env.WA_DEFAULT_SESSION || "pc";

// =========================
// Flow constants (selaras Prisma)
// =========================
const FLOW = Object.freeze({
  CHAT: "CHAT",
  WAITING_TRX: "COMPLAIN_REQUEST", // dipakai sebagai WAITING_TRX_INFO
});

// =========================
// Helpers
// =========================
function verifySecret(req) {
  const secret = req.headers["x-webhook-secret"];
  return (
    !process.env.INBOUND_WEBHOOK_SECRET ||
    secret === process.env.INBOUND_WEBHOOK_SECRET
  );
}

async function waSend(sessionName, to, message) {
  await axios.post(
    `${WA_BASE}/wa/${sessionName}/send`,
    { phone: to, message },
    { timeout: 8000 },
  );
}

function isGeneralChat(text = "") {
  const t = String(text).trim().toLowerCase();
  return (
    t === "halo" ||
    t === "hai" ||
    t === "hi" ||
    t === "pagi" ||
    t === "siang" ||
    t === "malam" ||
    t.startsWith("tanya") ||
    t.startsWith("mau tanya") ||
    t.includes("tanya lain") ||
    t === "permisi"
  );
}

function onlyDigits(text = "") {
  return String(text).replace(/\D/g, "");
}

// minimal 5 digit (sesuai request kamu sebelumnya)
function normalizeMsisdn(v) {
  const d = onlyDigits(v);
  return d.length >= 5 ? d : null;
}

function normalizeTrxId(v) {
  const s = String(v || "").trim();
  return s.length ? s : null;
}

function trxReplyMinimal(trx) {
  const id = trx?.id ?? "-";
  const status = trx?.status ?? "-";
  const serial = trx?.serial ?? "-";
  const msisdn = trx?.msisdn ?? "-";
  const message = trx?.message ?? "-";

  return `📄 *Status Transaksi*\nID: ${id}\nStatus: *${status}*\nSN: *${serial}*\nMSISDN: *${msisdn}*\nPesan: *${message}*`;
}

async function setSession(sessionId, data) {
  await prisma.chatSession.update({ where: { id: sessionId }, data });
}

async function resetSession(sessionId) {
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      flowState: FLOW.CHAT,
      lastIntent: "CHAT",
      lastContext: null,
      lastTarget: null,
    },
  });
}

// =========================
// Webhook
// =========================
router.post("/", async (req, res) => {
  if (!verifySecret(req)) return res.status(401).json({ ok: false });

  const sessionName = String(req.body.session || DEFAULT_SESSION).trim();
  const from = String(req.body.from || "").trim();
  const userText = String(req.body.message || "").trim();
  const messageId = req.body.messageId;

  if (!from || !userText) return res.json({ ok: true });

  try {
    // 1) session db
    const session = await getOrCreateSession("WA", from);

    // 2) simpan incoming (kalau service kamu support)
    try {
      await saveIncomingMessage({
        sessionId: session.id,
        from,
        messageId: messageId || null,
        message: userText,
      });
    } catch (_) {
      // optional: jangan bikin webhook fail kalau save log gagal
    }

    // 3) kalau lagi nunggu trx/msisdn tapi user nyapa → reset
    if (session.flowState === FLOW.WAITING_TRX && isGeneralChat(userText)) {
      await resetSession(session.id);
      // lanjut ke AI decide normal
    }

    // 4) AI decide
    const aiResp = await axios.post(
      AI_DECIDE_URL,
      {
        sessionId: session.id,
        userId: from,
        message: userText,
        lastIntent: session.lastIntent,
        lastContext: session.lastContext,
      },
      { timeout: 15000 },
    );

    const ai = aiResp.data?.data || aiResp.data || {};
    const intent = String(ai.intent || "CHAT").toUpperCase();

    const trxId = normalizeTrxId(ai.trxId);
    const msisdn = normalizeMsisdn(ai.msisdn);

    // =========================
    // A) FOLLOWUP → kirim komplain ke supplier (kalau ada trx)
    // =========================
    if (intent === "FOLLOWUP") {
      if (!trxId && !msisdn) {
        const reply =
          ai.reply?.trim() ||
          "Siap kak 🙏 boleh kirim ID transaksi atau nomor tujuan ya?";
        await waSend(sessionName, from, reply);
        await saveAIReply({ sessionId: session.id, message: reply, intent });
        await setSession(session.id, {
          flowState: FLOW.WAITING_TRX,
          lastIntent: intent,
          lastContext: "ASK_TRX",
        });
        return res.json({ ok: true });
      }

      const trx = await getTrxStatus(trxId ? { trxId } : { msisdn });
      if (!trx) {
        await waSend(sessionName, from, "Transaksi tidak ditemukan kak 🙏");
        return res.json({ ok: true });
      }

      const target = trx?.msisdn || msisdn || "-";
      const status = trx?.status || "UNKNOWN";

      const supplierText =
        status === "SUCCESS"
          ? `Mohon dibantu kak, transaksi ke ${target} status SUCCESS tapi user melaporkan belum masuk.`
          : `Mohon dibantu kak, transaksi ke ${target} status ${status}.`;

      if (!trx?.supplierCs) {
        const warn =
          "Saya sudah cek transaksinya kak, tapi kontak CS supplier belum tersedia. Mohon info admin ya 🙏";
        await waSend(sessionName, from, warn);
        await saveAIReply({ sessionId: session.id, message: warn, intent });
        await resetSession(session.id);
        return res.json({ ok: true });
      }

      const result = await dispatchToSupplier(trx.supplierCs, supplierText);
      console.log("result", result);
      const userReply = result?.sent
        ? "Siap kak 🙏 sudah saya follow up ke supplier. Mohon ditunggu ya."
        : "Maaf kak 🙏 saya belum berhasil kirim follow up ke supplier. Boleh tunggu sebentar atau kirim ulang ID transaksinya?";

      await waSend(sessionName, from, userReply);
      await saveAIReply({ sessionId: session.id, message: userReply, intent });

      await resetSession(session.id);
      return res.json({ ok: true });
    }

    // =========================
    // B) CHECK_STATUS / COMPLAIN
    // =========================
    if (intent === "CHECK_STATUS" || intent === "COMPLAIN") {
      // kalau belum ada trxId/msisdn → tanya dulu, lock WAITING_TRX
      if (!trxId && !msisdn) {
        const reply =
          ai.reply?.trim() ||
          "Siap kak 🙏 boleh kirim ID transaksi atau nomor tujuan ya?";
        await waSend(sessionName, from, reply);

        await saveAIReply({ sessionId: session.id, message: reply, intent });

        await setSession(session.id, {
          flowState: FLOW.WAITING_TRX,
          lastIntent: intent,
          lastContext: "ASK_TRX",
        });

        return res.json({ ok: true });
      }

      // sudah ada trxId/msisdn → langsung cek status, jangan tanya lagi
      await waSend(sessionName, from, "Siap kak 🙏 saya cek dulu ya...");

      const trx = await getTrxStatus(trxId ? { trxId } : { msisdn });
      if (!trx) {
        await waSend(sessionName, from, "Transaksi tidak ditemukan kak 🙏");
        return res.json({ ok: true });
      }

      const reply = trxReplyMinimal(trx);
      await waSend(sessionName, from, reply);
      await saveAIReply({ sessionId: session.id, message: reply, intent });

      await resetSession(session.id);
      return res.json({ ok: true });
    }

    // =========================
    // C) CHAT normal
    // =========================
    const reply =
      typeof ai.reply === "string" && ai.reply.trim()
        ? ai.reply.trim()
        : "Siap kak 😊 silakan ditanyakan.";

    await waSend(sessionName, from, reply);
    await saveAIReply({
      sessionId: session.id,
      message: reply,
      intent: intent || "CHAT",
    });

    // pastikan state balik CHAT
    if (session.flowState !== FLOW.CHAT || session.lastIntent !== "CHAT") {
      await setSession(session.id, {
        flowState: FLOW.CHAT,
        lastIntent: "CHAT",
        lastContext: null,
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("WA ERROR:", err.response?.data || err.message);
    return res.json({ ok: true });
  }
});

export default router;
