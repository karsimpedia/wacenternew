// src/services/telegramApi.js
import axios from "axios";

const BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// hanya numeric atau group id (-100xxxx)
function isValidChatId(v) {
  return /^-?\d+$/.test(String(v));
}

export async function tgSend(chatId, text) {
  if (!chatId || !isValidChatId(chatId)) {
    return { ok: false, reason: "INVALID_CHAT_ID" };
  }

  if (!text || !String(text).trim()) {
    return { ok: false, reason: "EMPTY_MESSAGE" };
  }

  try {
    const resp = await axios.post(
      `${BASE}/sendMessage`,
      {
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      },
      { timeout: 8000 }
    );

    return {
      ok: true,
      messageId: resp.data?.result?.message_id,
    };
  } catch (err) {
    return {
      ok: false,
      reason: "TG_SEND_FAILED",
      status: err.response?.status,
      error: err.response?.data || err.message,
    };
  }
}
