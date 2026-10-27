import {
  json, tgApi, listPaid, listUnlocks, recordPaid, recordUnlock, price, safeEqual,
  MAX_EXTRA, UNLOCK_ITEMS,
} from "../../src/lib/tg.js";

// Faturadaki payload'ı çözer: farmer:<uid>  veya  unlock:<s|w>:<uid>
function parsePayload(s) {
  let m = /^farmer:(\d+)$/.exec(s || "");
  if (m) return { kind: "farmer", uid: m[1] };
  m = /^unlock:([a-z]):(\d+)$/.exec(s || "");
  if (m && Object.prototype.hasOwnProperty.call(UNLOCK_ITEMS, m[1])) return { kind: "unlock", item: m[1], uid: m[2] };
  return null;
}

// Telegram bu adrese ödeme olaylarını gönderir.
export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: true });
  const secret = env.SECRET;
  if (!secret || !env.DB || !safeEqual(request.headers.get("x-telegram-bot-api-secret-token") || "", secret)) {
    return json({ error: "forbidden" }, 403);
  }
  let u;
  try { u = await request.json(); } catch { return json({ ok: true }); }
  const amount = price(env);

  // 1) Ödeme öncesi onay (10 saniye içinde cevaplanmalı)
  if (u.pre_checkout_query) {
    const q = u.pre_checkout_query;
    const pl = parsePayload(q.invoice_payload);
    let ok = !!pl && String(q.from && q.from.id) === pl.uid && q.currency === "XTR" && q.total_amount === amount;
    let msg = "Ödeme doğrulanamadı.";
    if (ok && pl.kind === "farmer") {
      const paid = await listPaid(env, pl.uid);
      if (paid.length >= MAX_EXTRA) { ok = false; msg = "Tüm çiftçiler zaten alındı."; }
    }
    if (ok && pl.kind === "unlock") {
      const have = await listUnlocks(env, pl.uid);
      if (have[pl.item]) { ok = false; msg = "Bu zaten açık."; }
    }
    await tgApi(env, "answerPreCheckoutQuery", ok
      ? { pre_checkout_query_id: q.id, ok: true }
      : { pre_checkout_query_id: q.id, ok: false, error_message: msg });
    return json({ ok: true });
  }

  // 2) Ödeme tamamlandı
  const sp = u.message && u.message.successful_payment;
  if (sp) {
    const pl = parsePayload(sp.invoice_payload);
    if (pl && sp.currency === "XTR" && sp.total_amount === amount && String(u.message.from.id) === pl.uid) {
      try {
        if (pl.kind === "farmer") await recordPaid(env, pl.uid, sp.telegram_payment_charge_id);
        else await recordUnlock(env, pl.uid, pl.item, sp.telegram_payment_charge_id);
      } catch (e) {
        return json({ error: "store" }, 500); // Telegram tekrar dener
      }
      try {
        const text = pl.kind === "farmer"
          ? "Teşekkürler! Yeni çiftçin tarlada işe başlıyor 🌾"
          : `Teşekkürler! ${UNLOCK_ITEMS[pl.item]} artık satın alınabilir 🎉`;
        await tgApi(env, "sendMessage", { chat_id: u.message.chat.id, text });
      } catch {}
    }
  }
  return json({ ok: true });
}
