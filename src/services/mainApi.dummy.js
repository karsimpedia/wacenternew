// src/services/mainApi.dummy.js

// helper
function todayISO() {
  const d = new Date();
  return d.toISOString();
}

// ===============================
// DUMMY TRANSACTIONS
// ===============================
const DUMMY_TRX = [
  {
    id: "TRX001",
    product: "Pulsa Telkomsel 10K",
    target: "081234567890",
    status: "PENDING",
    supplierCode: "SUP-A",
    createdAt: todayISO(),
  },
  {
    id: "TRX002",
    product: "Paket Data XL 15GB",
    target: "081234567890",
    status: "SUCCESS",
    supplierCode: "SUP-B",
    createdAt: todayISO(),
  },
  {
    id: "TRX003",
    product: "Pulsa Indosat 5K",
    target: "089612345678",
    status: "FAILED",
    supplierCode: "SUP-A",
    createdAt: todayISO(),
  },
];

// ===============================
// DUMMY SUPPLIER CS
// ===============================
const DUMMY_SUPPLIER_CS = {
  "SUP-A": {
    name: "Supplier A",
    contact: "628111111111",
  },
  "SUP-B": {
    name: "Supplier B",
    contact: "628222222222",
  },
};

// ===============================
// EXPORT DUMMY FUNCTIONS
// ===============================
export async function getTrxStatus(trxId) {
  return DUMMY_TRX.find((t) => t.id === trxId) || null;
}

export async function getSupplierCS(supplierCode) {
  return DUMMY_SUPPLIER_CS[supplierCode] || null;
}

export async function getTodayTrxByTarget(msisdn) {
  return DUMMY_TRX.filter((t) => t.target === msisdn);
}
