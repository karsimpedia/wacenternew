//src/workers/summary.worker.js


import "dotenv/config";
import { runAutoSummary } from "../services/summary.service.js";

console.log("🧠 Auto Summary Worker started");

setInterval(async () => {
  try {
    await runAutoSummary();
  } catch (e) {
    console.error("SUMMARY WORKER ERROR:", e.message);
  }
}, 60 * 1000); // tiap 1 menit
