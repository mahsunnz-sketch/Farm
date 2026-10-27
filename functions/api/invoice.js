import { json, verifyInitData, tgApi, listPaid, listUnlocks, price, MAX_EXTRA, UNLOCK_ITEMS } from "../../src/lib/tg.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (!env.BOT_TOKEN || !env.DB) return json({ error: "not_configured" }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  const user = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  if (!user) return json({ error: "unauthorized" }, 401);

  const item = body.item || "farmer";
  let title, description, payload;
  if (item === "farmer") {
    const paid = await listPaid(env, user.id);
    if (paid.length >= MAX_EXTRA) return json({ error: "full", count: paid.length }, 409);
    title = "Yeni çiftçi";
    description = "Çiftlik Vadisi: tarlada çalışacak yeni bir çiftçi";
    payload = `farmer:${user.id}`;
  } else if (Object.prototype.hasOwnProperty.call(UNLOCK_ITEMS, item)) {
    const have = await listUnlocks(env, user.id);
    if (have[item]) return json({ error: "owned" }, 409);
    title = `${UNLOCK_ITEMS[item]} kilidi`;
    description = `Çiftlik Vadisi: ${UNLOCK_ITEMS[item]} satın alma hakkı`;
    payload = `unlock:${item}:${user.id}`;
  } else {
    return json({ error: "bad_item" }, 400);
  }

  const r = await tgApi(env, "createInvoiceLink", {
    title,
    description,
    payload,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: title, amount: price(env) }],
  });
  if (!r || !r.ok) return json({ error: "telegram", detail: r && r.description }, 502);
  return json({ link: r.result });
}
