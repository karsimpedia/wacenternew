import crypto from "crypto";

export function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function signOtp(phone, otp, exp, secret) {
  const payload = `${phone}|${otp}|${exp}`;
  const hash = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return `${exp}.${hash}`;
}

export function verifyOtp(phone, otp, token, secret) {
  const [exp, hash] = token.split(".");
  if (Date.now() > Number(exp)) return false;

  const payload = `${phone}|${otp}|${exp}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return expected === hash;
}
