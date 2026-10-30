// Cloudflare Worker: /api/* isteklerini ilgili işleyiciye yönlendirir,
// geri kalan her şey (oyun sayfası) public/ klasöründen statik olarak sunulur.
import * as invoice from "../functions/api/invoice.js";
import * as status from "../functions/api/status.js";
import * as telegram from "../functions/api/telegram.js";
import * as setup from "../functions/api/setup.js";
import * as admin from "../functions/api/admin.js";
import * as withdraw from "../functions/api/withdraw.js";
import * as adminwd from "../functions/api/adminwd.js";

const routes = {
  "/api/invoice": invoice,
  "/api/status": status,
  "/api/telegram": telegram,
  "/api/setup": setup,
  "/api/admin": admin,
  "/api/withdraw": withdraw,
  "/api/adminwd": adminwd,
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const h = routes[pathname];
    if (h) return h.onRequest({ request, env, ctx });
    if (pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
    }
    return env.ASSETS.fetch(request);
  },
};
