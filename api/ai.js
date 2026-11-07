// Asks Gemini (or, in 0.16.0-prueba, the person's own AI account: see "Your own AI" below). Body: {input} for a JSON answer, {input, search:true} to let it search Google first,
// {input, image:{mime, data}} to read a photo (a flyer, an appointment, a screenshot),
// or {audio:{mime, data}} (base64) to transcribe a voice note. Returns {data}.
import { env, who, deny, readBody } from "./_lib.js";

// Google's free models get crowded ("high demand"), so each request tries several in turn:
// GEMINI_MODEL first (if set), then the list below. With GROQ_API_KEY set, Groq answers text when all of them are busy.
const MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-3.1-flash-lite"];
// A model that just said "busy" is skipped for a minute, so the next answers come faster.
const resting = new Map();
const BUSY = new Set([429, 500, 502, 503, 504]);
// Every request answers within this time, counting all the tries (search, every model, and Groq).
// A single try waits at most TRY_MS, so a stuck model leaves time for the next one.
const BUDGET_MS = 28000, TRY_MS = 12000, MIN_TRY_MS = 1500, GROQ_MS = 6000;
const TIMEOUT = { ok: false, status: 504, text: "", message: "timeout" };
const left = (until) => until - Date.now();

async function geminiOnce(model, key, body, until) {
  const ms = Math.min(TRY_MS, left(until));
  if (ms < MIN_TRY_MS) return { ...TIMEOUT, cut: true };
  // cut: the wait was shortened by the budget, so a timeout says nothing about the model being busy.
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms), cut = ms < TRY_MS;
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
    return { ...TIMEOUT, cut };
  } finally { clearTimeout(timer); }
}

// Tries the models in turn until one answers or the time until `until` runs out.
async function gemini(key, body, until) {
  const all = [...new Set([env("GEMINI_MODEL"), ...MODELS].filter(Boolean))];
  const fresh = all.filter((m) => !(resting.get(m) > Date.now()));
  let out;
  for (const m of fresh.length ? fresh : all) {
    if (left(until) < MIN_TRY_MS) return out || TIMEOUT;
    out = await geminiOnce(m, key, body, until);
    if (out.ok || !(BUSY.has(out.status) || out.status === 404)) return out;
    if (!out.cut) resting.set(m, Date.now() + 60000);
  }
  return out || TIMEOUT;
}

// fetch with a time limit that also covers reading the answer; null when it fails or runs out of time.
async function fetchJson(url, opts, ms) {
  if (ms < MIN_TRY_MS) return null;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    return { r, data: await r.json() };
  } catch { return null; } finally { clearTimeout(timer); }
}

// Groq (free tier, OpenAI-style API), text only.
async function groq(contents, json, until) {
  const key = env("GROQ_API_KEY");
  if (!key) return null;
  const messages = contents.map((c) => ({ role: c.role === "model" ? "assistant" : "user", content: c.parts.map((p) => p.text || "").join("") }));
  const got = await fetchJson("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: env("GROQ_MODEL") || "llama-3.3-70b-versatile", messages, temperature: 0.6, ...(json ? { response_format: { type: "json_object" } } : {}) }),
  }, Math.min(GROQ_MS + 4000, left(until)));
  if (!got) return null;
  const { r, data } = got;
  return { ok: r.ok, status: r.status, text: data.choices?.[0]?.message?.content || "", message: data.error && data.error.message };
}

