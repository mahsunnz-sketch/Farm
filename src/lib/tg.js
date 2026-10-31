// Cloudflare Pages Functions için ortak yardımcılar (D1 veritabanı + Telegram)

export const MAX_EXTRA = 3; // 1 ücretsiz + 3 ödemeli = 4 çiftçi
export const UNLOCK_ITEMS = { s: "Koyun", p: "Kovan", w: "İnek", z: "Domuz", e: "Keçi", o: "Kaz", t: "Hindi", Z: "Domuz", E: "Keçi", O: "Kaz", T: "Hindi" }; // Yıldızla açılan hayvanlar
export const UNLOCK_PRICE = { s: 100, p: 100, w: 100, z: 150, e: 150, o: 150, t: 150 }; // Yıldız fiyatları

export function price(env) {
  const p = parseInt(env.STAR_PRICE || "100", 10);
  return Number.isFinite(p) && p > 0 ? p : 100;
}

export const EARLY = { Z: "z", E: "e", O: "o", T: "t" }; // erken açılış (gün şartını atlar)
export function unlockPrice(item) { return UNLOCK_PRICE[item] || 100; }
// Erken açılış: 200 Yıldız; normal 150 Yıldızı daha önce ödediyse sadece 50 fark.
export async function unlockAmount(env, uid, item) {
  if (EARLY[item]) {
    const have = await listUnlocks(env, uid);
    return have[EARLY[item]] ? 50 : 200;
  }
  return unlockPrice(item);
}

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmac(keyBytes, msg) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
}

// Telegram Mini App initData doğrulaması (resmi yöntem)
export async function verifyInitData(initData, botToken, maxAgeSec = 86400) {
  if (typeof initData !== "string" || !initData || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const calc = hex(await hmac(secret, dcs));
  if (!safeEqual(calc, hash)) return null;
  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    if (!user || !Number.isInteger(user.id)) return null;
    return user;
  } catch { return null; }
}

