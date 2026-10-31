import { json, safeEqual, init } from "../../src/lib/tg.js";

// Yönetici test aracı (tarayıcıdan, SECRET ile):
//   /api/admintest?key=SECRET&uid=OYUNCU_ID            -> hesabı 100 günlük yapar, bütün hayvan kilitlerini açar, 1.000.000 altın verir
//   ...&pool=1                                          -> ayrıca test için sahte gelir ekler (ödeme havuzu dolsun)
//   ...&undo=1                                          -> test için eklenen unlock/altın/sahte geliri siler
export async function onRequest({ request, env }) {
  if (!env.SECRET || !env.DB) return new Response("Ayar eksik.", { status: 500 });
  const url = new URL(request.url);
  if (!safeEqual(request.headers.get("x-admin-key") || url.searchParams.get("key") || "", env.SECRET)) return new Response("Yetkisiz.", { status: 403 });
  const uid = String(url.searchParams.get("uid") || "").replace(/\D/g, "");
  if (!uid) return json({ error: "uid gerekli" }, 400);
  await init(env);
  const now = Date.now();
  if (url.searchParams.get("undo")) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM unlocks WHERE uid = ? AND charge LIKE 'test-%'").bind(uid),
      env.DB.prepare("DELETE FROM payments WHERE charge = ?").bind("test-pool-" + uid),
      env.DB.prepare("UPDATE gold SET bal = 0 WHERE uid = ?").bind(uid),
    ]);
    return json({ ok: true, undo: true, uid });
  }
  const stmts = [
    env.DB.prepare("INSERT OR IGNORE INTO users (uid, first) VALUES (?, ?)").bind(uid, now),
    env.DB.prepare("UPDATE users SET first = ? WHERE uid = ? AND first > ?").bind(now - 100 * 86400000, uid, now - 100 * 86400000),
    env.DB.prepare("INSERT INTO gold (uid, bal, credit, at) VALUES (?, 1000000, 0, ?) ON CONFLICT(uid) DO UPDATE SET bal = MAX(bal, 1000000)").bind(uid, now),
  ];
  for (const it of ["Z", "E", "O", "T"]) {
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO unlocks (uid, item, charge, at) VALUES (?, ?, ?, ?)").bind(uid, it, "test-" + it + "-" + uid, now));
  }
  if (url.searchParams.get("pool")) {
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO payments (charge, uid, kind, item, amount, at) VALUES (?, ?, 'test', NULL, 13000, ?)").bind("test-pool-" + uid, uid, now));
  }
  await env.DB.batch(stmts);
  return json({ ok: true, uid, note: "Hesap 100 günlük yapıldı, hayvan kilitleri açıldı, sunucuda 1.000.000 altın var." + (url.searchParams.get("pool") ? " Test geliri eklendi." : "") });
}
