// Asks Gemini. Body: {input} for a JSON answer, {input, search:true} to let it search Google first,
// {input, image:{mime, data}} to read a photo (a flyer, an appointment, a screenshot),
// or {audio:{mime, data}} (base64) to transcribe a voice note. Returns {data}.
import { env, authed, deny, readBody } from "./_lib.js";

// Google's free models get crowded ("high demand"), so each request tries several in turn:
// GEMINI_MODEL first (if set), then the list below. With GROQ_API_KEY set, Groq answers text when all of them are busy.
const MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-3.1-flash-lite"];
// A model that just said "busy" is skipped for a minute, so the next answers come faster.
const resting = new Map();
const BUSY = new Set([429, 500, 502, 503, 504]);

async function geminiOnce(model, key, body) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = await r.json().catch(() => ({}));
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    return { ok: r.ok, status: r.status, text, message: data.error && data.error.message };
  } catch {
    return { ok: false, status: 504, text: "", message: "timeout" };
  } finally { clearTimeout(timer); }
}

async function gemini(key, body) {
  const all = [...new Set([env("GEMINI_MODEL"), ...MODELS].filter(Boolean))];
  const fresh = all.filter((m) => !(resting.get(m) > Date.now()));
  let out;
  for (const m of fresh.length ? fresh : all) {
    out = await geminiOnce(m, key, body);
    if (out.ok || !(BUSY.has(out.status) || out.status === 404)) return out;
    resting.set(m, Date.now() + 60000);
  }
  return out;
}

// Groq (free tier, OpenAI-style API), text only.
async function groq(contents, json) {
  const key = env("GROQ_API_KEY");
  if (!key) return null;
  const messages = contents.map((c) => ({ role: c.role === "model" ? "assistant" : "user", content: c.parts.map((p) => p.text || "").join("") }));
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: env("GROQ_MODEL") || "llama-3.3-70b-versatile", messages, temperature: 0.6, ...(json ? { response_format: { type: "json_object" } } : {}) }),
  }).catch(() => null);
  if (!r) return null;
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, text: data.choices?.[0]?.message?.content || "", message: data.error && data.error.message };
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  return JSON.parse(m ? m[0] : "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!authed(req)) return deny(res);
  const key = env("GEMINI_API_KEY");
  if (!key) return res.status(503).json({ error: "no_ai", message: "Falta configurar GEMINI_API_KEY en Vercel." });
  const { input, search, audio, image } = await readBody(req);

  if (audio && audio.data) {
    const out = await gemini(key, { contents: [{ role: "user", parts: [
      { inline_data: { mime_type: String(audio.mime || "audio/webm").split(";")[0], data: audio.data } },
      { text: `Transcribe este audio tal como se dijo, en el idioma en que se habló (lo más probable: ${String(audio.lang || "español").slice(0, 60)}), sin traducir ni agregar nada. Si no se entiende nada, responde vacío.` },
    ] }] });
    if (!out.ok) return res.status(BUSY.has(out.status) ? 429 : 502).json({ error: BUSY.has(out.status) ? "rate_limited" : "ai_error", message: out.message || "No pude transcribir." });
    return res.json({ data: { texto: out.text.trim() } });
  }

  const turns = typeof input === "string" ? [{ role: "user", content: input }] : Array.isArray(input) ? input : [];
  if (!turns.length) return res.status(400).json({ error: "bad_request" });
  const contents = image && image.data && typeof input === "string"
    ? [{ role: "user", parts: [{ inline_data: { mime_type: String(image.mime || "image/jpeg").split(";")[0], data: image.data } }, { text: input.slice(0, 20000) }] }]
    : turns.slice(-12).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: String(t.content).slice(0, 20000) }] }));

  // Google Search grounding cannot be combined with a forced JSON reply, so it asks for JSON in the prompt instead.
  let out = search
    ? await gemini(key, { contents, tools: [{ google_search: {} }], generationConfig: { temperature: 0.7 } })
    : null;
  if (!out || !out.ok) out = await gemini(key, { contents, generationConfig: { responseMimeType: "application/json", temperature: 0.6 } });
  if (!out.ok && !image) { const g = await groq(contents, true); if (g && g.ok) out = g; }
  if (!out.ok) {
    const limited = BUSY.has(out.status);
    return res.status(limited ? 429 : 502).json({ error: limited ? "rate_limited" : "ai_error", message: out.message || "Error de la IA." });
  }
  try { res.json({ data: parseJson(out.text) }); }
  catch { res.status(502).json({ error: "invalid_json", message: "La IA respondió algo que no entendí.", text: out.text }); }
}
