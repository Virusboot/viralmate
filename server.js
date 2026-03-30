import express from "express";
import cors from "cors";
import axios from "axios";
import crypto from "crypto";
import { Resend } from "resend";

// ─── ENV CHECK ────────────────────────────────────────────────────────────────
const REQUIRED_ENV = ["GROQ_API_KEY", "RESEND_API_KEY"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ ${key} is not set. Exiting.`);
    process.exit(1);
  }
}

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

// ─── CORS — Android APK ke liye wildcard + OPTIONS handle zaroori ─────────────
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"] }));
app.options("*", cors());
app.use(express.json({ limit: "10kb" }));

// ─── IN-MEMORY STORE ──────────────────────────────────────────────────────────
const otpStore = new Map();
const userStore = new Map();
const socialStore = new Map(); // platform:handle -> { token, connectedAt }

function hashPass(p) {
  return crypto.createHash("sha256")
    .update(p + (process.env.PASSWORD_SALT || "viralmate_2024")).digest("hex");
}
function genOtp() { return Math.floor(100000 + Math.random() * 900000).toString(); }
function validEmail(e) { return /^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(e); }

async function sendOtp(email, otp, purpose) {
  const isReset = purpose === "reset";
  await resend.emails.send({
    from: "ViralMate <onboarding@resend.dev>",
    to: [email],
    subject: isReset ? "ViralMate - Password Reset OTP" : "ViralMate - Verify Your Email",
    html: `<div style="font-family:Arial,sans-serif;max-width:460px;background:#080810;padding:32px;border-radius:16px;color:#fff;">
      <h2>${isReset ? "🔐 Password Reset" : "✉️ Verify Your Email"}</h2>
      <p style="color:#9CA3AF">${isReset ? "Password reset OTP:" : "Account verify karne ke liye OTP:"}</p>
      <div style="background:#12121E;border:2px solid #6366F1;border-radius:14px;padding:24px;text-align:center;margin:20px 0;">
        <span style="font-size:40px;font-weight:800;letter-spacing:10px;color:#6366F1;">${otp}</span>
      </div>
      <p style="color:#6B7280;font-size:12px;text-align:center;">10 minutes mein expire hoga.</p>
    </div>`,
  });
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.get("/", (_, res) => res.json({ status: "ok", message: "ViralMate Backend 🚀", version: "2.0" }));

app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "Sabhi fields required hain." });
  const key = email.trim().toLowerCase();
  if (!validEmail(key)) return res.status(400).json({ error: "Valid email daalein." });
  if (password.length < 6) return res.status(400).json({ error: "Password kam se kam 6 characters." });
  if (userStore.has(key)) return res.status(409).json({ error: "Email pehle se registered hai." });
  userStore.set(key, { name: name.trim(), password: hashPass(password), verified: false, plan: "free" });
  const otp = genOtp();
  otpStore.set(`${key}:verify`, { otp, expiresAt: Date.now() + 600000 });
  try { await sendOtp(key, otp, "verify"); return res.json({ success: true }); }
  catch (e) { return res.status(500).json({ error: "Email send nahi hui." }); }
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email aur password dono zaroori." });
  const key = email.trim().toLowerCase();
  const user = userStore.get(key);
  if (!user || user.password !== hashPass(password)) return res.status(401).json({ error: "Email ya password galat hai." });
  if (!user.verified) return res.status(403).json({ error: "Pehle email verify karein." });
  return res.json({ success: true, token: crypto.randomBytes(32).toString("hex"),
    user: { name: user.name, email: key, plan: user.plan } });
});

app.post("/verify-otp", (req, res) => {
  const { email, otp, purpose } = req.body;
  if (!email || !otp || !purpose) return res.status(400).json({ error: "Email, OTP aur purpose zaroori." });
  const key = email.trim().toLowerCase();
  const sk = `${key}:${purpose}`;
  const rec = otpStore.get(sk);
  if (!rec) return res.status(400).json({ error: "OTP expired ya invalid. Dobara request karein." });
  if (Date.now() > rec.expiresAt) { otpStore.delete(sk); return res.status(400).json({ error: "OTP expire ho gaya." }); }
  if (rec.otp !== String(otp).trim()) return res.status(400).json({ error: "Galat OTP." });
  if (purpose === "verify") {
    const u = userStore.get(key);
    if (u) userStore.set(key, { ...u, verified: true });
    otpStore.delete(sk);
    return res.json({ success: true });
  }
  if (purpose === "reset") { otpStore.set(sk, { ...rec, verified: true }); return res.json({ success: true }); }
  return res.status(400).json({ error: "Invalid purpose." });
});

app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email zaroori hai." });
  const key = email.trim().toLowerCase();
  if (!userStore.has(key)) return res.json({ success: true }); // don't reveal
  const otp = genOtp();
  otpStore.set(`${key}:reset`, { otp, expiresAt: Date.now() + 600000, verified: false });
  try { await sendOtp(key, otp, "reset"); return res.json({ success: true }); }
  catch { return res.status(500).json({ error: "Email send nahi hui." }); }
});

app.post("/reset-password", (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) return res.status(400).json({ error: "Sabhi fields required." });
  const key = email.trim().toLowerCase();
  const sk = `${key}:reset`;
  const rec = otpStore.get(sk);
  if (!rec?.verified) return res.status(400).json({ error: "Pehle OTP verify karein." });
  if (rec.otp !== String(otp).trim()) return res.status(400).json({ error: "Invalid OTP." });
  if (newPassword.length < 6) return res.status(400).json({ error: "Password 6+ characters ka hona chahiye." });
  const user = userStore.get(key);
  if (!user) return res.status(404).json({ error: "User nahi mila." });
  userStore.set(key, { ...user, password: hashPass(newPassword) });
  otpStore.delete(sk);
  return res.json({ success: true });
});

app.post("/resend-otp", async (req, res) => {
  const { email, purpose } = req.body;
  if (!email || !purpose) return res.status(400).json({ error: "Email aur purpose zaroori." });
  const key = email.trim().toLowerCase();
  const otp = genOtp();
  otpStore.set(`${key}:${purpose}`, { otp, expiresAt: Date.now() + 600000, verified: false });
  try { await sendOtp(key, otp, purpose); return res.json({ success: true }); }
  catch { return res.status(500).json({ error: "Email send nahi hui." }); }
});

// ─── SOCIAL CONNECT ───────────────────────────────────────────────────────────
app.post("/social/connect", async (req, res) => {
  const { platform, token } = req.body;
  const SUPPORTED = ["instagram", "facebook", "youtube"];

  if (!platform || !token || !SUPPORTED.includes(platform)) {
    return res.status(400).json({ error: "Platform aur token zaroori hain." });
  }
  if (typeof token !== "string" || token.trim().length < 10) {
    return res.status(400).json({ error: "Valid access token provide karein." });
  }

  const t = token.trim();
  let accountName = "", handle = "", followers = "";

  try {
    if (platform === "instagram") {
      const r = await axios.get("https://graph.instagram.com/me", {
        params: { fields: "id,username,media_count", access_token: t },
        timeout: 10000,
      });
      accountName = `@${r.data.username}`;
      handle = r.data.username;
      followers = r.data.media_count != null ? `${r.data.media_count} posts` : "";

    } else if (platform === "facebook") {
      const r = await axios.get("https://graph.facebook.com/me", {
        params: { fields: "id,name,fan_count", access_token: t },
        timeout: 10000,
      });
      accountName = r.data.name;
      handle = r.data.id;
      followers = r.data.fan_count ? `${Number(r.data.fan_count).toLocaleString()} followers` : "";

    } else if (platform === "youtube") {
      const r = await axios.get("https://www.googleapis.com/youtube/v3/channels", {
        params: { part: "snippet,statistics", mine: true },
        headers: { Authorization: `Bearer ${t}` },
        timeout: 10000,
      });
      if (!r.data.items?.length) {
        return res.status(400).json({ error: "YouTube channel nahi mila. Token check karein." });
      }
      const ch = r.data.items[0];
      accountName = ch.snippet.title;
      handle = ch.snippet.customUrl || ch.id;
      const subs = ch.statistics?.subscriberCount;
      followers = subs ? `${Number(subs).toLocaleString()} subscribers` : "";
    }

    socialStore.set(`${platform}:${handle}`, { token: t, connectedAt: new Date().toISOString() });

    return res.json({ success: true, platform, accountName, handle, followers });

  } catch (err) {
    const s = err.response?.status;
    if (s === 190 || s === 401) return res.status(401).json({ error: "Token invalid ya expired. Naya token generate karein." });
    if (s === 403) return res.status(403).json({ error: "Token mein required permissions nahi hain." });
    console.error(`${platform} error:`, err.response?.data || err.message);
    return res.status(500).json({ error: "Platform verify nahi ho saka. Token check karein." });
  }
});

// ─── AI ───────────────────────────────────────────────────────────────────────
app.post("/ai", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "Prompt required." });
  }
  if (prompt.length > 2000) return res.status(400).json({ error: "Prompt 2000 chars se chhota rakho." });

  try {
    const r = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "You are ViralMate, an expert social media content creator for Instagram, YouTube Shorts, Facebook. Be creative, engaging, and practical. Respond in the same language as the user." },
        { role: "user", content: prompt.trim() },
      ],
      max_tokens: 1024, temperature: 0.8,
    }, { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, timeout: 30000 });

    return res.json({ result: r.data.choices[0].message.content });
  } catch (err) {
    if (err.code === "ECONNABORTED") return res.status(504).json({ error: "AI timeout." });
    if (err.response?.status === 429) return res.status(429).json({ error: "Too many requests. Thoda wait karo." });
    return res.status(500).json({ error: "AI unavailable. Dobara try karein." });
  }
});

app.use((_, res) => res.status(404).json({ error: "Route not found." }));
app.use((err, _, res, _next) => { console.error(err); res.status(500).json({ error: "Server error." }); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`✅ ViralMate v2.0 running on port ${PORT}`));
