// The app manifest for an invite link: the same as manifest.webmanifest, but the installed app opens the
// person's own agenda (start_url keeps their key), since an iPhone app does not share Safari's storage.
import fs from "node:fs";
import path from "node:path";

let base;
try { base = JSON.parse(fs.readFileSync(path.join(process.cwd(), "manifest.webmanifest"), "utf8")); }
catch {
  base = { name: "Pendi", short_name: "Pendi", start_url: "/", scope: "/", display: "standalone", background_color: "#FFFBEA", theme_color: "#FFD23F",
    icons: [{ src: "/icon-192.png?v=6", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png?v=6", sizes: "512x512", type: "image/png" }, { src: "/apple-touch-icon.png?v=6", sizes: "180x180", type: "image/png" }] };
}

export default function handler(req, res) {
  const key = String((req.query && req.query.invite) || "");
  const m = { ...base };
  if (/^[A-Za-z0-9_-]{20,64}$/.test(key)) m.start_url = "/?invite=" + key;
  res.setHeader("content-type", "application/manifest+json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(m));
}