// Speech to text with Groq's Whisper. Returns the text, or null when Groq isn't set up or fails.
async function whisper(b64, mime, until) {
  const key = env("GROQ_API_KEY");
  if (!key) return null;
  const ext = /mp4|m4a|aac/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : /wav/.test(mime) ? "wav" : /mpeg|mp3/.test(mime) ? "mp3" : "webm";
  const form = new FormData();
  form.append("file", new Blob([Buffer.from(b64, "base64")], { type: mime }), `nota.${ext}`);
  form.append("model", env("GROQ_STT_MODEL") || "whisper-large-v3-turbo");
  form.append("response_format", "json");
  form.append("temperature", "0");
  // Whisper gets at most half the budget, so Gemini can still try when it fails.
  const got = await fetchJson("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form }, Math.min(BUDGET_MS / 2, left(until)));
  if (!got || !got.r.ok) return null;
  return typeof got.data?.text === "string" ? got.data.text.trim() : null;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  return JSON.parse(m ? m[0] : "");
}

// ---------- Your own AI (0.16.0-prueba) ----------
// The person can connect their own AI account in Ajustes. The key lives only on their device; the app sends it
// in x-user-ai-key (and the provider in x-user-ai-provider) with each request, and it is used for that one call only:
// never stored, logged or sent back. The prompt and the JSON reply are the same ones Gemini gets, so the app reads
// the answer exactly as before. To add Gemini or Claude later, add an entry to PROVIDERS with the same shape.
const USER_MSG = {
  invalid: "Tu clave de OpenAI no funcionó. Revísala con el tutorial y pégala de nuevo.",
  credit: "Tu cuenta de OpenAI no tiene saldo o llegó a su límite. Agrégale saldo y vuelve a intentarlo.",
};
const CREDIT_CODES = new Set(["insufficient_quota", "billing_hard_limit_reached", "billing_not_active"]);

// OpenAI chat completions. Returns { ok, text } or { ok:false, kind:"invalid"|"credit"|"other" }.
// OpenAI's own error text is never passed on: on a bad key it repeats part of the key.
async function openai(key, { turns, image, input }, until) {
  const messages = image && image.data && typeof input === "string"
    ? [{ role: "user", content: [
      { type: "image_url", image_url: { url: `data:${String(image.mime || "image/jpeg").split(";")[0]};base64,${image.data}` } },
      { type: "text", text: input.slice(0, 20000) },
    ] }]
    : turns.slice(-12).map((t) => ({ role: t.role === "assistant" ? "assistant" : "user", content: String(t.content).slice(0, 20000) }));
  // JSON mode needs the word "json" somewhere in the messages; the app's prompts say it, but a reply is still read without it.
  const json = /json/i.test(JSON.stringify(messages.map((m) => (typeof m.content === "string" ? m.content : m.content[1].text))));
  const got = await fetchJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, temperature: 0.6, ...(json ? { response_format: { type: "json_object" } } : {}) }),
  }, left(until));
  if (!got) return { ok: false, kind: "other" };
  const { r, data } = got, code = data && data.error && (data.error.code || data.error.type);
  if (r.status === 401) return { ok: false, kind: "invalid" };
  if (r.status === 429 || CREDIT_CODES.has(code)) return { ok: false, kind: "credit" };
  if (!r.ok) return { ok: false, kind: "other" };
  return { ok: true, text: data.choices?.[0]?.message?.content || "" };
}
const PROVIDERS = { openai };

// The person's key and provider from the headers, or null. Only printable characters, so nothing odd reaches a header.
function userAi(req) {
  const key = String(req.headers["x-user-ai-key"] || "").trim();
  if (!key) return null;
  const provider = String(req.headers["x-user-ai-provider"] || "openai").trim().toLowerCase();
  return { key, provider, ok: /^[\x21-\x7e]{8,300}$/.test(key) && !!PROVIDERS[provider] };
}

