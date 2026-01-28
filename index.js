
//index.js


import "dotenv/config";
import express from "express";

import waApi from "./src/server.js";           // router /wa/:session/...
import waWebhook from "./src/webhook/wa.js";   // webhook inbound dari WA
import aiRouter from "./src/openAi/manager.js";// endpoint internal AI

const app = express();
app.use(express.json());

app.use("/wa", waApi);            // /wa/:session/status, /wa/:session/send, dst
app.use("/webhook", waWebhook); // /webhook/wa
app.use("/ai", aiRouter);       // /ai/cs/decide (internal)

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(process.env.PORT, () => {
  console.log(`🚀 WA CS AI running on port ${process.env.PORT}`);
});
