import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import fs from "fs";
import mime from "mime-types";
import axios from "axios";

export default class WASession {
  constructor(sessionId, webhook) {
    this.sessionId = sessionId;
    this.webhook = webhook;
    this.sock = null;
    this.state = {
      ready: false,
      qr: null
    };
  }

  async init() {
    const { state, saveCreds } =
      await useMultiFileAuthState(`./auth/${this.sessionId}`);

    this.sock = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" })
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
        if (code !== DisconnectReason.loggedOut) {
          this.init();
        }
      }
    });

    // inbound message
    this.sock.ev.on("messages.upsert", async ({ messages }) => {
      const msg = messages[0];
      if (!msg?.message || msg.key.fromMe) return;

      if (!this.webhook?.url) return;

      try {
        await axios.post(
          this.webhook.url,
          {
            session: this.sessionId,
            from: msg.key.remoteJid,
            message: msg.message?.conversation || ""
          },
          {
            headers: {
              "x-webhook-secret": this.webhook.secret || ""
            }
          }
        );
      } catch {}
    });
  }

  jid(phone) {
    let p = String(phone).replace(/[^\d]/g, "");
    if (p.startsWith("0")) p = "62" + p.slice(1);
    return `${p}@s.whatsapp.net`;
  }

  async sendText(phone, text) {
    return this.sock.sendMessage(this.jid(phone), { text });
  }

  async sendFile(phone, path, caption = "") {
    const buffer = fs.readFileSync(path);
    return this.sock.sendMessage(this.jid(phone), {
      document: buffer,
      mimetype: mime.lookup(path),
      fileName: path.split("/").pop(),
      caption
    });
  }

  async sendImage(phone, path, caption = "") {
    const buffer = fs.readFileSync(path);
    return this.sock.sendMessage(this.jid(phone), {
      image: buffer,
      caption
    });
  }
}
