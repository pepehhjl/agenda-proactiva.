// Tells the app what is configured, so it can guide setup. Never returns secrets.
import webpush from "web-push";
import { env, authed, supa } from "./_lib.js";

export default async function handler(req, res) {
  const password = !!env("APP_PASSWORD");
  const ok = authed(req);
  const out = { password, authed: ok };
  if (password && !ok) return res.json(out);
  out.ai = !!env("GEMINI_API_KEY");
  out.db = !!supa();
  out.push = !!(env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY"));
  out.vapidPublicKey = env("VAPID_PUBLIC_KEY") || null;
  // Fresh keys to copy into Vercel while push is not set up yet.
  if (!out.push) out.suggestedVapid = webpush.generateVAPIDKeys();
  res.json(out);
}
