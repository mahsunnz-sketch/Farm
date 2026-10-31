import { json, safeEqual, decideWithdrawal } from "../../src/lib/tg.js";

// Yönetici: çekim talebini ödendi / reddedildi olarak işaretler.
export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (!env.SECRET || !env.DB) return json({ error: "not_configured" }, 500);
  if (!safeEqual(request.headers.get("x-admin-key") || "", env.SECRET)) return json({ error: "forbidden" }, 403);
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  const ok = await decideWithdrawal(env, Number(b.id), b.action, b.txid);
  if (ok === "conditions") return json({ ok: false, error: "conditions" }, 409);
  return json({ ok }, ok ? 200 : 409);
}
