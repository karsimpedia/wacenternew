import express from "express";
import axios from "axios";
import { prisma } from "../prisma.js";

import { tgSend } from "../services/telegramApi.js";
import {
  getTrxStatus,
  getSupplierCS,

} from "../services/mainApi.js";

import { getOrCreateSession } from "../services/chatSession.service.js";
import { saveIncomingMessage } from "../services/chatMessage.service.js";

const router = express.Router();
const AI_DECIDE_URL = `http://localhost:${process.env.PORT}/ai/cs/decide`;

function extractText(body) {
  return body?.message?.text || body?.edited_message?.text || "";
}

function extractChatId(body) {
  return body?.message?.chat?.id;
}

function extractUserKey(body) {
  return String(body?.message?.from?.id);
}

router.post("/", async (req, res) => {
  try {
    const text = extractText(req.body);
    const chatId = extractChatId(req.body);
    const userKey = extractUserKey(req.body);

    if (!text || !chatId || !userKey) {
      return res.json({ ok: true });
    }

    // 1️⃣ Session
    const session = await getOrCreateSession("TELEGRAM", userKey);

    // 2️⃣ Save message
    await saveIncomingMessage({
      sessionId: session.id,
      message: text,
      externalId: String(req.body.update_id),
      rawPayload: req.body,
    });

    // 3️⃣ AI Decide
    const aiResp = await axios.post(AI_DECIDE_URL, {
      sessionId: session.id,
      userId: userKey,
      message: text,
      lastIntent: session.lastIntent,
      lastContext: session.lastContext,
    });

    const ai = aiResp.data?.data || {};

    // ================= CHECK STATUS =================
    if (ai.intent === "CHECK_STATUS") {
      const trxId = text.match(/\bTRX\d+\b/i)?.[0];
      const msisdn = text.match(/08\d{8,12}/)?.[0];

      if (!trxId && !msisdn) {
        await tgSend(chatId, "Kirim *ID transaksi* atau *nomor tujuan* ya 🙏");
        return res.json({ ok: true });
      }

      if (trxId) {
        const trx = await getTrxStatus(trxId);
        if (!trx) {
          await tgSend(chatId, "Transaksi tidak ditemukan 🙏");
          return res.json({ ok: true });
        }

        await tgSend(
          chatId,
          `📄 *Status Transaksi*\n\nID: ${trx.id}\nProduk: ${trx.product}\nStatus: *${trx.status}*`,
        );
        return res.json({ ok: true });
      }

      const list = await getTodayTrxByTarget(msisdn);
      if (!list.length) {
        await tgSend(chatId, "Belum ada transaksi hari ini 🙏");
        return res.json({ ok: true });
      }

      const trx = list[0];
      await tgSend(
        chatId,
        `📄 *Status Transaksi*\n\nID: ${trx.id}\nProduk: ${trx.product}\nStatus: *${trx.status}*`,
      );

      return res.json({ ok: true });
    }

    // ================= COMPLAIN =================
    if (ai.intent === "COMPLAIN") {
      const trxId = text.match(/\bTRX\d+\b/i)?.[0];
      if (!trxId) {
        await tgSend(chatId, "Mohon kirim ID transaksi dulu ya 🙏");
        return res.json({ ok: true });
      }

      const trx = await getTrxStatus(trxId);
      if (!trx) {
        await tgSend(chatId, "Transaksi tidak ditemukan 🙏");
        return res.json({ ok: true });
      }

      const cs = await getSupplierCS(trx.supplierCode);
      if (cs?.contact) {
        await tgSend(
          cs.contact,
          `[COMPLAIN]\nID: ${trx.id}\nStatus: ${trx.status}`,
        );
      }

      await tgSend(chatId, "Komplain sudah kami teruskan kak 🙏");
      return res.json({ ok: true });
    }

    // ================= CHAT NORMAL =================
    await tgSend(chatId, ai.reply || "Halo 👋 Ada yang bisa dibantu?");
    return res.json({ ok: true });
  } catch (err) {
    console.error("TELEGRAM WEBHOOK ERROR:", err.message);
    return res.json({ ok: true });
  }
});

export default router;
