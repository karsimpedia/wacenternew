import { tgSend } from "./telegramApi.js";
import { waSend } from "./waSender.js";

const DEFAULT_WA_SESSION = process.env.WA_DEFAULT_SESSION || "pc";

function normalizeSupplierCs(cs) {
  if (!cs || typeof cs !== "object") return [];

  const list = [];

  if (cs.whatsapp) {
    list.push({
      channel: "WA",
      contact: cs.whatsapp,
      isActive: true,
      priority: 1,
    });
  }

  if (cs.telegram) {
    list.push({
      channel: "TELEGRAM",
      contact: cs.telegram,
      isActive: true,
      priority: 2,
    });
  }

  if (cs.email) {
    list.push({
      channel: "EMAIL",
      contact: cs.email,
      isActive: true,
      priority: 3,
    });
  }

  return list;
}




function normalizeChannel(v = "") {
  const s = String(v).toUpperCase();
  if (["WA", "WHATSAPP"].includes(s)) return "WA";
  if (["TG", "TELEGRAM"].includes(s)) return "TELEGRAM";
  return null;
}

/**
 * Dispatch pesan ke CS supplier (multi channel + fallback)
 * @param {Array} csList
 * @param {string} message
 */
export async function dispatchToSupplier(csList, message) {
 
console.log("cslist", csList )
 if (!message || !String(message).trim()) {
    return { sent: false, reason: "EMPTY_MESSAGE" };
  }

  // 🔥 SUPPORT OBJECT supplierCs
  if (csList && !Array.isArray(csList) && typeof csList === "object") {
    csList = normalizeSupplierCs(csList);
  }

  if (!Array.isArray(csList) || csList.length === 0) {
    return { sent: false, reason: "NO_CS" };
  }

  const sorted = csList
    .filter((c) => c?.isActive && c?.contact)
    .map((c) => ({
      ...c,
      channel: normalizeChannel(c.channel),
    }))
    .filter((c) => c.channel)
    .sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10));

  for (const cs of sorted) {
    try {
      if (cs.channel === "TELEGRAM") {
        await tgSend(cs.contact, message);
        return {
          sent: true,
          channel: "TELEGRAM",
          contact: cs.contact,
          csId: cs.id,
        };
      }

      if (cs.channel === "WA") {
        await waSend(
          cs.session || DEFAULT_WA_SESSION,
          cs.contact,
          message,
        );
        return {
          sent: true,
          channel: "WA",
          contact: cs.contact,
          csId: cs.id,
        };
      }
    } catch (err) {
      console.warn(
        `[SUPPLIER DISPATCH FAIL] ${cs.channel} ${cs.contact}`,
        err.message,
      );
    }
  }

  return { sent: false, reason: "ALL_CHANNEL_FAILED" };
}
