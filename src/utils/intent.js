export function detectIntent(text = "") {
  const t = text.toLowerCase();

  if (t.includes("cek") || t.includes("status")) return "CHECK_STATUS";
  if (
    t.includes("komplain") ||
    t.includes("belum masuk") ||
    t.includes("bantu cek") ||
    t.includes("gagal")
  ) return "COMPLAIN";

  return "CHAT";
}

export function extractTrxId(text = "") {
  const m = text.match(/[A-Z0-9]{6,}/i);
  return m ? m[0] : null;
}
