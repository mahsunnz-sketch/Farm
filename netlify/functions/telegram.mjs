import { json, tgApi, listPaid, recordPaid, price, MAX_EXTRA } from "../lib/tg.mjs";

// Telegram bu adrese ödeme olaylarını gönderir.
export default async (req) => {
  if (req.method !== "POST") return json({ ok: true });
  const secret = Netlify.env.get("SECRET");
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return json({ error: "forbidden" }, 403);
  }
  let u;
  try { u = await req.json(); } catch { return json({ ok: true }); }

  // 1) Ödeme öncesi onay (10 saniye içinde cevaplanmalı)
  if (u.pre_checkout_query) {
    const q = u.pre_checkout_query;
    const m = /^farmer:(\d+)$/.exec(q.invoice_payload || "");
    let ok = !!m && String(q.from && q.from.id) === m[1] && q.currency === "XTR" && q.total_amount === price();
    let msg = "Ödeme doğrulanamadı.";
    if (ok) {
      const paid = await listPaid(m[1]);
      if (paid.length >= MAX_EXTRA) { ok = false; msg = "Tüm çiftçiler zaten alındı."; }
    }
    await tgApi("answerPreCheckoutQuery", ok
      ? { pre_checkout_query_id: q.id, ok: true }
      : { pre_checkout_query_id: q.id, ok: false, error_message: msg });
    return json({ ok: true });
  }

  // 2) Ödeme tamamlandı
  const sp = u.message && u.message.successful_payment;
  if (sp) {
    const m = /^farmer:(\d+)$/.exec(sp.invoice_payload || "");
    if (m && sp.currency === "XTR" && sp.total_amount === price() && String(u.message.from.id) === m[1]) {
      try {
        await recordPaid(m[1], sp.telegram_payment_charge_id, { at: Date.now(), amount: sp.total_amount });
      } catch (e) {
        return json({ error: "store" }, 500); // Telegram tekrar dener
      }
      try {
        await tgApi("sendMessage", { chat_id: u.message.chat.id, text: "Teşekkürler! Yeni çiftçin tarlada işe başlıyor 🌾" });
      } catch {}
    }
  }
  return json({ ok: true });
};

export const config = { path: "/api/telegram" };
