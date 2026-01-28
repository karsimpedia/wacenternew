// src/webhook/wa.js
import express from "express";
import axios from "axios";
import {
  detectMoodByRule,
  detectMoodByHistory,
  escalateMood,
} from "../services/mood.service.js";
import { prisma } from "../prisma.js";

import {
  getTrxStatus,
  getSupplierCS,
  getTodayTrxByTarget,
} from "../services/mainApi.js";
import { getOrCreateSession } from "../services/chatSession.service.js";
import {
  saveIncomingMessage,
  saveAIReply,
} from "../services/chatMessage.service.js";
import { updateMemory } from "../services/memory.service.js";

const router = express.Router();

const PORT = process.env.PORT;
const WA_BASE = process.env.WA_API_BASE || `http://localhost:${PORT}`;
const AI_DECIDE_URL = `http://localhost:${PORT}/ai/cs/decide`;
const DEFAULT_SESSION = process.env.WA_DEFAULT_SESSION || "pc";

function verifySecret(req) {
  const secret = req.headers["x-webhook-secret"];
  return (
    !process.env.INBOUND_WEBHOOK_SECRET ||
    secret === process.env.INBOUND_WEBHOOK_SECRET
  );
}

async function waSend(session, phone, message) {
  await axios.post(
    `${WA_BASE}/wa/${session}/send`,
    { phone, message },
    { timeout: 8000 },
  );
}

function extractMsisdn(text = "") {
  const m = String(text).match(/08\d{8,12}/);
  return m ? m[0] : null;
}

function extractTrxId(text = "") {
  const m = String(text)
    .toUpperCase()
    .match(/\b(TRX\d{4,})\b/);
  return m ? m[1] : null;
}

function detectCancelOrConfirm(text = "") {
  const t = text.toLowerCase();

  if (["ok", "oke", "ya", "iya", "lanjut"].includes(t)) return "CONFIRM";
  if (["batal", "nggak jadi", "tidak jadi", "ga jadi", "cancel"].includes(t))
    return "CANCEL";

  return null;
}

