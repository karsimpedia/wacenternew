import axios from "axios";
import * as dummy from "./mainApi.dummy.js";

const useDummy = String(process.env.USE_DUMMY_MAIN_API) === "true";

const api = axios.create({
  baseURL: process.env.MAIN_API_URL,
  headers: {
    Authorization: `Bearer ${process.env.MAIN_API_KEY}`,
  },
  timeout: 8000,
});

/* ======================================================
   REAL IMPLEMENTATION (MATCH SERVER CONTROLLER)
====================================================== */

//respon api httpget api/trx/cekstatus

// {
//     "ok": true,
//     "transaction": {
//         "id": "f289f6f0-fd78-409a-8371-ba596624575b",
//         "invoiceId": "INV-20260129-MKZBEPG8-00IB",
//         "type": "TOPUP",
//         "status": "SUCCESS",
//         "message": "Transaksi Sukses",
//         "msisdn": "186091490",
//         "serial": "42142289620/50000",
//         "supplierRef": "INV-20260129-MKZBEPG8-00IB",
//         "supplierCs": {
//             "note": "Aktif jam kerja",
//             "email": "cs@supplier.com",
//             "telegram": "@bcajaya",
//             "whatsapp": "087778034999"
//         },
//         "createdAt": "2026-01-29T10:32:14.940Z",
//         "updatedAt": "2026-01-29T10:32:21.218Z"
//     }
// }

// 1️⃣ Ambil status transaksi
async function real_getTrxStatus({ trxId, invoiceId, msisdn }) {
  const r = await api.get("/api/trx/cekstatus", {
    params: {
      trxId,
      invoiceId,
      msisdn,
    },
  });

  return r.data?.transaction || null;
}

// 2️⃣ Ambil CS Supplier dari transaksi
async function real_getSupplierCS({ trxId, invoiceId, msisdn }) {
  const trx = await real_getTrxStatus({ trxId, invoiceId, msisdn });
  if (!trx) return null;
  
  return trx.supplierCs || null;
}

// 3️⃣ Shortcut: ambil transaksi TERBARU by msisdn (dipakai AI)
async function real_getLatestTrxByTarget(msisdn) {
  if (!msisdn) return null;
 
  return real_getTrxStatus({ msisdn });
}

/* ======================================================
   EXPORT SWITCH
====================================================== */

export const getTrxStatus = useDummy ? dummy.getTrxStatus : real_getTrxStatus;

export const getSupplierCS = useDummy
  ? dummy.getSupplierCS
  : real_getSupplierCS;

export const getLatestTrxByTarget = useDummy
  ? dummy.getLatestTrxByTarget
  : real_getLatestTrxByTarget;