async function ownAi(res, mine, body) {
  if (!mine.ok) return res.status(400).json({ error: "user_key_invalid", message: USER_MSG.invalid });
  const until = Date.now() + BUDGET_MS;
  const out = await PROVIDERS[mine.provider](mine.key, body, until);
  if (!out.ok) {
    if (out.kind === "invalid") return res.status(400).json({ error: "user_key_invalid", message: USER_MSG.invalid });
    if (out.kind === "credit") return res.status(402).json({ error: "user_key_no_credit", message: USER_MSG.credit });
    return res.status(502).json({ error: "ai_error", message: "Error de la IA." });
  }
  try { res.json({ data: parseJson(out.text) }); }
  catch { res.status(502).json({ error: "invalid_json", message: "La IA respondió algo que no entendí.", text: out.text }); }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!(await who(req))) return deny(res);
  // The person's own AI answers everything but voice notes (those stay with Whisper/Gemini, as before).
  const mine = userAi(req);
  if (mine) {
    const b = await readBody(req);
    if (!(b.audio && b.audio.data)) {
      const turns = typeof b.input === "string" ? [{ role: "user", content: b.input }] : Array.isArray(b.input) ? b.input : [];
      if (!turns.length) return res.status(400).json({ error: "bad_request" });
      return ownAi(res, mine, { turns, image: b.image, input: b.input });
    }
  }
  const key = env("GEMINI_API_KEY");
  if (!key) return res.status(503).json({ error: "no_ai", message: "Falta configurar GEMINI_API_KEY en Vercel." });
  const { input, search, audio, image } = await readBody(req);
  const until = Date.now() + BUDGET_MS;

  // Voice notes: Groq's Whisper first (fast, detects the language, even mixed), then Gemini.
  if (audio && audio.data) {
    const mime = String(audio.mime || "audio/webm").split(";")[0];
    const heard = await whisper(audio.data, mime, until);
    if (heard !== null) return res.json({ data: { texto: heard } });
    const out = await gemini(key, { contents: [{ role: "user", parts: [
      { inline_data: { mime_type: mime, data: audio.data } },
      { text: "Transcribe este audio palabra por palabra, en el idioma en que se habló (puede ser español, inglés u otro, o una mezcla), sin traducir, corregir ni agregar nada. Si no se entiende nada, responde vacío. Responde solo el texto." },
    ] }] }, until);
    if (!out.ok) return res.status(BUSY.has(out.status) ? 429 : 502).json({ error: BUSY.has(out.status) ? "rate_limited" : "ai_error", message: out.message || "No pude transcribir." });
    return res.json({ data: { texto: out.text.trim() } });
  }

  const turns = typeof input === "string" ? [{ role: "user", content: input }] : Array.isArray(input) ? input : [];
  if (!turns.length) return res.status(400).json({ error: "bad_request" });
  const contents = image && image.data && typeof input === "string"
    ? [{ role: "user", parts: [{ inline_data: { mime_type: String(image.mime || "image/jpeg").split(";")[0], data: image.data } }, { text: input.slice(0, 20000) }] }]
    : turns.slice(-12).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: String(t.content).slice(0, 20000) }] }));

  // Google Search grounding cannot be combined with a forced JSON reply, so it asks for JSON in the prompt instead.
  // With search, that pass gets about half the time, so the plain answer can still come after it.
  // With Groq set up (text only), the last seconds are kept for it.
  const forGroq = !image && env("GROQ_API_KEY") ? GROQ_MS : 0;
  let out = search
    ? await gemini(key, { contents, tools: [{ google_search: {} }], generationConfig: { temperature: 0.7 } }, until - forGroq - Math.round(BUDGET_MS * 0.4))
    : null;
  if (!out || !out.ok) out = await gemini(key, { contents, generationConfig: { responseMimeType: "application/json", temperature: 0.6 } }, until - forGroq);
  if (!out.ok && !image) { const g = await groq(contents, true, until); if (g && g.ok) out = g; }
  if (!out.ok) {
    const limited = BUSY.has(out.status);
    return res.status(limited ? 429 : 502).json({ error: limited ? "rate_limited" : "ai_error", message: out.message || "Error de la IA." });
  }
  try { res.json({ data: parseJson(out.text) }); }
  catch { res.status(502).json({ error: "invalid_json", message: "La IA respondió algo que no entendí.", text: out.text }); }
}
