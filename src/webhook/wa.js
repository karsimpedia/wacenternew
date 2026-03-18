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

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
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

function normalizeRelativePath(v) {
  if (!isNonEmptyString(v)) return null;
  return String(v).trim();
}

/**
 * Ambil gambar dari payload webhook internal WA.
 * Versi baru utamanya pakai imagePath, bukan base64.
 */
function extractImagePayload(body = {}) {
  const imageUrl =
    normalizeImageUrl(body.imageUrl) ||
    normalizeImageUrl(body.mediaUrl) ||
    normalizeImageUrl(body.url) ||
    normalizeImageUrl(body.image?.url) ||
    normalizeImageUrl(body.media?.url) ||
    normalizeImageUrl(body.message?.imageUrl) ||
    normalizeImageUrl(body.message?.mediaUrl) ||
    normalizeImageUrl(body.data?.imageUrl) ||
    normalizeImageUrl(body.mediaMeta?.url) ||
    null;

  const imagePath =
    normalizeImagePath(body.imagePath) ||
    normalizeImagePath(body.image?.path) ||
    normalizeImagePath(body.media?.path) ||
    normalizeImagePath(body.message?.imagePath) ||
    normalizeImagePath(body.data?.imagePath) ||
    normalizeImagePath(body.mediaMeta?.path) ||
    null;

  const imageRelativePath =
    normalizeRelativePath(body.imageRelativePath) ||
    normalizeRelativePath(body.mediaMeta?.relativePath) ||
    null;

  return {
    imageUrl,
    imagePath,
    imageRelativePath,
    hasImage: !!imageUrl || !!imagePath,
  };
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

async function callAIDecide({
  sessionId,
  userId,
  message,
  imageUrl = null,
  imagePath = null,
}) {
  const resp = await axios.post(
    AI_DECIDE_URL,
    {
      sessionId,
      userId,
      message,
      imageUrl,
      imagePath,
    },
    { timeout: 20000 },
  );

  const data = resp.data?.data || resp.data || {};

  return {
    intent: String(data.intent || "CHAT").toUpperCase(),
    topic: normalizeTopic(data.topic),
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
  topic = null,
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
        topic,
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
  const target = trx?.msisdn || trx?.invoiceId || trx?.id || "-";
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

function buildReplyExtraContext({
  ai = {},
  session = {},
  hasImage = false,
  imageUrl = null,
  imagePath = null,
  imageRelativePath = null,
  mediaMeta = null,
  messageType = null,
}) {
  return {
    topic: ai?.topic || null,
    ask: ai?.ask || null,
    aiData: ai?.data || {},
    hasImage,
    imageUrl: imageUrl || null,
    imagePath: imagePath || null,
    imageRelativePath: imageRelativePath || null,
    mediaMeta: mediaMeta || null,
    messageType: messageType || null,
    flowState: session?.flowState || null,
    lastIntent: session?.lastIntent || null,
    lastContext: session?.lastContext || null,
    lastTarget: session?.lastTarget || null,
  };
}

router.post("/", async (req, res) => {
  if (!verifySecret(req)) {
    return res.status(401).json({ ok: false });
  }

  const sessionName = String(req.body.session || DEFAULT_SESSION).trim();
  const from = String(req.body.from || "").trim();
  const userText = String(req.body.message || req.body.text || "").trim();
  const externalId = req.body.messageId ? String(req.body.messageId) : null;
  const messageType = String(req.body.messageType || "").trim() || null;
  const mediaMeta =
    req.body.mediaMeta && typeof req.body.mediaMeta === "object"
      ? req.body.mediaMeta
      : null;

  const { imageUrl, imagePath, imageRelativePath, hasImage } =
    extractImagePayload(req.body);

  if (!from || (!userText && !hasImage)) {
    return res.json({ ok: true });
  }

  try {
    const session = await getOrCreateSession("WA", from);

    try {
      await saveIncomingMessage({
        sessionId: session.id,
        message: userText || "[IMAGE]",
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
      imageUrl,
      imagePath,
    });

    const intent = ai.intent;
    const topic = ai.topic;

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
        rawPayload: {
          topic,
          aiData: ai.data || {},
          hasImage,
          imagePath,
          imageRelativePath,
        },
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
        (await callAIReply({
          sessionId: session.id,
          userId: from,
          userMessage: userText || "User mengirim bukti deposit",
          intent,
          topic,
          transaction: null,
          actionTaken: { type: "ASK_DEPOSIT_DATA" },
          extraContext: buildReplyExtraContext({
            ai,
            session,
            hasImage,
            imageUrl,
            imagePath,
            imageRelativePath,
            mediaMeta,
            messageType,
          }),
        })) ||
        ai.reply ||
        "Siap kak 🙏 mohon kirim data depositnya ya: nominal transfer, bank tujuan deposit, ID reseller, dan waktu transfer jika ada.";

      await sendAndSaveReply({
        sessionName,
        to: from,
        sessionId: session.id,
        message: reply,
        intent,
        rawPayload: {
          topic,
          depositData,
          hasImage,
          imagePath,
          imageRelativePath,
        },
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
          (await callAIReply({
            sessionId: session.id,
            userId: from,
            userMessage: userText || "User mengirim screenshot transaksi",
            intent,
            topic,
            transaction: null,
            actionTaken: { type: "ASK_TRX_DATA" },
            extraContext: buildReplyExtraContext({
              ai,
              session,
              hasImage,
              imageUrl,
              imagePath,
              imageRelativePath,
              mediaMeta,
              messageType,
            }),
          })) ||
          ai.reply ||
          "Boleh kirim ID transaksi, invoice, atau nomor tujuan ya kak 🙏";

        await sendAndSaveReply({
          sessionName,
          to: from,
          sessionId: session.id,
          message: askReply,
          intent,
          rawPayload: {
            topic,
            aiData: ai.data || {},
            hasImage,
            imagePath,
            imageRelativePath,
          },
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
            userMessage: userText || "User mengirim data transaksi",
            intent,
            topic,
            transaction: {
              found: false,
              trxId: ai.trxId || null,
              invoiceId: ai.invoiceId || null,
              msisdn: ai.msisdn || null,
            },
            actionTaken: {
              type: "NOT_FOUND",
            },
            extraContext: buildReplyExtraContext({
              ai,
              session,
              hasImage,
              imageUrl,
              imagePath,
              imageRelativePath,
              mediaMeta,
              messageType,
            }),
          })) ||
          "Transaksi tidak ditemukan kak 🙏";

        await sendAndSaveReply({
          sessionName,
          to: from,
          sessionId: session.id,
          message: reply,
          intent,
          rawPayload: {
            topic,
            lookup,
            hasImage,
            imagePath,
            imageRelativePath,
          },
        });

        await resetSession(session.id);
        return res.json({ ok: true });
      }

      await updateSession(session.id, {
        lastTarget:
          trx?.msisdn ||
          trx?.invoiceId ||
          ai.msisdn ||
          ai.invoiceId ||
          ai.trxId ||
          null,
      });

      // ---------- FOLLOWUP ----------
      if (intent === "FOLLOWUP") {
        if (!trx?.supplierCs) {
          const reply =
            (await callAIReply({
              sessionId: session.id,
              userId: from,
              userMessage: userText || "User minta follow up",
              intent,
              topic,
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
              extraContext: buildReplyExtraContext({
                ai,
                session,
                hasImage,
                imageUrl,
                imagePath,
                imageRelativePath,
                mediaMeta,
                messageType,
              }),
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
            userMessage: userText || "User minta follow up",
            intent,
            topic,
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
            extraContext: buildReplyExtraContext({
              ai,
              session,
              hasImage,
              imageUrl,
              imagePath,
              imageRelativePath,
              mediaMeta,
              messageType,
            }),
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
          userMessage: userText || "User cek transaksi",
          intent,
          topic,
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
          extraContext: buildReplyExtraContext({
            ai,
            session,
            hasImage,
            imageUrl,
            imagePath,
            imageRelativePath,
            mediaMeta,
            messageType,
          }),
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
    // 4) CHAT BIASA / FAQ
    // =========================
    const chatReply =
      (await callAIReply({
        sessionId: session.id,
        userId: from,
        userMessage: userText || "User mengirim gambar",
        intent: "CHAT",
        topic,
        transaction: null,
        actionTaken: { type: "CHAT_ONLY" },
        extraContext: buildReplyExtraContext({
          ai,
          session,
          hasImage,
          imageUrl,
          imagePath,
          imageRelativePath,
          mediaMeta,
          messageType,
        }),
      })) ||
      ai.reply ||
      "Siap kak 😊 silakan ditanyakan.";

    await sendAndSaveReply({
      sessionName,
      to: from,
      sessionId: session.id,
      message: chatReply,
      intent: "CHAT",
      rawPayload: {
        topic,
        aiData: ai.data || {},
        hasImage,
        imagePath,
        imageRelativePath,
      },
    });

    await updateSession(session.id, {
      flowState: FLOW.CHAT,
      lastIntent: "CHAT",
      lastContext: topic || null,
      lastTarget: null,
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