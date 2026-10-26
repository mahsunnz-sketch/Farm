import { json, verifyInitData, tgApi, listPaid, price, MAX_EXTRA } from "../lib/tg.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const botToken = Netlify.env.get("BOT_TOKEN");
  if (!botToken) return json({ error: "not_configured" }, 500);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const user = verifyInitData(body && body.initData, botToken);
  if (!user) return json({ error: "unauthorized" }, 401);

  const paid = await listPaid(user.id);
  if (paid.length >= MAX_EXTRA) return json({ error: "full", count: paid.length }, 409);

  const r = await tgApi("createInvoiceLink", {
    title: "Yeni çiftçi",
    description: "Çiftlik Vadisi: tarlada çalışacak yeni bir çiftçi",
    payload: `farmer:${user.id}`,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: "Çiftçi", amount: price() }],
  });
  if (!r || !r.ok) return json({ error: "telegram", detail: r && r.description }, 502);
  return json({ link: r.result, count: paid.length });
};

export const config = { path: "/api/invoice" };
