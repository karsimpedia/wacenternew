// src/server.js

import "dotenv/config";
import express from "express";
import { getSession, getState } from "./wa/manager.js";
import { genOtp, signOtp, verifyOtp } from "./otp.js";

const router = express.Router();
const DEFAULT_SESSION = process.env.WA_DEFAULT_SESSION || "pc";
const webhook = {
  url: process.env.INBOUND_WEBHOOK_URL,
  secret: process.env.INBOUND_WEBHOOK_SECRET,
};

// 🔥 auto-init saat server start
console.log("🚀 Bootstrapping WA session...");
getSession(DEFAULT_SESSION, webhook);

// status
router.get("/:session/status", (req, res) => {
  res.json(getState(req.params.session));
});

// QR
router.get("/:session/qr", (req, res) => {
  const wa = getSession(req.params.session, webhook);

  console.log("READY:", wa.state.ready);
  console.log("QR:", wa.state.qr);
  res.json({
    ready: wa.state.ready,
    qr: wa.state.ready ? null : wa.state.qr,
  });
});

// send text
router.post("/:session/send", async (req, res) => {
  const wa = getSession(req.params.session, webhook);

  const result = await wa.sendText(req.body.phone, req.body.message);
  if (!result.ok) {
    return res.status(503).json(result);
  }

  res.json({ ok: true });
});

router.get("/:session/send", async (req, res) => {
  const wa = getSession(req.params.session, webhook);

  const { phone, message } = req.query;

  if (!phone || !message) {
    return res.status(400).json({
      ok: false,
      msg: "phone & message required",
    });
  }

  if (!wa.state.ready) {
    return res.status(503).json({
      ok: false,
      msg: "WA not ready",
    });
  }

  await wa.sendText(phone, message);
  res.json({ ok: true });
});

// send image
router.post("/:session/send-image", async (req, res) => {
  const wa = await getSession(req.params.session, webhook);
  await wa.sendImage(req.body.phone, req.body.path, req.body.caption);
  res.json({ ok: true });
});

// send file
router.post("/:session/send-file", async (req, res) => {
  const wa = await getSession(req.params.session, webhook);
  await wa.sendFile(req.body.phone, req.body.path, req.body.caption);
  res.json({ ok: true });
});

// OTP request
router.post("/otp/request", async (req, res) => {
  const otp = genOtp();
  const exp = Date.now() + Number(process.env.OTP_TTL) * 1000;
  const token = signOtp(req.body.phone, otp, exp, process.env.OTP_SECRET);

  const wa = await getSession("main", webhook);
  await wa.sendText(req.body.phone, `OTP kamu: ${otp}`);

  res.json({ token, exp });
});

// OTP verify
router.post("/otp/verify", (req, res) => {
  const ok = verifyOtp(
    req.body.phone,
    req.body.otp,
    req.body.token,
    process.env.OTP_SECRET,
  );
  res.json({ ok });
});

export default router;
