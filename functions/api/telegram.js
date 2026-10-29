import {
  json, tgApi, listPaid, listUnlocks, recordPaid, recordUnlock, price, unlockAmount, safeEqual,
  MAX_EXTRA, UNLOCK_ITEMS, EARLY, DEPOSITS, addStars, recordReferral, recordPayment,
} from "../../src/lib/tg.js";

const WELCOME_TR = "🚜 Merhaba, Çiftçi\n\nBu çiftlikte tarlalar ve hayvanlar 7/24 çalışarak sana gerçek para kazandırır 💸\n\nGörevleri tamamla, arkadaşlarını davet et ve çiftliğini daha hızlı geliştir. Büyük ailemizin bir parçası ol.";

// Faturadaki payload'ı çözer: farmer:<uid>  veya  unlock:<s|w|z|e|o|t>:<uid>
function parsePayload(s) {
  let m = /^dep:(\d+):(\d+)$/.exec(s || "");
  if (m && DEPOSITS.includes(parseInt(m[1], 10))) return { kind: "dep", amount: parseInt(m[1], 10), uid: m[2] };
  m = /^farmer:(\d+)$/.exec(s || "");
  if (m) return { kind: "farmer", uid: m[1] };
  m = /^unlock:([a-zA-Z]):(\d+)$/.exec(s || "");
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
  const expect = async (pl) => (pl && pl.kind === "dep" ? pl.amount : pl && pl.kind === "unlock" ? await unlockAmount(env, pl.uid, pl.item) : price(env));

  // 1) Ödeme öncesi onay (10 saniye içinde cevaplanmalı)
  if (u.pre_checkout_query) {
    const q = u.pre_checkout_query;
    const pl = parsePayload(q.invoice_payload);
    let ok = !!pl && String(q.from && q.from.id) === pl.uid && q.currency === "XTR" && q.total_amount === (await expect(pl));
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

  // 1b) Davet linki: /start ref_<id>  -> davet kaydı + oyunu açan düğme
  const txt = u.message && typeof u.message.text === "string" ? u.message.text : "";
  const sm = /^\/start(?:@\w+)?\s+ref_(\d+)\s*$/.exec(txt) || (/^\/start(?:@\w+)?\s*$/.test(txt) ? [] : null);
  if (sm && u.message.from) {
    if (sm[1]) { try { await recordReferral(env, sm[1], u.message.from.id); } catch {} }
    const lc = String(u.message.from.language_code || "tr").slice(0, 2);
    const T = { tr: ["Çiftlik Vadisi'ne hoş geldin! 🌾", "🌾 Oyna"], en: ["Welcome to Farm Valley! 🌾", "🌾 Play"], ru: ["Добро пожаловать в Ферму-долину! 🌾", "🌾 Играть"], id: ["Selamat datang di Lembah Peternakan! 🌾", "🌾 Main"], az: ["Çiftlik Vadisinə xoş gəldin! 🌾", "🌾 Oyna"], ar: ["مرحبًا بك في وادي المزرعة! 🌾", "🌾 العب"], es: ["¡Bienvenido a Valle Granja! 🌾", "🌾 Jugar"], de: ["Willkommen im Farmtal! 🌾", "🌾 Spielen"], fr: ["Bienvenue dans la Vallée de la ferme ! 🌾", "🌾 Jouer"], pt: ["Bem-vindo ao Vale da Fazenda! 🌾", "🌾 Jogar"] };
    const t = T[lc] || T.en;
    const origin = new URL(request.url).origin;
    const markup = { inline_keyboard: [[{ text: t[1], web_app: { url: origin } }]] };
    // Türkçe kullanıcılara özel karşılama yazısı; public/welcome.jpg varsa fotoğrafla birlikte gider.
    const text = lc === "tr" ? WELCOME_TR : t[0];
    let sent = false;
    try {
      const head = await env.ASSETS.fetch(new Request(`${origin}/welcome.jpg`, { method: "HEAD" }));
      if (head.ok) {
        const r = await tgApi(env, "sendPhoto", { chat_id: u.message.chat.id, photo: `${origin}/welcome.jpg`, caption: text, reply_markup: markup });
        sent = !!(r && r.ok);
      }
    } catch {}
    if (!sent) { try { await tgApi(env, "sendMessage", { chat_id: u.message.chat.id, text, reply_markup: markup }); } catch {} }
    return json({ ok: true });
  }

  // 2) Ödeme tamamlandı
  const sp = u.message && u.message.successful_payment;
  if (sp) {
    const pl = parsePayload(sp.invoice_payload);
    if (pl && sp.currency === "XTR" && sp.total_amount === (await expect(pl)) && String(u.message.from.id) === pl.uid) {
      try {
        await recordPayment(env, sp.telegram_payment_charge_id, pl.uid, pl.kind, pl.item || null, sp.total_amount);
        if (pl.kind === "dep") await addStars(env, pl.uid, pl.amount, sp.telegram_payment_charge_id);
        else if (pl.kind === "farmer") await recordPaid(env, pl.uid, sp.telegram_payment_charge_id);
        else {
          await recordUnlock(env, pl.uid, pl.item, sp.telegram_payment_charge_id);
          if (EARLY[pl.item]) await recordUnlock(env, pl.uid, EARLY[pl.item], sp.telegram_payment_charge_id);
        }
      } catch (e) {
        return json({ error: "store" }, 500); // Telegram tekrar dener
      }
      try {
        const text = pl.kind === "dep"
          ? `Teşekkürler! Bakiyene ${pl.amount} ⭐ eklendi 🎉`
          : pl.kind === "farmer"
          ? "Teşekkürler! Yeni çiftçin tarlada işe başlıyor 🌾"
          : `Teşekkürler! ${UNLOCK_ITEMS[pl.item]} artık satın alınabilir 🎉`;
        await tgApi(env, "sendMessage", { chat_id: u.message.chat.id, text });
      } catch {}
    }
  }
  return json({ ok: true });
}
