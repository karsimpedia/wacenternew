//src/services/mood.service.js


import { prisma } from "../prisma.js";

// ===== RULE-BASED =====
export function detectMoodByRule(text = "") {
  const t = text.toLowerCase();

  const angry = [
    "marah", "parah", "kecewa banget", "jelek", "bohong",
    "tidak bertanggung jawab", "penipuan"
  ];
  const upset = [
    "kesel", "lama", "kok belum", "ribet", "ga beres",
    "pending terus", "tidak masuk", "nunggu"
  ];

  if (angry.some(w => t.includes(w))) return "MARAH";
  if (upset.some(w => t.includes(w))) return "KESAL";
  return "NORMAL";
}

// ===== HISTORY-BASED =====
// kalau 3 pesan USER terakhir mirip → KESAL / eskalasi
export async function detectMoodByHistory(sessionId) {
  const msgs = await prisma.chatMessage.findMany({
    where: { sessionId, role: "USER" },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { message: true },
  });

  if (msgs.length < 3) return "NORMAL";

  const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const uniq = new Set(msgs.map(m => norm(m.message)));

  // sama terus → kesal
  if (uniq.size === 1) return "KESAL";
  return "NORMAL";
}

// ===== TRANSISI MOOD (biar natural) =====
export function escalateMood(oldMood, newMood) {
  if (oldMood === "MARAH") return "MARAH";
  if (oldMood === "KESAL" && newMood === "KESAL") return "MARAH";
  if (newMood === "MARAH") return "MARAH";
  if (newMood === "KESAL") return "KESAL";
  return "NORMAL";
}
