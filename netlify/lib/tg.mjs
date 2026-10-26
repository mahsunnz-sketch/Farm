import { createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

export const MAX_EXTRA = 3; // 1 ücretsiz + 3 ödemeli = 4 çiftçi
export const price = () => {
  const p = parseInt(Netlify.env.get("STAR_PRICE") || "100", 10);
  return Number.isFinite(p) && p > 0 ? p : 100;
};

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// Telegram Mini App initData doğrulaması (resmi yöntem)
export function verifyInitData(initData, botToken, maxAgeSec = 86400) {
  if (typeof initData !== "string" || !initData || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dcs = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = createHmac("sha256", secret).update(dcs).digest("hex");
  const a = Buffer.from(calc, "hex");
  let b;
  try { b = Buffer.from(hash, "hex"); } catch { return null; }
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    if (!user || !Number.isInteger(user.id)) return null;
    return user;
  } catch { return null; }
}

export async function tgApi(method, body) {
  const token = Netlify.env.get("BOT_TOKEN");
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

const store = () => getStore({ name: "star-payments", consistency: "strong" });

// Her ödeme ayrı anahtar: paid/<kullanıcı>/<ödeme-no>  (sayaç yok, çakışma yok)
export async function listPaid(uid) {
  const { blobs } = await store().list({ prefix: `paid/${uid}/` });
  return blobs.map((b) => b.key.split("/").pop());
}

export async function recordPaid(uid, chargeId, info) {
  const key = `paid/${uid}/${chargeId}`;
  await store().setJSON(key, info, { onlyIfNew: true });
}
