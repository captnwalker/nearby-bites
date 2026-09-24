const ICONS = require("../icons/icon-data.js");

function pick(req) {
  const q = (req.query && (req.query.s || req.query.size)) || "";
  const url = String(req.url || "");
  const hint = String(q) + " " + url;
  if (hint.includes("512")) return "512";
  if (hint.includes("192")) return "192";
  return "180";
}

module.exports = function handler(req, res) {
  const key = pick(req);
  const buf = Buffer.from(ICONS[key], "base64");
  if (!buf || buf.length < 8 || buf[0] !== 0x89) {
    res.status(500).end("bad icon");
    return;
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", String(buf.length));
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).end(buf);
};
