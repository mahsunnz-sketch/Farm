import { json, verifyInitData, tgApi, listPaid, listUnlocks, price, MAX_EXTRA, UNLOCK_ITEMS } from "../lib/tg.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const botToken = Netlify.env.get("BOT_TOKEN");
  if (!botToken) return json({ error: "not_configured" }, 500);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const user = verifyInitData(body && body.initData, botToken);
  if (!user) return json({ error: "unauthorized" }, 401);

  const item = body.item || "farmer";
  let title, description, payload;
  if (item === "farmer") {
    const paid = await listPaid(user.id);
    if (paid.length >= MAX_EXTRA) return json({ error: "full", count: paid.length }, 409);
    title = "Yeni çiftçi";
    description = "Çiftlik Vadisi: tarlada çalışacak yeni bir çiftçi";
    payload = `farmer:${user.id}`;
  } else if (UNLOCK_ITEMS[item]) {
    const have = await listUnlocks(user.id);
    if (have[item]) return json({ error: "owned" }, 409);
    title = `${UNLOCK_ITEMS[item]} kilidi`;
    description = `Çiftlik Vadisi: ${UNLOCK_ITEMS[item]} satın alma hakkı`;
    payload = `unlock:${item}:${user.id}`;
  } else {
    return json({ error: "bad_item" }, 400);
  }

  const r = await tgApi("createInvoiceLink", {
    title,
    description,
    payload,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: title, amount: price() }],
  });
  if (!r || !r.ok) return json({ error: "telegram", detail: r && r.description }, 502);
  return json({ link: r.result });
};

export const config = { path: "/api/invoice" };
