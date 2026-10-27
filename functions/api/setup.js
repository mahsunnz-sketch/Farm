import { json, tgApi, safeEqual } from "../../src/lib/tg.js";

// Bir kere tarayıcıdan açılır:  /api/setup?key=SECRET
export async function onRequest({ request, env }) {
  if (!env.SECRET || !env.BOT_TOKEN || !env.DB) {
    return new Response("BOT_TOKEN, SECRET ve DB (veritabanı bağlantısı) tanımlı değil.", { status: 500 });
  }
  const url = new URL(request.url);
  if (!safeEqual(url.searchParams.get("key") || "", env.SECRET)) return new Response("Yetkisiz.", { status: 403 });
  const r = await tgApi(env, "setWebhook", {
    url: `${url.origin}/api/telegram`,
    secret_token: env.SECRET,
    allowed_updates: ["pre_checkout_query", "message"],
    drop_pending_updates: false,
  });
  const info = await tgApi(env, "getWebhookInfo", {});
  return json({
    setWebhook: r,
    webhook: info && info.result
      ? { url: info.result.url, pending: info.result.pending_update_count, last_error: info.result.last_error_message || null }
      : info,
  });
}
