import { json, verifyInitData, createWithdrawal } from "../../src/lib/tg.js";

// Oyuncunun çekim talebi (USDT TRC20). Altın oyuncunun cihazında tutulduğu için talep elle kontrol edilir.
export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (!env.BOT_TOKEN || !env.DB) return json({ error: "not_configured" }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  const user = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  if (!user) return json({ error: "unauthorized" }, 401);
  const stats = body.stats && typeof body.stats === "object" ? body.stats : {};
  const r = await createWithdrawal(env, user.id, String(body.address || "").trim(), Number(body.gold), stats);
  return json(r, r.ok ? 200 : 400);
}
