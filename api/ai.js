// Asks Gemini and returns its answer parsed as JSON.
import { env, authed, deny, readBody } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!authed(req)) return deny(res);
  const key = env("GEMINI_API_KEY");
  if (!key) return res.status(503).json({ error: "no_ai", message: "Falta configurar GEMINI_API_KEY en Vercel." });

  const { input } = await readBody(req);
  const turns = typeof input === "string" ? [{ role: "user", content: input }] : Array.isArray(input) ? input : [];
  if (!turns.length) return res.status(400).json({ error: "bad_request" });
  const contents = turns.slice(-12).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: String(t.content).slice(0, 20000) }] }));

  const model = env("GEMINI_MODEL") || "gemini-flash-latest";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents, generationConfig: { responseMimeType: "application/json", temperature: 0.6 } }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const limited = r.status === 429;
    return res.status(limited ? 429 : 502).json({ error: limited ? "rate_limited" : "ai_error", message: data.error && data.error.message || "Error de la IA." });
  }
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  try {
    res.json({ data: JSON.parse(text) });
  } catch {
    const m = text.match(/[\[{][\s\S]*[\]}]/);
    try { res.json({ data: JSON.parse(m ? m[0] : "") }); }
    catch { res.status(502).json({ error: "invalid_json", message: "La IA respondió algo que no entendí.", text }); }
  }
}
