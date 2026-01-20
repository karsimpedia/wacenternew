import "dotenv/config";
import express from "express";
import { getSession, getState } from "./wa/manager.js";
import { genOtp, signOtp, verifyOtp } from "./otp.js";

const app = express();
app.use(express.json());

const webhook = {
  url: process.env.INBOUND_WEBHOOK_URL,
  secret: process.env.INBOUND_WEBHOOK_SECRET
};

// status
app.get("/wa/:session/status", (req, res) => {
  res.json(getState(req.params.session));
});

// QR
app.get("/wa/:session/qr", async (req, res) => {
  const wa = await getSession(req.params.session, webhook);
  res.json({ qr: wa.state.qr });
});

// send text
app.post("/wa/:session/send", async (req, res) => {
  const wa = await getSession(req.params.session, webhook);
  await wa.sendText(req.body.phone, req.body.message);
  res.json({ ok: true });
});


app.get("/wa/:session/send", async (req, res) => {
  const wa = await getSession(req.params.session, webhook);

  const { phone, message } = req.query;

  if (!phone || !message) {
    return res.status(400).json({
      ok: false,
      msg: "phone & message required"
    });
  }

  if (!wa.state.ready) {
    return res.status(503).json({
      ok: false,
      msg: "WA not ready"
    });
  }

  await wa.sendText(phone, message);
  res.json({ ok: true });
});

// send image
app.post("/wa/:session/send-image", async (req, res) => {
  const wa = await getSession(req.params.session, webhook);
  await wa.sendImage(req.body.phone, req.body.path, req.body.caption);
  res.json({ ok: true });
});

// send file
app.post("/wa/:session/send-file", async (req, res) => {
  const wa = await getSession(req.params.session, webhook);
  await wa.sendFile(req.body.phone, req.body.path, req.body.caption);
  res.json({ ok: true });
});

// OTP request
app.post("/otp/request", async (req, res) => {
  const otp = genOtp();
  const exp = Date.now() + Number(process.env.OTP_TTL) * 1000;
  const token = signOtp(
    req.body.phone,
    otp,
    exp,
    process.env.OTP_SECRET
  );

  const wa = await getSession("main", webhook);
  await wa.sendText(req.body.phone, `OTP kamu: ${otp}`);

  res.json({ token, exp });
});

// OTP verify
app.post("/otp/verify", (req, res) => {
  const ok = verifyOtp(
    req.body.phone,
    req.body.otp,
    req.body.token,
    process.env.OTP_SECRET
  );
  res.json({ ok });
});

app.listen(process.env.PORT, () =>
  console.log("🚀 WA API running")
);
