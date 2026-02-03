import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";

import pino from "pino";
import qrcode from "qrcode-terminal";
import fs from "fs";
import mime from "mime-types";
import axios from "axios";

// Ambil text dari berbagai tipe pesan
function extractTextMessage(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ""
  );
}

// Resolve JID user yang benar (nomor), walaupun LID mode
function resolveUserJid(msg) {
  const k = msg.key || {};

  if (k.remoteJid?.endsWith("@s.whatsapp.net")) return k.remoteJid;
  if (k.remoteJidAlt?.endsWith("@s.whatsapp.net")) return k.remoteJidAlt;
  if (k.participant?.endsWith("@s.whatsapp.net")) return k.participant;

  return null;
}

// Dedupe message id
const seenMsgIds = new Set();
function isDuplicateMessage(msg) {
  const id = msg.key?.id;
  if (!id) return false;
  if (seenMsgIds.has(id)) return true;
  seenMsgIds.add(id);
  setTimeout(() => seenMsgIds.delete(id), 60_000);
  return false;
}

export default class WASession {
  constructor(sessionId, webhook) {
    this.sessionId = sessionId;
    this.webhook = webhook;
    this.sock = null;
    this.state = { ready: false, qr: null };
  }

  async init() {
    const { state, saveCreds } = await useMultiFileAuthState(`./auth/${this.sessionId}`);

    this.sock = makeWASocket({
      auth: state,
      markOnlineOnConnect: true,
      syncFullHistory: false, 
      browser: ["Chrome", "Windows", "10"],
      logger: pino({ level: "info" }),
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("connection.update", (u) => {
      const { connection, qr, lastDisconnect } = u;

      if (qr) {
        this.state.qr = qr;
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        this.state.ready = true;
        this.state.qr = null;
        console.log(`✅ WA connected [${this.sessionId}]`);
      }

      if (connection === "close") {
        this.state.ready = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log("⚠️ WA disconnected:", code);

        if (code !== DisconnectReason.loggedOut) {
          setTimeout(() => this.init(), 3000);
        }
      }
    });

    // inbound messages -> webhook
    this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        if (!msg?.message) continue;
        if (msg.key?.fromMe) continue;
        if (isDuplicateMessage(msg)) continue;

        const rawJid = msg.key?.remoteJid || "";
        if (rawJid.includes("broadcast")) continue;

        const text = extractTextMessage(msg);
        if (!text) continue;

        const from = resolveUserJid(msg);
        if (!from) {
          console.log("⛔ No valid user JID (privacy/LID-only)");
          continue;
        }

        if (!this.webhook?.url) continue;

        console.log("📩 PESAN USER:", rawJid, "→", from, text);

        try {
          await axios.post(
            this.webhook.url,
            { session: this.sessionId, from, message: text },
            {
              timeout: 5000,
              headers: { "x-webhook-secret": this.webhook.secret || "" },
            }
          );
        } catch (e) {
          console.error("Webhook error:", e.message);
        }
      }
    });
  }

  // kirim selalu ke base @s.whatsapp.net, bisa input nomor atau jid
  jid(phoneOrJid) {
    const s = String(phoneOrJid || "");
    // jika sudah jid
    if (s.endsWith("@s.whatsapp.net")) return jidNormalizedUser(s);

    // ambil digit
    let p = s.replace(/[^\d]/g, "");
    if (p.startsWith("0")) p = "62" + p.slice(1);

    return jidNormalizedUser(`${p}@s.whatsapp.net`);
  }

  // async sendText(phoneOrJid, text) {
  //   if (!this.state.ready) throw new Error("WA not ready");
  //   return this.sock.sendMessage(this.jid(phoneOrJid), { text });
  // }


  async sendText(phoneOrJid, text) {
  if (!this.state.ready) {
    return { ok: false, reason: "WA_NOT_READY" };
  }

  await this.sock.sendMessage(this.jid(phoneOrJid), { text });
  return { ok: true };
}


  async sendFile(phoneOrJid, path, caption = "") {
    if (!this.state.ready) throw new Error("WA not ready");
    const buffer = fs.readFileSync(path);
    return this.sock.sendMessage(this.jid(phoneOrJid), {
      document: buffer,
      mimetype: mime.lookup(path) || "application/octet-stream",
      fileName: path.split("/").pop(),
      caption,
    });
  }

  async sendImage(phoneOrJid, path, caption = "") {
    if (!this.state.ready) throw new Error("WA not ready");
    const buffer = fs.readFileSync(path);
    return this.sock.sendMessage(this.jid(phoneOrJid), { image: buffer, caption });
  }
}