export async function tgApi(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

// --- Veritabanı (D1) ---
let ready = false;
export async function init(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS farmers (charge TEXT PRIMARY KEY, uid TEXT NOT NULL, at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS farmers_uid ON farmers(uid)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS unlocks (uid TEXT NOT NULL, item TEXT NOT NULL, charge TEXT, at INTEGER NOT NULL, PRIMARY KEY (uid, item))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, first INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS referrals (invitee TEXT PRIMARY KEY, inviter TEXT NOT NULL, at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS referrals_inviter ON referrals(inviter)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS gold (uid TEXT PRIMARY KEY, bal INTEGER NOT NULL DEFAULT 0, credit REAL NOT NULL DEFAULT 0, at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS withdrawals (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, address TEXT NOT NULL, gold INTEGER NOT NULL, usd REAL NOT NULL, status TEXT NOT NULL, stats TEXT, at INTEGER NOT NULL, decided INTEGER, txid TEXT, credited INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS wd_uid ON withdrawals(uid)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS payments (charge TEXT PRIMARY KEY, uid TEXT NOT NULL, kind TEXT NOT NULL, item TEXT, amount INTEGER NOT NULL, at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS wallet (uid TEXT PRIMARY KEY, stars INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS wallet_log (charge TEXT PRIMARY KEY, uid TEXT NOT NULL, delta INTEGER NOT NULL, at INTEGER NOT NULL)"),
  ]);
  try { await env.DB.prepare("ALTER TABLE users ADD COLUMN seen INTEGER").run(); } catch {}
  ready = true;
}

export async function listPaid(env, uid) {
  await init(env);
  const r = await env.DB.prepare("SELECT charge FROM farmers WHERE uid = ? ORDER BY at, charge").bind(String(uid)).all();
  return (r.results || []).map((x) => x.charge);
}

export async function recordPaid(env, uid, chargeId) {
  await init(env);
  await env.DB.prepare("INSERT OR IGNORE INTO farmers (charge, uid, at) VALUES (?, ?, ?)")
    .bind(String(chargeId), String(uid), Date.now()).run();
}

export async function listUnlocks(env, uid) {
  await init(env);
  const r = await env.DB.prepare("SELECT item FROM unlocks WHERE uid = ?").bind(String(uid)).all();
  const out = {};
  for (const x of r.results || []) out[x.item] = true;
  return out;
}

export async function recordUnlock(env, uid, item, chargeId) {
  await init(env);
  await env.DB.prepare("INSERT OR IGNORE INTO unlocks (uid, item, charge, at) VALUES (?, ?, ?, ?)")
    .bind(String(uid), item, String(chargeId), Date.now()).run();
}

// Oyuncunun ilk görüldüğü an (gün sayacı için, sunucu saatiyle)
export async function firstSeen(env, uid) {
  await init(env);
  await env.DB.prepare("INSERT OR IGNORE INTO users (uid, first) VALUES (?, ?)").bind(String(uid), Date.now()).run();
  await env.DB.prepare("UPDATE users SET seen = ? WHERE uid = ?").bind(Date.now(), String(uid)).run();
  const row = await env.DB.prepare("SELECT first FROM users WHERE uid = ?").bind(String(uid)).first();
  return row ? row.first : Date.now();
}

// --- Yıldız cüzdanı: oyuncu Yıldız yükler, oyundaki Yıldızlı alımlar buradan düşer ---
export const DEPOSITS = [100, 200, 300, 400, 500, 1000];
export async function getStars(env, uid) {
  await init(env);
  const row = await env.DB.prepare("SELECT stars FROM wallet WHERE uid = ?").bind(String(uid)).first();
  return row ? row.stars : 0;
}
// Aynı ödeme iki kez yazılmasın diye charge benzersiz tutulur.
export async function addStars(env, uid, amount, charge) {
  await init(env);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO wallet_log (charge, uid, delta, at) VALUES (?, ?, ?, ?)")
    .bind(String(charge), String(uid), amount, Date.now()).run();
  if (!r.meta || !r.meta.changes) return false;
  await env.DB.prepare("INSERT INTO wallet (uid, stars) VALUES (?, ?) ON CONFLICT(uid) DO UPDATE SET stars = stars + excluded.stars")
    .bind(String(uid), amount).run();
  return true;
}
// Yetiyorsa düşer (tek adımda, çift harcama olmaz).
export async function spendStars(env, uid, amount, charge) {
  await init(env);
  const r = await env.DB.prepare("UPDATE wallet SET stars = stars - ?1 WHERE uid = ?2 AND stars >= ?1").bind(amount, String(uid)).run();
  if (!r.meta || !r.meta.changes) return false;
  await env.DB.prepare("INSERT OR IGNORE INTO wallet_log (charge, uid, delta, at) VALUES (?, ?, ?, ?)")
    .bind(String(charge), String(uid), -amount, Date.now()).run();
  return true;
}
export async function refundStars(env, uid, amount) {
  await init(env);
  await env.DB.prepare("UPDATE wallet SET stars = stars + ? WHERE uid = ?").bind(amount, String(uid)).run();
}

// --- Arkadaş daveti: davet edilen yeni oyuncu bir kez sayılır ---
export async function userExists(env, uid) {
  await init(env);
  const row = await env.DB.prepare("SELECT 1 AS x FROM users WHERE uid = ?").bind(String(uid)).first();
  return !!row;
}
// Davet edilen daha önce hiç oynamadıysa, kendisi değilse ve daha önce davet edilmediyse kaydeder.
export async function recordReferral(env, inviter, invitee) {
  inviter = String(inviter); invitee = String(invitee);
  if (!/^\d+$/.test(inviter) || inviter === invitee) return false;
  if (await userExists(env, invitee)) return false;
  const r = await env.DB.prepare("INSERT OR IGNORE INTO referrals (invitee, inviter, at) VALUES (?, ?, ?)")
    .bind(invitee, inviter, Date.now()).run();
  const done = !!(r.meta && r.meta.changes);
  if (done && st === "rejected") {
    const w = await env.DB.prepare("SELECT uid, gold FROM withdrawals WHERE id = ?").bind(id).first();
    if (w) await env.DB.prepare("UPDATE gold SET bal = bal + ? WHERE uid = ?").bind(w.gold, w.uid).run();
  }
  return done;
}
export async function countReferrals(env, uid) {
  await init(env);
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM referrals WHERE inviter = ?").bind(String(uid)).first();
  return row ? row.n : 0;
}
let botName = null, botMain = false, menuSet = false;
export async function botInfo(env, origin) {
  if (!botName) {
    try {
      const r = await tgApi(env, "getMe", {});
      if (r && r.ok && r.result.username) { botName = r.result.username; botMain = !!r.result.has_main_web_app; }
    } catch {}
  }
  // Sohbetin sol altındaki menü düğmesi doğrudan oyunu açsın (bir kez ayarlanır).
  if (!menuSet && origin) {
    menuSet = true;
    try { await tgApi(env, "setChatMenuButton", { menu_button: { type: "web_app", text: "🌾 Oyna", web_app: { url: origin } } }); } catch {}
  }
  return { name: botName, main: botMain };
}
export async function botUsername(env) { return (await botInfo(env)).name; }

// --- Yönetim paneli ---
export async function recordPayment(env, charge, uid, kind, item, amount) {
  await init(env);
  await env.DB.prepare("INSERT OR IGNORE INTO payments (charge, uid, kind, item, amount, at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(String(charge), String(uid), kind, item || null, amount, Date.now()).run();
}
export async function adminStats(env) {
  await init(env);
  const now = Date.now(), DAY = 86400000, q = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results || [];
  const one = async (sql, ...a) => (await q(sql, ...a))[0] || {};
  const day14 = now - 14 * DAY;
  const [users, new24, new7, act24, act7, elig, signups, pay, payKind, payDay, recent, w, wdep, wspent, refs, topRef, farmers, unl] = await Promise.all([
    one("SELECT COUNT(*) n FROM users"),
    one("SELECT COUNT(*) n FROM users WHERE first > ?", now - DAY),
    one("SELECT COUNT(*) n FROM users WHERE first > ?", now - 7 * DAY),
    one("SELECT COUNT(*) n FROM users WHERE seen > ?", now - DAY),
    one("SELECT COUNT(*) n FROM users WHERE seen > ?", now - 7 * DAY),
    one("SELECT COUNT(*) n FROM users WHERE first < ?", now - 30 * DAY),
    q("SELECT strftime('%Y-%m-%d', first/1000, 'unixepoch') d, COUNT(*) n FROM users WHERE first > ? GROUP BY d ORDER BY d", day14),
    one("SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM payments"),
    q("SELECT kind, COUNT(*) n, SUM(amount) s FROM payments GROUP BY kind"),
    q("SELECT strftime('%Y-%m-%d', at/1000, 'unixepoch') d, SUM(amount) s FROM payments WHERE at > ? GROUP BY d ORDER BY d", day14),
    q("SELECT uid, kind, item, amount, at FROM payments ORDER BY at DESC LIMIT 15"),
    one("SELECT COALESCE(SUM(stars),0) s, COUNT(CASE WHEN stars>0 THEN 1 END) n FROM wallet"),
    one("SELECT COALESCE(SUM(delta),0) s, COUNT(*) n FROM wallet_log WHERE delta > 0"),
    one("SELECT COALESCE(-SUM(delta),0) s, COUNT(*) n FROM wallet_log WHERE delta < 0"),
    one("SELECT COUNT(*) n FROM referrals"),
    q("SELECT inviter uid, COUNT(*) n FROM referrals GROUP BY inviter ORDER BY n DESC LIMIT 5"),
    one("SELECT COUNT(*) n FROM farmers"),
    q("SELECT item, COUNT(*) n FROM unlocks WHERE item = lower(item) GROUP BY item"),
  ]);
  return {
    now,
    users: { total: users.n, new24: new24.n, new7: new7.n, active24: act24.n, active7: act7.n, eligible30: elig.n, signups },
    payments: { count: pay.n, stars: pay.s, byKind: payKind, byDay: payDay, recent },
    wallet: { balance: w.s, holders: w.n, deposited: wdep.s, deposits: wdep.n, spent: wspent.s, spends: wspent.n },
    referrals: { total: refs.n, top: topRef },
    shop: { paidFarmers: farmers.n, unlocks: unl },
    withdrawals: { enabled: false, requested: 0 },
  };
}
// --- Kripto çekim talepleri (USDT TRC20, elle ödenir) ---
export const WD_GOLD_PER_USD = 20000;  // 20.000 altın = 1 USDT (1.000.000 altın = 50 USDT)
export const STAR_USD = 0.013;         // 1 Star geliştiriciye ~0,013 $ bırakır
export const POOL_PCT = 0.30;          // toplam ödeme, net gelirin en çok %30'u
export const WD_MIN_GOLD = 1000000;    // en az 1 milyon altın
export const WD_DAYS = 30;
const UNLOCK_DAY = { c: 1, d: 2, s: 3, p: 3, w: 3, z: 45, e: 60, o: 75, t: 90 };
// Bütün hayvanların kilidi açık mı? (gün dolduysa ya da Stars ile erken açıldıysa)
export async function allAnimalsUnlocked(env, uid, first) {
  const day = Math.floor((Date.now() - first) / 86400000) + 1;
  const unl = await listUnlocks(env, uid);
  const missing = Object.keys(UNLOCK_DAY).filter((k) => day < UNLOCK_DAY[k] && !unl[k.toUpperCase()]);
  return missing;
}             // oynamaya başladıktan 30 gün sonra
export const WD_MAX_PER_DAY = 40000;  // bir oyuncunun gün başına kazanabileceği en çok altın (sunucu sınırı)
export const TRC20 = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
export async function createWithdrawal(env, uid, address, gold, stats) {
  await init(env);
  const first = await firstSeen(env, uid);
  if (Date.now() - first < WD_DAYS * 86400000) return { error: "locked", opensAt: first + WD_DAYS * 86400000 };
  const missing = await allAnimalsUnlocked(env, uid, first);
  if (missing.length) return { error: "animals_locked", missing };
  if (!TRC20.test(address || "")) return { error: "bad_address" };
  if (!Number.isInteger(gold) || gold < WD_MIN_GOLD || gold % WD_GOLD_PER_USD !== 0) return { error: "bad_amount" };
  const open = await env.DB.prepare("SELECT 1 AS x FROM withdrawals WHERE uid = ? AND status = 'pending'").bind(String(uid)).first();
  if (open) return { error: "pending_exists" };
  // Hile freni: altın telefonda tutulduğu için, geçen güne göre kazanılabilecek en çok altını sunucu sınırlar.
  const cap = Math.floor((Date.now() - first) / 86400000) * WD_MAX_PER_DAY;
  const used = await env.DB.prepare("SELECT COALESCE(SUM(gold),0) AS g FROM withdrawals WHERE uid = ? AND status IN ('pending','paid')").bind(String(uid)).first();
  if ((used ? used.g : 0) + gold > cap) return { error: "over_cap", max: Math.max(0, cap - (used ? used.g : 0)) };
  const usd = gold / WD_GOLD_PER_USD;
  const pool = await poolStatus(env);
  if (usd > pool.available) return { error: "pool_empty", available: Math.floor(pool.available) };
  const dd = await env.DB.prepare("UPDATE gold SET bal = bal - ? WHERE uid = ? AND bal >= ?").bind(gold, String(uid), gold).run();
  if (!(dd.meta && dd.meta.changes)) return { error: "no_gold", bal: await goldBal(env, uid) };
  const r = await env.DB.prepare("INSERT INTO withdrawals (uid, address, gold, usd, status, stats, at) VALUES (?, ?, ?, ?, 'pending', ?, ?)")
    .bind(String(uid), address, gold, usd, JSON.stringify(stats || {}).slice(0, 1000), Date.now()).run();
  return { ok: true, usd, id: r.meta && r.meta.last_row_id, bal: await goldBal(env, uid) };
}
export async function listWithdrawals(env, uid) {
  await init(env);
  const r = await env.DB.prepare("SELECT id, gold, usd, status, txid, credited, at FROM withdrawals WHERE uid = ? ORDER BY id DESC LIMIT 10").bind(String(uid)).all();
  return r.results || [];
}
export async function ackWithdrawals(env, uid, ids) {
  await init(env);
  for (const id of (ids || []).slice(0, 10)) {
    if (Number.isInteger(id)) await env.DB.prepare("UPDATE withdrawals SET credited = 1 WHERE id = ? AND uid = ? AND status = 'rejected'").bind(id, String(uid)).run();
  }
}
export async function adminWithdrawals(env) {
  await init(env);
  const r = await env.DB.prepare("SELECT w.id, w.uid, w.address, w.gold, w.usd, w.status, w.stats, w.at, w.decided, w.txid, u.first, g.bal AS srv FROM withdrawals w LEFT JOIN users u ON u.uid = w.uid LEFT JOIN gold g ON g.uid = w.uid ORDER BY (w.status = 'pending') DESC, w.id DESC LIMIT 40").all();
  return r.results || [];
}
export async function decideWithdrawal(env, id, action, txid) {
  await init(env);
  const st = action === "paid" ? "paid" : action === "rejected" ? "rejected" : null;
  if (!st || !Number.isInteger(id)) return false;
  if (st === "paid") {
    // Onay şartı: talep en az 1.000.000 altın ve bütün hayvanların kilidi açık olmalı
    const w0 = await env.DB.prepare("SELECT uid, gold, status FROM withdrawals WHERE id = ?").bind(id).first();
    if (!w0 || w0.status !== "pending" || w0.gold < WD_MIN_GOLD) return "conditions";
    const f0 = await firstSeen(env, w0.uid);
    if ((await allAnimalsUnlocked(env, w0.uid, f0)).length) return "conditions";
  }
  const r = await env.DB.prepare("UPDATE withdrawals SET status = ?, decided = ?, txid = ? WHERE id = ? AND status = 'pending'")
    .bind(st, Date.now(), String(txid || "").slice(0, 120) || null, id).run();
  return !!(r.meta && r.meta.changes);
}

// --- Sunucu altın kasası: asıl bakiye burada, telefondaki rakam sadece kopya ---
export const GOLD_PER_HOUR = 1667;   // saatte kazanılabilecek en çok altın (günde ~40.000)
export const GOLD_MAX_CREDIT = 40000; // birikebilen en çok "kazanma hakkı"
export const GOLD_BURST = 500;
export async function goldSync(env, uid, coins, base) {
  await init(env);
  uid = String(uid);
  const now = Date.now();
  coins = Math.max(0, Math.floor(Number(coins) || 0));
  const row = await env.DB.prepare("SELECT bal, credit, at FROM gold WHERE uid = ?").bind(uid).first();
  if (!row) {
    const first = await firstSeen(env, uid);
    const cap = Math.floor((now - first) / 86400000) * WD_MAX_PER_DAY + GOLD_BURST;
    const bal = Math.min(coins, cap);
    await env.DB.prepare("INSERT OR IGNORE INTO gold (uid, bal, credit, at) VALUES (?, ?, ?, ?)").bind(uid, bal, GOLD_BURST, now).run();
    const r = await env.DB.prepare("SELECT bal FROM gold WHERE uid = ?").bind(uid).first();
    return r ? r.bal : bal;
  }
  let credit = Math.min(GOLD_MAX_CREDIT, row.credit + GOLD_PER_HOUR * Math.max(0, now - row.at) / 3600000);
  let bal = row.bal;
  if (base !== null && base !== undefined && Number.isFinite(Number(base))) {
    const delta = coins - Math.floor(Number(base));
    if (delta > 0) { const acc = Math.min(delta, Math.floor(credit)); credit -= acc; bal += acc; }
    else bal = Math.max(0, bal + delta);
  }
  await env.DB.prepare("UPDATE gold SET bal = ?, credit = ?, at = ? WHERE uid = ?").bind(bal, credit, now, uid).run();
  return bal;
}
export async function goldBal(env, uid) {
  const r = await env.DB.prepare("SELECT bal FROM gold WHERE uid = ?").bind(String(uid)).first();
  return r ? r.bal : 0;
}

// --- Ödeme havuzu: ödemeler gelirin belli bir yüzdesiyle sınırlı ---
export async function poolStatus(env) {
  await init(env);
  const p = await env.DB.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments").first();
  const w = await env.DB.prepare("SELECT COALESCE(SUM(stars),0) s FROM wallet").first();
  const c = await env.DB.prepare("SELECT COALESCE(SUM(usd),0) u FROM withdrawals WHERE status IN ('pending','paid')").first();
  const stars = Math.max(0, (p ? p.s : 0) - (w ? w.s : 0));   // harcanmış (kazanılmış) Stars
  const net = stars * STAR_USD, pool = net * POOL_PCT, committed = c ? c.u : 0;
  return { stars, net, pool, committed, available: Math.max(0, pool - committed) };
}
