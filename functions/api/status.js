import { json, verifyInitData, listPaid, listUnlocks, firstSeen } from "../../src/lib/tg.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (!env.BOT_TOKEN || !env.DB) return json({ error: "not_configured" }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  const user = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  if (!user) return json({ error: "unauthorized" }, 401);
  const [charges, unlocks, first] = await Promise.all([
    listPaid(env, user.id), listUnlocks(env, user.id), firstSeen(env, user.id),
  ]);
  return json({ count: charges.length, charges, unlocks, firstSeen: first, now: Date.now() });
}