router.post("/wa", async (req, res) => {
  if (!verifySecret(req)) return res.status(401).json({ ok: false });

  const sessionName = req.body.session || DEFAULT_SESSION;
  const from = String(req.body.from || "").trim();
  const message = String(req.body.message || "").trim();
  const messageId = req.body.messageId; // dari gateway WA

  if (!from || !message) return res.json({ ok: true });
  const action = detectCancelOrConfirm(message);
  try {
    // 1️⃣ get session
    const session = await getOrCreateSession("WA", from);

    // 2️⃣ save incoming message (idempotent)
    const saved = await saveIncomingMessage({
      sessionId: session.id,
      message,
      externalId: messageId,
      rawPayload: req.body,
    });

    if (!saved) return res.json({ ok: true }); // duplicate

    // ====== HARD STOP: USER MEMBATALKAN KOMPLAIN ======
    if (action === "CANCEL" && session.lastIntent === "COMPLAIN") {
      await prisma.chatSession.update({
        where: { id: session.id },
        data: {
          lastIntent: "CHAT",
          lastContext: null,
          lastTarget: null,
        },
      });

      await waSend(
        sessionName,
        from,
        "Baik kak 🙏 Komplain dibatalkan. Jika ingin komplain lagi atau cek transaksi, silakan kirimkan pesan ya.",
      );

      return res.json({ ok: true });
    }

    if (/^[1-5]$/.test(message) && session.lastTarget) {
      const list = await getTodayTrxByTarget(session.lastTarget);
      const trx = list[Number(message) - 1];

      if (trx) {
        await waSend(
          sessionName,
          from,
          `📄 Status transaksi *${trx.id}*: *${trx.status}*`,
        );
      }
      return res.json({ ok: true });
    }

    // ====== STATE RESPONSE: CONFIRM / CANCEL KOMPLAIN ======
    if (action && session.lastIntent === "COMPLAIN") {
      // === USER MEMBATALKAN KOMPLAIN ===
      if (action === "CANCEL") {
        await updateMemory(session.id, {
          intent: "CHAT",
          context: "User membatalkan komplain",
        });

        await waSend(
          sessionName,
          from,
          "Baik kak 🙏 Komplain dibatalkan. Jika butuh bantuan lagi, silakan chat ya.",
        );

        return res.json({ ok: true });
      }

      // === USER KONFIRMASI KOMPLAIN ===
      if (action === "CONFIRM") {
        await updateMemory(session.id, {
          intent: "COMPLAIN",
          context: "User mengkonfirmasi komplain",
        });

        await waSend(
          sessionName,
          from,
          "Siap kak 🙏 Komplain akan kami lanjutkan dan teruskan ke CS supplier.",
        );
        // jangan return
      }
    }

    // ====== MOOD DETECTION ======
    const ruleMood = detectMoodByRule(message);
    let historyMood = "NORMAL";

    if (ruleMood === "NORMAL") {
      historyMood = await detectMoodByHistory(session.id);
    }

    const detected = ruleMood !== "NORMAL" ? ruleMood : historyMood;
    const finalMood = escalateMood(session.mood, detected);

    // update DB jika berubah
    if (finalMood !== session.mood) {
      await prisma.chatSession.update({
        where: { id: session.id },
        data: { mood: finalMood },
      });
    }

    // 3️⃣ AI decide
    const aiResp = await axios.post(
      AI_DECIDE_URL,
      {
        sessionId: session.id,
        userId: from,
        message,
        lastIntent: session.lastIntent,
        lastContext: session.lastContext,
      },
      { timeout: 15000 },
    );

    const ai = aiResp.data?.data || {};

    // ================= STATUS =================
    if (ai.intent === "CHECK_STATUS") {
      const trxId = ai.trxId || extractTrxId(message);
      const msisdn = extractMsisdn(message) || session.lastTarget;

      // 🔒 GUARD CLAUSE — DATA BELUM LENGKAP
      if (!trxId && !msisdn) {
        await waSend(
          sessionName,
          from,
          "Siap kak 🙏 Boleh kirim *ID transaksi* atau *nomor tujuan* (contoh: 08123456789) biar saya cek transaksi hari ini?",
        );
        return res.json({ ok: true });
      }

      // =====================
      // 1️⃣ CEK BY ID (JIKA ADA)
      // =====================
      if (trxId) {
        const trx = await getTrxStatus(trxId);

        if (!trx) {
          await waSend(
            sessionName,
            from,
            `ID *${trxId}* tidak ditemukan kak 🙏  
Boleh cek lagi atau kirim *nomor tujuan* biar saya cari transaksi hari ini.`,
          );
          return res.json({ ok: true });
        }

        const reply = `
📄 *Status Transaksi*

ID: ${trx.id}
Produk: ${trx.product}
Tujuan: ${trx.target}
Status: *${trx.status}*
`.trim();

        await waSend(sessionName, from, reply);

        await prisma.chatSession.update({
          where: { id: session.id },
          data: { lastTarget: trx.target },
        });

        return res.json({ ok: true });
      }

      // =====================
      // 2️⃣ CEK BY NOMOR TUJUAN (HARI INI)
      // =====================
      const list = await getTodayTrxByTarget(msisdn);

      if (list.length === 0) {
        await waSend(
          sessionName,
          from,
          `Hari ini belum ada transaksi untuk nomor *${msisdn}* kak 🙏`,
        );
        return res.json({ ok: true });
      }

      if (list.length === 1) {
        const trx = list[0];
        const reply = `
📄 *Status Transaksi Hari Ini*

Nomor: ${trx.target}
Produk: ${trx.product}
Status: *${trx.status}*
ID: ${trx.id}
`.trim();

        await waSend(sessionName, from, reply);

        await prisma.chatSession.update({
          where: { id: session.id },
          data: { lastTarget: trx.target },
        });

        return res.json({ ok: true });
      }

      // =====================
      // 3️⃣ LEBIH DARI SATU → PILIH
      // =====================
      const options = list
        .slice(0, 5)
        .map((t, i) => `${i + 1}. ${t.product} (${t.status}) – ${t.id}`)
        .join("\n");

      await waSend(
        sessionName,
        from,
        `Hari ini ada *${list.length} transaksi* untuk nomor *${msisdn}*:\n\n${options}\n\nBalas *nomor urutannya* ya kak 🙏`,
      );

      await prisma.chatSession.update({
        where: { id: session.id },
        data: { lastTarget: msisdn },
      });

      return res.json({ ok: true });
    }

    // ================= COMPLAIN =================
    // ================= COMPLAIN =================
    if (ai.intent === "COMPLAIN") {
      const trxId = ai.trxId || extractTrxId(message);
      const msisdn = extractMsisdn(message) || session.lastTarget;

      if (!trxId && !msisdn) {
        await waSend(
          sessionName,
          from,
          "Siap kak 🙏 Mohon kirim *ID transaksi* atau *nomor tujuan* dulu ya, biar komplain bisa kami bantu.",
        );
        return res.json({ ok: true });
      }

      // cari transaksi
      let trx = null;

      if (trxId) {
        trx = await getTrxStatus(trxId);
      } else {
        const list = await getTodayTrxByTarget(msisdn);
        trx = list.find((t) => t.status === "PENDING") || list[0];
      }

      if (!trx) {
        await waSend(
          sessionName,
          from,
          "Transaksi belum kami temukan kak 🙏 Boleh dicek lagi datanya?",
        );
        return res.json({ ok: true });
      }

      // ✅ AMBIL CS SETELAH trx ADA
      const cs = await getSupplierCS(trx.supplierCode);

      if (!cs?.contact) {
        await waSend(
          sessionName,
          from,
          "Mohon maaf kak, CS supplier belum tersedia. Akan kami bantu manual 🙏",
        );
        return res.json({ ok: true });
      }

      const msgSupplier = `
[COMPLAIN TRANSAKSI]

ID: ${trx.id}
Produk: ${trx.product}
Tujuan: ${trx.target}
Status: ${trx.status}
`.trim();

      await waSend(sessionName, cs.contact, msgSupplier);

      const replyUser =
        ai.reply ||
        `Komplain transaksi *${trx.id}* sudah kami teruskan ke CS supplier kak 🙏`;

      await waSend(sessionName, from, replyUser);

      await saveAIReply({
        sessionId: session.id,
        message: replyUser,
        intent: "COMPLAIN",
      });

      await updateMemory(session.id, {
        intent: "COMPLAIN",
        context: `Komplain transaksi ${trx.id}`,
      });

      return res.json({ ok: true });
    }

    // ================= CHAT NORMAL =================

    const reply = ai.reply || "Baik kak 🙏 Ada yang bisa kami bantu?";
    await waSend(sessionName, from, reply);
    await saveAIReply({
      sessionId: session.id,
      message: reply,
      intent: ai.intent || "OTHER",
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("WEBHOOK WA ERROR:", err.response?.data || err.message);
    return res.json({ ok: true });
  }
});

export default router;
