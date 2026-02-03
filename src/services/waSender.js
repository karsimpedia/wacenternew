// src/services/waSender.js
import axios from "axios";

const PORT = process.env.PORT || 3000;
const WA_BASE =
  process.env.WA_API_BASE || `http://localhost:${PORT}`;

/**
 * Kirim pesan WhatsApp via internal WA API
 * @param {string} session - nama session WA (ex: "pc")
 * @param {string} phone - nomor WA tujuan
 * @param {string} message - isi pesan
 */
export async function waSend(session, phone, message) {
  if (!session || !phone || !message) {
    throw new Error("waSend: session, phone, message wajib diisi");
  }

  await axios.post(
    `${WA_BASE}/wa/${session}/send`,
    { phone, message },
    { timeout: 8000 },
  );
}
