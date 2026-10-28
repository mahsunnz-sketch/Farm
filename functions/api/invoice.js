import { json, verifyInitData, tgApi, listPaid, listUnlocks, price, unlockAmount, EARLY, MAX_EXTRA, UNLOCK_ITEMS, DEPOSITS, getStars, spendStars, refundStars, recordPaid, recordUnlock } from "../../src/lib/tg.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  if (!env.BOT_TOKEN || !env.DB) return json({ error: "not_configured" }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  const user = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  if (!user) return json({ error: "unauthorized" }, 401);

  const item = body.item || "farmer";
  let title, description, payload, amount = price(env), wallet = false;
  const dep = /^D(\d+)$/.exec(item);
  if (dep) {
    amount = parseInt(dep[1], 10);
    if (!DEPOSITS.includes(amount)) return json({ error: "bad_item" }, 400);
    title = `${amount} Yıldız yükle`;
    description = `Çiftlik Vadisi: oyun bakiyene ${amount} Yıldız`;
    payload = `dep:${amount}:${user.id}`;
  } else if (item === "farmer") {
    wallet = true;
    const paid = await listPaid(env, user.id);
    if (paid.length >= MAX_EXTRA) return json({ error: "full", count: paid.length }, 409);
    title = "Yeni çiftçi";
    description = "Çiftlik Vadisi: tarlada çalışacak yeni bir çiftçi";
    payload = `farmer:${user.id}`;
  } else if (Object.prototype.hasOwnProperty.call(UNLOCK_ITEMS, item)) {
    wallet = true;
    const have = await listUnlocks(env, user.id);
    if (have[item]) return json({ error: "owned" }, 409);
    title = EARLY[item] ? `${UNLOCK_ITEMS[item]} erken açılış` : `${UNLOCK_ITEMS[item]} kilidi`;
    description = `Çiftlik Vadisi: ${UNLOCK_ITEMS[item]} satın alma hakkı`;
    payload = `unlock:${item}:${user.id}`;
    amount = await unlockAmount(env, user.id, item);
  } else {
    return json({ error: "bad_item" }, 400);
  }

  // Bakiye yetiyorsa Telegram ödemesine gerek yok: cüzdandan düş ve hemen ver.
  if (wallet && (await getStars(env, user.id)) >= amount) {
    const charge = `w:${user.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    if (await spendStars(env, user.id, amount, charge)) {
      try {
        if (item === "farmer") await recordPaid(env, user.id, charge);
        else {
          await recordUnlock(env, user.id, item, charge);
          if (EARLY[item]) await recordUnlock(env, user.id, EARLY[item], charge);
        }
      } catch (e) {
        await refundStars(env, user.id, amount);
        return json({ error: "store" }, 500);
      }
      return json({ paid: true, stars: await getStars(env, user.id) });
    }
  }

  const r = await tgApi(env, "createInvoiceLink", {
    title,
    description,
    payload,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: title, amount }],
  });
  if (!r || !r.ok) return json({ error: "telegram", detail: r && r.description }, 502);
  return json({ link: r.result });
}
