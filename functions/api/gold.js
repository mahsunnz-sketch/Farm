import { json, verifyInitData, goldSync } from "../../src/lib/tg.js";

// Altın bakiyesini sunucuyla eşitler. Kazanç, geçen süreye göre sınırlanır; harcama olduğu gibi düşer.
export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (!env.BOT_TOKEN || !env.DB) return json({ error: "not_configured" }, 500);
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  const user = await verifyInitData(b && b.initData, env.BOT_TOKEN);
  if (!user) return json({ error: "unauthorized" }, 401);
  const bal = await goldSync(env, user.id, b.coins, b.base);
  return json({ ok: true, bal });
}
