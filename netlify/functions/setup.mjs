import { json, tgApi } from "../lib/tg.mjs";

// Bir kere tarayıcıdan açılır:  /api/setup?key=SECRET
export default async (req) => {
  const secret = Netlify.env.get("SECRET");
  const token = Netlify.env.get("BOT_TOKEN");
  if (!secret || !token) return new Response("BOT_TOKEN ve SECRET Netlify ortam değişkenlerinde tanımlı değil.", { status: 500 });
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== secret) return new Response("Yetkisiz.", { status: 403 });
  const r = await tgApi("setWebhook", {
    url: `${url.origin}/api/telegram`,
    secret_token: secret,
    allowed_updates: ["pre_checkout_query", "message"],
    drop_pending_updates: false,
  });
  const info = await tgApi("getWebhookInfo", {});
  return json({ setWebhook: r, webhook: info && info.result ? { url: info.result.url, pending: info.result.pending_update_count, last_error: info.result.last_error_message || null } : info });
};

export const config = { path: "/api/setup" };
