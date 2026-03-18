// src/services/mainApi.js
import axios from "axios";
import crypto from "crypto";
import qs from "qs";
import * as dummy from "./mainApi.dummy.js";

const useDummy = String(process.env.USE_DUMMY_MAIN_API) === "true";

function compactParams(obj = {}) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
}

function buildOriginalUrl(path, params) {
  const cleanParams = compactParams(params);
  const q = qs.stringify(cleanParams, {
    addQueryPrefix: true,
    arrayFormat: "repeat",
  });
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

const api = axios.create({
  baseURL: process.env.MAIN_API_URL,
  timeout: 8000,
});

async function real_getTrxStatus({ trxId, invoiceId, msisdn }) {
  const path = "/api/trx/cekstatus";
  const params = compactParams({ trxId, invoiceId, msisdn });

  if (!params.trxId && !params.invoiceId && !params.msisdn) {
    return null;
  }

  const originalUrl = buildOriginalUrl(path, params);

  try {
    const r = await api.get(path, {
      params,
      headers: signCsAi({
        method: "GET",
        originalUrl,
      }),
    });

    return r.data?.transaction || null;
  } catch (e) {
    console.error("[getTrxStatus]", e?.response?.data || e.message);
    return null;
  }
}

async function real_getSupplierCS({ trxId, invoiceId, msisdn }) {
  const trx = await real_getTrxStatus({ trxId, invoiceId, msisdn });
  return trx?.supplierCs || null;
}

async function real_getLatestTrxByTarget(msisdn) {
  if (!msisdn) return null;
  return real_getTrxStatus({ msisdn });
}

export const getTrxStatus = useDummy ? dummy.getTrxStatus : real_getTrxStatus;

export const getSupplierCS = useDummy
  ? dummy.getSupplierCS
  : real_getSupplierCS;

export const getLatestTrxByTarget = useDummy
  ? dummy.getLatestTrxByTarget
  : real_getLatestTrxByTarget;

export const resendTrx = async (id) => {
  if (!id) return false;

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
      },
    );

    return r.data?.ok === true;
  } catch (e) {
    console.error("[resendTrx]", e?.response?.data || e.message);
    return false;
  }
};