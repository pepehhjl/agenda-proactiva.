// Tells the app what is configured, so it can guide setup. Never returns secrets.
import webpush from "web-push";
import { env, authed, supa, vapidKeys, pushReady } from "./_lib.js";

export default async function handler(req, res) {
  const password = !!env("APP_PASSWORD");
  const ok = authed(req);
  const out = { password, authed: ok };
  if (password && !ok) return res.json(out);
  out.ai = !!env("GEMINI_API_KEY");
  const sb = supa();
  out.db = false;
  if (sb) {
    // Make a real request, so a wrong URL or key shows up here instead of failing silently.
    const { error } = await sb.from("items").select("id").limit(1);
    out.db = !error;
    if (error) out.dbProblem = error.message || "No se pudo conectar.";
  }
  const vk = vapidKeys();
  out.push = pushReady();
  out.vapidPublicKey = out.push ? vk.pub : null;
  if (!out.push && vk.problem !== "missing") out.pushProblem = true;
  // Fresh keys to copy into Vercel while push is not set up yet.
  if (!out.push) out.suggestedVapid = webpush.generateVAPIDKeys();
  res.json(out);
}
