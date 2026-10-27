// Cloudflare Pages Functions için ortak yardımcılar (D1 veritabanı + Telegram)

export const MAX_EXTRA = 3; // 1 ücretsiz + 3 ödemeli = 4 çiftçi
export const UNLOCK_ITEMS = { s: "Koyun", w: "İnek", z: "Domuz", e: "Keçi", o: "Kaz", t: "Hindi" }; // Yıldızla açılan hayvanlar
export const UNLOCK_PRICE = { s: 100, w: 100, z: 150, e: 150, o: 150, t: 150 }; // Yıldız fiyatları

export function price(env) {
  const p = parseInt(env.STAR_PRICE || "100", 10);
  return Number.isFinite(p) && p > 0 ? p : 100;
}

export function unlockPrice(item) { return UNLOCK_PRICE[item] || 100; }

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
async function init(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS farmers (charge TEXT PRIMARY KEY, uid TEXT NOT NULL, at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS farmers_uid ON farmers(uid)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS unlocks (uid TEXT NOT NULL, item TEXT NOT NULL, charge TEXT, at INTEGER NOT NULL, PRIMARY KEY (uid, item))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, first INTEGER NOT NULL)"),
  ]);
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
  const row = await env.DB.prepare("SELECT first FROM users WHERE uid = ?").bind(String(uid)).first();
  return row ? row.first : Date.now();
}
