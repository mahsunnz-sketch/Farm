import { json, verifyInitData, listPaid } from "../lib/tg.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const botToken = Netlify.env.get("BOT_TOKEN");
  if (!botToken) return json({ error: "not_configured" }, 500);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const user = verifyInitData(body && body.initData, botToken);
  if (!user) return json({ error: "unauthorized" }, 401);
  const charges = await listPaid(user.id);
  return json({ count: charges.length, charges });
};

export const config = { path: "/api/status" };
