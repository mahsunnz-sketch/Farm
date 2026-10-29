import { json, verifyInitData, listPaid, listUnlocks, firstSeen, getStars, recordReferral, countReferrals, botInfo } from "../../src/lib/tg.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (!env.BOT_TOKEN || !env.DB) return json({ error: "not_configured" }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  const user = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  if (!user) return json({ error: "unauthorized" }, 401);
  // Davet linkinden (startapp=ref_<id>) gelen yeni oyuncu: ilk görülmeden önce kaydedilir.
  const m = /^ref_(\d+)$/.exec(String(body.ref || ""));
  if (m) { try { await recordReferral(env, m[1], user.id); } catch {} }
  const [charges, unlocks, first, stars, refs, bot] = await Promise.all([
    listPaid(env, user.id), listUnlocks(env, user.id), firstSeen(env, user.id), getStars(env, user.id), countReferrals(env, user.id), botInfo(env, new URL(request.url).origin),
  ]);
  return json({ count: charges.length, charges, unlocks, firstSeen: first, stars, refs, bot: bot && bot.name, mainApp: !!(bot && bot.main), uid: user.id, now: Date.now() });
}
