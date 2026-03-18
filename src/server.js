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

// =====================================================
// Helpers
// =====================================================

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function badRequest(res, message = "Bad request") {
  return res.status(400).json({
    ok: false,
    msg: message,
  });
}

function serviceUnavailable(res, message = "WA not ready") {
  return res.status(503).json({
    ok: false,
    msg: message,
  });
}

// =====================================================
// Auto init saat server start
// =====================================================

console.log("🚀 Bootstrapping WA session...");
getSession(DEFAULT_SESSION, webhook);

// =====================================================
// Status
// =====================================================

router.get("/:session/status", (req, res) => {
  res.json(getState(req.params.session));
});

// =====================================================
// QR
// =====================================================

router.get("/:session/qr", (req, res) => {
  const wa = getSession(req.params.session, webhook);

  res.json({
    ready: wa.state.ready,
    qr: wa.state.ready ? null : wa.state.qr,
  });
});

// =====================================================
// Send text (legacy)
// =====================================================

router.post("/:session/send", async (req, res) => {
  try {
    const wa = getSession(req.params.session, webhook);
    const phone = String(req.body.phone || "").trim();
    const message = String(req.body.message || "").trim();

    if (!phone || !message) {
      return badRequest(res, "phone & message required");
    }

    const result = await wa.sendText(phone, message);

    if (!result?.ok) {
      return serviceUnavailable(res, result?.msg || "WA not ready");
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /:session/send ERROR:", err.message);
    return res.status(500).json({
      ok: false,
      msg: "failed to send text",
    });
  }
});

router.get("/:session/send", async (req, res) => {
  try {
    const wa = getSession(req.params.session, webhook);
    const phone = String(req.query.phone || "").trim();
    const message = String(req.query.message || "").trim();

    if (!phone || !message) {
      return badRequest(res, "phone & message required");
    }

    if (!wa.state.ready) {
      return serviceUnavailable(res, "WA not ready");
    }

    const result = await wa.sendText(phone, message);

    if (!result?.ok) {
      return serviceUnavailable(res, result?.msg || "WA not ready");
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("GET /:session/send ERROR:", err.message);
    return res.status(500).json({
      ok: false,
      msg: "failed to send text",
    });
  }
});

// =====================================================
// Send image (legacy)
// =====================================================

router.post("/:session/send-image", async (req, res) => {
  try {
    const wa = getSession(req.params.session, webhook);
    const phone = String(req.body.phone || "").trim();
    const path = String(req.body.path || "").trim();
    const caption = isNonEmptyString(req.body.caption)
      ? String(req.body.caption).trim()
      : "";

    if (!phone || !path) {
      return badRequest(res, "phone & path required");
    }

    if (!wa.state.ready) {
      return serviceUnavailable(res, "WA not ready");
    }

    const result = await wa.sendImage(phone, path, caption);

    if (result && result.ok === false) {
      return serviceUnavailable(res, result?.msg || "failed to send image");
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /:session/send-image ERROR:", err.message);
    return res.status(500).json({
      ok: false,
      msg: "failed to send image",
    });
  }
});

// =====================================================
// Send file (legacy)
// =====================================================

router.post("/:session/send-file", async (req, res) => {
  try {
    const wa = getSession(req.params.session, webhook);
    const phone = String(req.body.phone || "").trim();
    const path = String(req.body.path || "").trim();
    const caption = isNonEmptyString(req.body.caption)
      ? String(req.body.caption).trim()
      : "";

    if (!phone || !path) {
      return badRequest(res, "phone & path required");
    }

    if (!wa.state.ready) {
      return serviceUnavailable(res, "WA not ready");
    }

    const result = await wa.sendFile(phone, path, caption);

    if (result && result.ok === false) {
      return serviceUnavailable(res, result?.msg || "failed to send file");
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /:session/send-file ERROR:", err.message);
    return res.status(500).json({
      ok: false,
      msg: "failed to send file",
    });
  }
});

// =====================================================
// Universal send message
// type: text | image | file
// =====================================================

router.post("/:session/send-message", async (req, res) => {
  try {
    const wa = getSession(req.params.session, webhook);

    const phone = String(req.body.phone || "").trim();
    const type = String(req.body.type || "text").trim().toLowerCase();
    const message = isNonEmptyString(req.body.message)
      ? String(req.body.message).trim()
      : "";
    const path = isNonEmptyString(req.body.path)
      ? String(req.body.path).trim()
      : "";
    const caption = isNonEmptyString(req.body.caption)
      ? String(req.body.caption).trim()
      : "";

    if (!phone) {
      return badRequest(res, "phone required");
    }

    if (!wa.state.ready) {
      return serviceUnavailable(res, "WA not ready");
    }

    if (type === "text") {
      if (!message) {
        return badRequest(res, "message required for type=text");
      }

      const result = await wa.sendText(phone, message);

      if (!result?.ok) {
        return serviceUnavailable(res, result?.msg || "failed to send text");
      }

      return res.json({ ok: true, type: "text" });
    }

    if (type === "image") {
      if (!path) {
        return badRequest(res, "path required for type=image");
      }

      const result = await wa.sendImage(phone, path, caption);

      if (result && result.ok === false) {
        return serviceUnavailable(res, result?.msg || "failed to send image");
      }

      return res.json({ ok: true, type: "image" });
    }

    if (type === "file") {
      if (!path) {
        return badRequest(res, "path required for type=file");
      }

      const result = await wa.sendFile(phone, path, caption);

      if (result && result.ok === false) {
        return serviceUnavailable(res, result?.msg || "failed to send file");
      }

      return res.json({ ok: true, type: "file" });
    }

    return badRequest(res, "type must be text, image, or file");
  } catch (err) {
    console.error("POST /:session/send-message ERROR:", err.message);
    return res.status(500).json({
      ok: false,
      msg: "failed to send message",
    });
  }
});

// =====================================================
// OTP request
// =====================================================

router.post("/otp/request", async (req, res) => {
  try {
    const phone = String(req.body.phone || "").trim();

    if (!phone) {
      return badRequest(res, "phone required");
    }

    const otp = genOtp();
    const exp = Date.now() + Number(process.env.OTP_TTL || 300) * 1000;
    const token = signOtp(phone, otp, exp, process.env.OTP_SECRET);

    const wa = getSession("main", webhook);

    if (!wa.state.ready) {
      return serviceUnavailable(res, "WA not ready");
    }

    const result = await wa.sendText(phone, `OTP kamu: ${otp}`);

    if (!result?.ok) {
      return serviceUnavailable(res, result?.msg || "failed to send otp");
    }

    return res.json({ ok: true, token, exp });
  } catch (err) {
    console.error("POST /otp/request ERROR:", err.message);
    return res.status(500).json({
      ok: false,
      msg: "failed to request otp",
    });
  }
});

// =====================================================
// OTP verify
// =====================================================

router.post("/otp/verify", (req, res) => {
  try {
    const ok = verifyOtp(
      req.body.phone,
      req.body.otp,
      req.body.token,
      process.env.OTP_SECRET,
    );

    return res.json({ ok });
  } catch (err) {
    console.error("POST /otp/verify ERROR:", err.message);
    return res.status(500).json({
      ok: false,
      msg: "failed to verify otp",
    });
  }
});

export default router;