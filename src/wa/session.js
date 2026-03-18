//src/wa/session.js

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  jidNormalizedUser,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";

import pino from "pino";
import qrcode from "qrcode-terminal";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import mime from "mime-types";
import axios from "axios";

// ===============================
// Helpers
// ===============================

function extractTextMessage(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    msg.message?.documentMessage?.caption ||
    ""
  );
}

function getMessageType(msg) {
  const m = msg?.message || {};

  if (m.conversation || m.extendedTextMessage) return "text";
  if (m.imageMessage) return "image";
  if (m.videoMessage) return "video";
  if (m.documentMessage) return "document";

  return "unknown";
}

function resolveUserJid(msg) {
  const k = msg.key || {};

  if (k.remoteJid?.endsWith("@s.whatsapp.net")) return k.remoteJid;
  if (k.remoteJidAlt?.endsWith("@s.whatsapp.net")) return k.remoteJidAlt;
  if (k.participant?.endsWith("@s.whatsapp.net")) return k.participant;

  return null;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getFileExtensionFromMime(mimetype = "", fallback = "bin") {
  const ext = mime.extension(mimetype);
  return ext || fallback;
}

function saveIncomingMedia({
  buffer,
  mimetype = "application/octet-stream",
  sessionId = "default",
  type = "file",
}) {
  const ext = getFileExtensionFromMime(mimetype, type === "image" ? "jpg" : "bin");
  const baseDir = path.join(process.cwd(), "uploads", "wa", sessionId, type);

  ensureDir(baseDir);

  const fileName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const fullPath = path.join(baseDir, fileName);
  const relativePath = `/uploads/wa/${sessionId}/${type}/${fileName}`;

  fs.writeFileSync(fullPath, buffer);

  return {
    fileName,
    fullPath,
    relativePath,
    mimetype,
  };
}

// ===============================
// Dedupe message id
// ===============================

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
    this.state = {
      ready: false,
      qr: null,
    };
  }

  async init() {
    const { state, saveCreds } = await useMultiFileAuthState(
      `./auth/${this.sessionId}`,
    );
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
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
        try {
          if (!msg?.message) continue;
          if (msg.key?.fromMe) continue;
          if (isDuplicateMessage(msg)) continue;

          const rawJid = msg.key?.remoteJid || "";
          if (rawJid.includes("broadcast")) continue;

          const from = resolveUserJid(msg);
          if (!from) {
            console.log("⛔ No valid user JID (privacy/LID-only)");
            continue;
          }

          if (!this.webhook?.url) continue;

          const messageType = getMessageType(msg);
          const text = extractTextMessage(msg);

          let imagePath = null;
          let imageRelativePath = null;
          let imageUrl = null;
          let mediaMeta = null;

          // ===============================
          // Support inbound image
          // ===============================
          if (messageType === "image") {
            try {
              const buffer = await downloadMediaMessage(
                msg,
                "buffer",
                {},
                {
                  logger: pino({ level: "silent" }),
                  reuploadRequest: this.sock.updateMediaMessage,
                },
              );

              if (buffer) {
                const mimetype =
                  msg.message?.imageMessage?.mimetype || "image/jpeg";

                const saved = saveIncomingMedia({
                  buffer,
                  mimetype,
                  sessionId: this.sessionId,
                  type: "image",
                });

                imagePath = saved.fullPath;
                imageRelativePath = saved.relativePath;

                mediaMeta = {
                  type: "image",
                  mimetype,
                  caption: msg.message?.imageMessage?.caption || "",
                  fileName: saved.fileName,
                  path: saved.fullPath,
                  relativePath: saved.relativePath,
                };
              }
            } catch (err) {
              console.error("download image error:", err.message);
            }
          }

          // Bisa diteruskan meskipun tanpa text, asalkan ada gambar
          if (!text && !imagePath && !imageUrl) continue;

          console.log("📩 PESAN USER:", rawJid, "→", from, {
            type: messageType,
            text,
            hasImage: !!imagePath || !!imageUrl,
          });

          await axios.post(
            this.webhook.url,
            {
              session: this.sessionId,
              from,
              message: text || "",
              messageId: msg.key?.id || null,
              messageType,
              imageUrl,
              imagePath,
              imageRelativePath,
              mediaMeta,
              raw: {
                pushName: msg.pushName || null,
                remoteJid: rawJid,
              },
            },
            {
              timeout: 10000,
              headers: {
                "x-webhook-secret": this.webhook.secret || "",
              },
            },
          );
        } catch (e) {
          console.error("Webhook error:", e.message);
        }
      }
    });
  }

  // kirim selalu ke base @s.whatsapp.net
  jid(phoneOrJid) {
    const s = String(phoneOrJid || "");

    if (s.endsWith("@s.whatsapp.net")) {
      return jidNormalizedUser(s);
    }

    let p = s.replace(/[^\d]/g, "");
    if (p.startsWith("0")) p = "62" + p.slice(1);

    return jidNormalizedUser(`${p}@s.whatsapp.net`);
  }

  async sendText(phoneOrJid, text) {
    try {
      if (!this.state.ready) {
        return { ok: false, reason: "WA_NOT_READY", msg: "WA not ready" };
      }

      await this.sock.sendMessage(this.jid(phoneOrJid), { text });

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: "SEND_TEXT_FAILED",
        msg: err.message || "failed to send text",
      };
    }
  }

  async sendFile(phoneOrJid, filePath, caption = "") {
    try {
      if (!this.state.ready) {
        return { ok: false, reason: "WA_NOT_READY", msg: "WA not ready" };
      }

      const buffer = fs.readFileSync(filePath);

      await this.sock.sendMessage(this.jid(phoneOrJid), {
        document: buffer,
        mimetype: mime.lookup(filePath) || "application/octet-stream",
        fileName: path.basename(filePath),
        caption,
      });

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: "SEND_FILE_FAILED",
        msg: err.message || "failed to send file",
      };
    }
  }

  async sendImage(phoneOrJid, filePath, caption = "") {
    try {
      if (!this.state.ready) {
        return { ok: false, reason: "WA_NOT_READY", msg: "WA not ready" };
      }

      const buffer = fs.readFileSync(filePath);

      await this.sock.sendMessage(this.jid(phoneOrJid), {
        image: buffer,
        caption,
      });

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: "SEND_IMAGE_FAILED",
        msg: err.message || "failed to send image",
      };
    }
  }
}