// Shared helpers for the API routes. Files starting with "_" are not routes on Vercel.
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import crypto from "node:crypto";

export const env = (k) => (process.env[k] || "").trim();

// Every route except /api/status needs the app password (set APP_PASSWORD in Vercel).
export function authed(req) {
  const pass = env("APP_PASSWORD");
  if (!pass) return false;
  const given = req.headers["x-app-password"] || (req.query && req.query.key) || "";
  return given === pass;
}

export function deny(res) {
  const reason = env("APP_PASSWORD") ? "Contraseña incorrecta." : "Falta configurar APP_PASSWORD en Vercel.";
  return res.status(401).json({ error: "unauthorized", message: reason });
}

let client;
export function supa() {
  const url = env("SUPABASE_URL"), key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  client ||= createClient(url, key, { auth: { persistSession: false } });
  return client;
}

// Cleans a pasted key: drops a "NAME=" prefix, quotes, spaces and line breaks.
const cleanKey = (k) => env(k).replace(/^[A-Z_]+=/, "").replace(/[^A-Za-z0-9_-]/g, "");

// The two VAPID keys. The public key is rebuilt from the private one, so a mistyped or swapped
// public key does not matter. problem says what is wrong, if anything.
export function vapidKeys() {
  const a = cleanKey("VAPID_PUBLIC_KEY"), b = cleanKey("VAPID_PRIVATE_KEY");
  if (!a && !b) return { problem: "missing" };
  const priv = [b, a].find((k) => k.length === 43);
  if (!priv) return { problem: "invalid" };
  try {
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(priv, "base64url"));
    return { pub: ecdh.getPublicKey().toString("base64url"), priv };
  } catch { return { problem: "invalid" }; }
}

export function pushReady() {
  const { pub, priv } = vapidKeys();
  if (!pub) return false;
  try {
    webpush.setVapidDetails("mailto:" + (env("VAPID_EMAIL") || "agenda-proactiva@users.noreply.github.com"), pub, priv);
    return true;
  } catch { return false; }
}

// Sends one notification to every saved device; forgets devices that unsubscribed.
export async function sendToAll(sb, payload) {
  const { data: subs, error } = await sb.from("push_subs").select("endpoint, sub");
  if (error) throw error;
  let sent = 0;
  for (const row of subs || []) {
    try {
      await webpush.sendNotification(row.sub, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await sb.from("push_subs").delete().eq("endpoint", row.endpoint);
    }
  }
  return sent;
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}
