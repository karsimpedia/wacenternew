import axios from "axios";
import * as dummy from "./mainApi.dummy.js";

const useDummy = String(process.env.USE_DUMMY_MAIN_API) === "true";

const api = axios.create({
  baseURL: process.env.MAIN_API_URL,
  headers: { Authorization: `Bearer ${process.env.MAIN_API_KEY}` },
  timeout: 8000,
});

// ===============================
// REAL IMPLEMENTATION
// ===============================
async function real_getTrxStatus(trxId) {
  const r = await api.get("/api/trx/status", { params: { id: trxId } });
  return r.data?.data || null;
}

async function real_getSupplierCS(supplierCode) {
  const r = await api.get("/api/supplier/cs", {
    params: { code: supplierCode },
  });
  return r.data?.data || null;
}

async function real_getTodayTrxByTarget(msisdn) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const r = await api.get("/transactions/search", {
    params: {
      target: msisdn,
      from: start.toISOString(),
      to: end.toISOString(),
    },
  });

  return r.data?.items || [];
}

// ===============================
// EXPORT SWITCHED FUNCTIONS
// ===============================
export const getTrxStatus = useDummy
  ? dummy.getTrxStatus
  : real_getTrxStatus;

export const getSupplierCS = useDummy
  ? dummy.getSupplierCS
  : real_getSupplierCS;

export const getTodayTrxByTarget = useDummy
  ? dummy.getTodayTrxByTarget
  : real_getTodayTrxByTarget;
