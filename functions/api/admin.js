import { json, safeEqual, adminStats, adminWithdrawals, poolStatus } from "../../src/lib/tg.js";

// Yönetim paneli verisi: x-admin-key başlığı SECRET ile aynı olmalı.
export async function onRequest({ request, env }) {
  if (!env.SECRET || !env.DB) return json({ error: "not_configured" }, 500);
  const key = request.headers.get("x-admin-key") || "";
  if (!safeEqual(key, env.SECRET)) return json({ error: "forbidden" }, 403);
  const st = await adminStats(env);
  st.pool = await poolStatus(env);
  st.wdList = await adminWithdrawals(env);
  st.withdrawals = { enabled: true, requested: st.wdList.filter((w) => w.status === "pending").length };
  return json(st);
}
