// src/webhook/wa.js

import express from "express";
import axios from "axios";

import { getTrxStatus, resendTrx } from "../services/mainApi.js";
import {
  getOrCreateSession,
  updateSession,
  resetSession,
} from "../services/chatSession.service.js";
import {
  saveIncomingMessage,
  saveAIReply,
} from "../services/chatMessage.service.js";
import { dispatchToSupplier } from "../services/supplierDispatcher.js";

const router = express.Router();

const PORT = process.env.PORT;
const WA_BASE = process.env.WA_API_BASE || `http://localhost:${PORT}`;
const AI_DECIDE_URL = `http://localhost:${PORT}/ai/cs/decide`;
const AI_REPLY_URL = `http://localhost:${PORT}/ai/cs/reply`;
const DEFAULT_SESSION = process.env.WA_DEFAULT_SESSION || "pc";
const BRAND_NAME = process.env.BRAND_NAME || "PulsaKu";

const FLOW = Object.freeze({
  CHAT: "CHAT",
  WAITING_TRX: "COMPLAIN_REQUEST",
});

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
    t === "permisi" ||
    t.startsWith("tanya") ||
    t.startsWith("mau tanya") ||
    t.includes("tanya lain")
  );
}

function onlyDigits(text = "") {
  return String(text).replace(/\D/g, "");
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

async function sendAndSaveReply({
  sessionName,
  to,
  sessionId,
  message,
  intent = "CHAT",
  rawPayload = null,
}) {
  const reply = String(message || "").trim();
  if (!reply) return null;

  await waSend(sessionName, to, reply);
  await saveAIReply({
    sessionId,
    message: reply,
    intent,
    rawPayload,
  });

  return reply;
}

async function callAIDecide({ sessionId, userId, message }) {
  const resp = await axios.post(
    AI_DECIDE_URL,
    {
      sessionId,
      userId,
      message,
    },
    { timeout: 15000 },
  );

  const data = resp.data?.data || resp.data || {};

  return {
    intent: String(data.intent || "CHAT").toUpperCase(),
    trxId: normalizeTrxId(data.trxId),
    invoiceId: normalizeInvoiceId(data.invoiceId),
    msisdn: normalizeMsisdn(data.msisdn),
    ask: data.ask ? String(data.ask).trim() : null,
    reply:
      typeof data.reply === "string" && data.reply.trim()
        ? data.reply.trim()
        : null,
    confidence: Number(data.confidence || 0),
    needsTransactionLookup: Boolean(data.needsTransactionLookup),
    data:
      data?.data && typeof data.data === "object" && !Array.isArray(data.data)
        ? data.data
        : {},
  };
}

async function callAIReply({
  sessionId,
  userId,
  userMessage,
  intent,
  transaction = null,
  actionTaken = null,
  extraContext = null,
}) {
  try {
    const resp = await axios.post(
      AI_REPLY_URL,
      {
        sessionId,
        userId,
        brand: BRAND_NAME,
        userMessage,
        intent,
        transaction,
        actionTaken,
        extraContext,
      },
      { timeout: 15000 },
    );

    const data = resp.data?.data || resp.data || {};
    const reply = String(data.reply || "").trim();
    return reply || null;
  } catch (err) {
    console.error("AI_REPLY ERROR:", err.response?.data || err.message);
    return null;
  }
}

function buildSupplierMessage(trx) {
  const target = trx?.msisdn || trx?.invoiceId || "-";
  const status = String(trx?.status || "UNKNOWN").toUpperCase();

  if (status === "SUCCESS") {
    return `Mohon dibantu kak, transaksi ${target} status SUCCESS tapi user melaporkan belum masuk.`;
  }

  return `Mohon dibantu kak, transaksi ${target} status ${status}.`;
}

function buildDepositContext(depositData = {}) {
  const nominal = depositData?.nominal || null;
  const bank = depositData?.bank || null;
  const waktu = depositData?.waktu || null;
  const idReseller = depositData?.idReseller || null;

  return { nominal, bank, waktu, idReseller };
}

function buildLookup(ai) {
  if (ai?.trxId) return { trxId: ai.trxId };
  if (ai?.invoiceId) return { invoiceId: ai.invoiceId };
  if (ai?.msisdn) return { msisdn: ai.msisdn };
  return null;
}

router.post("/", async (req, res) => {
  if (!verifySecret(req)) {
    return res.status(401).json({ ok: false });
  }

  const sessionName = String(req.body.session || DEFAULT_SESSION).trim();
  const from = String(req.body.from || "").trim();
  const userText = String(req.body.message || "").trim();
  const externalId = req.body.messageId ? String(req.body.messageId) : null;

  if (!from || !userText) {
    return res.json({ ok: true });
  }

  try {
    const session = await getOrCreateSession("WA", from);

    try {
      await saveIncomingMessage({
        sessionId: session.id,
        message: userText,
        externalId,
        rawPayload: req.body || null,
      });
    } catch (err) {
      console.warn("[WA] saveIncomingMessage skipped:", err.code || err.message);
    }

    if (session.flowState === FLOW.WAITING_TRX && isGeneralChat(userText)) {
      await resetSession(session.id);
    }

    const ai = await callAIDecide({
      sessionId: session.id,
      userId: from,
      message: userText,
    });

    const intent = ai.intent;

    // =========================
    // 1) CANCEL COMPLAIN
    // =========================
    if (intent === "CANCEL_COMPLAIN") {
      const reply =
        ai.reply || "Baik kak, komplainnya saya anggap dibatalkan ya 🙏";

      await sendAndSaveReply({
        sessionName,
        to: from,
        sessionId: session.id,
        message: reply,
        intent,
      });

      await resetSession(session.id);
      return res.json({ ok: true });
    }

    // =========================
    // 2) DEPOSIT COMPLAIN
    // =========================
    if (intent === "DEPOSIT_COMPLAIN") {
      const depositData = buildDepositContext(ai.data);

      const reply =
        ai.reply ||
        "Siap kak 🙏 mohon kirim data depositnya ya: nominal transfer, bank tujuan deposit, ID reseller, dan waktu transfer jika ada.";

      await sendAndSaveReply({
        sessionName,
        to: from,
        sessionId: session.id,
        message: reply,
        intent,
      });

      await updateSession(session.id, {
        flowState: FLOW.CHAT,
        lastIntent: intent,
        lastContext: ai.ask || "ASK_DEPOSIT_DATA",
        lastTarget: depositData?.idReseller || null,
      });

      return res.json({ ok: true });
    }

    // =========================
    // 3) FOLLOWUP / CHECK_STATUS / COMPLAIN
    // =========================
    if (["FOLLOWUP", "CHECK_STATUS", "COMPLAIN"].includes(intent)) {
      if (!ai.trxId && !ai.invoiceId && !ai.msisdn) {
        const askReply =
          ai.reply ||
          "Boleh kirim ID transaksi, invoice, atau nomor tujuan ya kak 🙏";

        await sendAndSaveReply({
          sessionName,
          to: from,
          sessionId: session.id,
          message: askReply,
          intent,
        });

        await updateSession(session.id, {
          flowState: FLOW.WAITING_TRX,
          lastIntent: intent,
          lastContext: ai.ask || "ASK_TRX",
          lastTarget: null,
        });

        return res.json({ ok: true });
      }

      const lookup = buildLookup(ai);
      const trx = lookup ? await getTrxStatus(lookup) : null;

      if (!trx) {
        const reply =
          (await callAIReply({
            sessionId: session.id,
            userId: from,
            userMessage: userText,
            intent,
            transaction: {
              found: false,
              trxId: ai.trxId || null,
              invoiceId: ai.invoiceId || null,
              msisdn: ai.msisdn || null,
            },
            actionTaken: {
              type: "NOT_FOUND",
            },
          })) || "Transaksi tidak ditemukan kak 🙏";

        await sendAndSaveReply({
          sessionName,
          to: from,
          sessionId: session.id,
          message: reply,
          intent,
        });

        await resetSession(session.id);
        return res.json({ ok: true });
      }

      await updateSession(session.id, {
        lastTarget:
          trx?.msisdn || trx?.invoiceId || ai.msisdn || ai.invoiceId || ai.trxId || null,
      });

      // ---------- FOLLOWUP ----------
      if (intent === "FOLLOWUP") {
        if (!trx?.supplierCs) {
          const reply =
            (await callAIReply({
              sessionId: session.id,
              userId: from,
              userMessage: userText,
              intent,
              transaction: {
                found: true,
                id: trx.id ?? null,
                invoiceId: trx.invoiceId ?? ai.invoiceId ?? null,
                status: trx.status ?? null,
                serial: trx.serial ?? null,
                msisdn: trx.msisdn ?? null,
              },
              actionTaken: {
                type: "SUPPLIER_CONTACT_MISSING",
              },
            })) ||
            "Saya sudah cek transaksinya kak, tapi kontak CS supplier belum tersedia 🙏";

          await sendAndSaveReply({
            sessionName,
            to: from,
            sessionId: session.id,
            message: reply,
            intent,
          });

          await resetSession(session.id);
          return res.json({ ok: true });
        }

        const supplierText = buildSupplierMessage(trx);
        const result = await dispatchToSupplier(trx.supplierCs, supplierText);

        const reply =
          (await callAIReply({
            sessionId: session.id,
            userId: from,
            userMessage: userText,
            intent,
            transaction: {
              found: true,
              id: trx.id ?? null,
              invoiceId: trx.invoiceId ?? ai.invoiceId ?? null,
              status: trx.status ?? null,
              serial: trx.serial ?? null,
              msisdn: trx.msisdn ?? null,
            },
            actionTaken: {
              type: result?.sent
                ? "FOLLOWUP_SUPPLIER_SENT"
                : "FOLLOWUP_SUPPLIER_FAILED",
            },
          })) ||
          (result?.sent
            ? "Siap kak 🙏 sudah saya follow up ke supplier. Mohon ditunggu ya."
            : "Maaf kak 🙏 saya belum berhasil kirim follow up ke supplier.");

        await sendAndSaveReply({
          sessionName,
          to: from,
          sessionId: session.id,
          message: reply,
          intent,
        });

        await resetSession(session.id);
        return res.json({ ok: true });
      }

      // ---------- CHECK_STATUS / COMPLAIN ----------
      let actionTaken = { type: "NONE" };
      const status = String(trx?.status || "").toUpperCase();

      if (["PENDING", "PROCESSING"].includes(status)) {
        const resendResult = await resendTrx(trx.id);

        actionTaken = resendResult
          ? { type: "RESENT", success: true }
          : { type: "WAIT_ONLY", success: false };
      } else if (status === "SUCCESS") {
        actionTaken = { type: "STATUS_ONLY" };
      } else {
        actionTaken = { type: "FINAL_STATUS" };
      }

      const reply =
        (await callAIReply({
          sessionId: session.id,
          userId: from,
          userMessage: userText,
          intent,
          transaction: {
            found: true,
            id: trx.id ?? null,
            invoiceId: trx.invoiceId ?? ai.invoiceId ?? null,
            status: trx.status ?? null,
            serial: trx.serial ?? null,
            msisdn: trx.msisdn ?? null,
            productCode: trx.productCode ?? null,
            supplier: trx.supplier ?? null,
          },
          actionTaken,
        })) || "Siap kak 🙏 sedang saya bantu cek ya.";

      await sendAndSaveReply({
        sessionName,
        to: from,
        sessionId: session.id,
        message: reply,
        intent,
      });

      await resetSession(session.id);
      return res.json({ ok: true });
    }

    // =========================
    // 4) CHAT BIASA
    // =========================
    const chatReply =
      (await callAIReply({
        sessionId: session.id,
        userId: from,
        userMessage: userText,
        intent: "CHAT",
        transaction: null,
        actionTaken: { type: "CHAT_ONLY" },
      })) ||
      ai.reply ||
      "Siap kak 😊 silakan ditanyakan.";

    await sendAndSaveReply({
      sessionName,
      to: from,
      sessionId: session.id,
      message: chatReply,
      intent: "CHAT",
    });

    await updateSession(session.id, {
      flowState: FLOW.CHAT,
      lastIntent: "CHAT",
      lastContext: null,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("WA ERROR:", err.response?.data || err.message);

    try {
      if (from) {
        await waSend(
          sessionName,
          from,
          "Maaf kak 🙏 sistem sedang gangguan sebentar. Coba kirim ulang pesan ya.",
        );
      }
    } catch (_) {
      // diamkan
    }

    return res.json({ ok: true });
  }
});

export default router;