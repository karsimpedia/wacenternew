// src/services/mainApi.js
import axios from "axios";
import crypto from "crypto";
import * as dummy from "./mainApi.dummy.js";
import qs from "qs";
const useDummy = String(process.env.USE_DUMMY_MAIN_API) === "true";

function buildOriginalUrl(path, params) {
  const q = params
    ? qs.stringify(params, { addQueryPrefix: true, arrayFormat: "repeat" })
    : "";
  return `${path}${q}`;
}

function signCsAi({ method, originalUrl }) {
  const time = Math.floor(Date.now() / 1000);
  const base = `${method}:${originalUrl}:${time}`;
  const sign = crypto
    .createHmac("sha256", process.env.CS_AI_SECRET)
    .update(base)
    .digest("hex");

  return {
    "X-CS-AI-KEY": process.env.CS_AI_PUBLIC_KEY,
    "X-CS-AI-TIME": String(time),
    "X-CS-AI-SIGN": sign,
  };
}

// ======================================================
// AXIOS INSTANCE (NO BEARER)
// ======================================================
const api = axios.create({
  baseURL: process.env.MAIN_API_URL,
  timeout: 8000,
});

// ======================================================
// REAL IMPLEMENTATION
// ======================================================

// GET /api/trx/cekstatus
async function real_getTrxStatus({ trxId, invoiceId, msisdn }) {
  const path = "/api/trx/cekstatus";
  const params = { trxId, invoiceId, msisdn };

  const originalUrl = buildOriginalUrl(path, params);

  const r = await api.get(path, {
    params: { trxId, invoiceId, msisdn },
    headers: signCsAi({
      method: "GET",
      originalUrl,
    }),
  });

  return r.data?.transaction || null;
}

// Ambil CS Supplier dari transaksi
async function real_getSupplierCS({ trxId, invoiceId, msisdn }) {
  const trx = await real_getTrxStatus({ trxId, invoiceId, msisdn });
  return trx?.supplierCs || null;
}

// Shortcut: transaksi terbaru by msisdn
async function real_getLatestTrxByTarget(msisdn) {
  if (!msisdn) return null;
  return real_getTrxStatus({ msisdn });
}

// ======================================================
// EXPORT SWITCH
// ======================================================
export const getTrxStatus = useDummy ? dummy.getTrxStatus : real_getTrxStatus;

export const getSupplierCS = useDummy
  ? dummy.getSupplierCS
  : real_getSupplierCS;

export const getLatestTrxByTarget = useDummy
  ? dummy.getLatestTrxByTarget
  : real_getLatestTrxByTarget;

export const resendTrx = async (id) => {
  try {
    const path = `/api/trx/resend/${id}`;

    const r = await api.post(
      path,
      {},
      {
        headers: signCsAi({
          method: "POST",
          originalUrl: path,
        }),
      }
    );

    return r.data?.ok === true;
  } catch (e) {
    console.error("[resendTrx]", e?.response?.data || e.message);
    return false;
  }
};
