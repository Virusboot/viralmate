import express from "express";
import cors from "cors";
import axios from "axios";
import crypto from "crypto";
import nodemailer from "nodemailer";

// ─── Startup Checks ───────────────────────────────────────────────────────────
const REQUIRED_ENV = ["GROQ_API_KEY", "EMAIL_USER", "EMAIL_PASS"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ ${key} is not set. Exiting.`);
    process.exit(1);
  }
}

// Facebook OAuth optional (warn only)
if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
  console.warn("⚠️  FACEBOOK_APP_ID / FACEBOOK_APP_SECRET not set. Facebook login will be disabled.");
}

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: "*", // Production mein apna domain dalo
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "10kb" }));

// ─── In-Memory Stores (Production mein Redis ya DB use karein) ────────────────
// { email -> { hash, expiresAt, purpose } }
const otpStore = new Map();
// { email -> { name, hashedPassword, verified } }
const userStore = new Map();
// Pre-seed demo user
userStore.set("user@viralmate.com", {
  name: "Harsh Bhardwaj",
  hashedPassword: hashPassword("secret123"),
  verified: true,
  plan: "free",
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hashPassword(plain) {
  return crypto.createHash("sha256").update(plain + "viralmate_salt_2024").digest("hex");
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function isValidEmail(email) {
  return /^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(email);
}

// ─── Nodemailer Transporter ───────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Gmail App Password
  },
});

async function sendOtpEmail(toEmail, otp, purpose) {
  const isReset = purpose === "reset";
  const subject = isReset
    ? "ViralMate - Password Reset OTP"
    : "ViralMate - Email Verification OTP";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #080810; color: #fff; border-radius: 16px; padding: 36px;">
      <div style="text-align: center; margin-bottom: 28px;">
        <div style="display: inline-block; background: linear-gradient(135deg, #6366F1, #8B5CF6); border-radius: 14px; padding: 12px 20px;">
          <span style="font-size: 22px; font-weight: 800; color: #fff;">⚡ ViralMate</span>
        </div>
      </div>
      <h2 style="font-size: 22px; font-weight: 700; margin-bottom: 8px;">
        ${isReset ? "🔐 Password Reset" : "✉️ Verify Your Email"}
      </h2>
      <p style="color: #9CA3AF; font-size: 15px; line-height: 1.6; margin-bottom: 28px;">
        ${isReset
          ? "Aapne password reset request ki hai. Yeh OTP use karein:"
          : "ViralMate mein welcome! Apna account verify karne ke liye yeh OTP use karein:"}
      </p>
      <div style="background: #12121E; border: 1px solid #6366F1; border-radius: 14px; padding: 24px; text-align: center; margin-bottom: 24px;">
        <span style="font-size: 42px; font-weight: 800; letter-spacing: 12px; color: #6366F1;">${otp}</span>
      </div>
      <p style="color: #6B7280; font-size: 13px; text-align: center;">
        ⏱️ Yeh OTP <strong style="color: #fff;">10 minutes</strong> mein expire ho jayega.<br/>
        Agar yeh aapne request nahi ki, ignore karein.
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `"ViralMate" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject,
    html,
  });
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "ViralMate Backend running 🚀" });
});

// ─── Login ────────────────────────────────────────────────────────────────────
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email aur password dono zaroori hain." });
  }

  const key = email.trim().toLowerCase();
  if (!isValidEmail(key)) {
    return res.status(400).json({ error: "Valid email daalein." });
  }

  const user = userStore.get(key);
  if (!user || user.hashedPassword !== hashPassword(password)) {
    return res.status(401).json({ error: "Email ya password galat hai." });
  }

  if (!user.verified) {
    return res.status(403).json({ error: "Pehle email verify karein. OTP check karein." });
  }

  return res.status(200).json({
    success: true,
    token: "jwt-token-" + crypto.randomBytes(16).toString("hex"),
    user: { name: user.name, email: key, plan: user.plan || "free" },
  });
});

// ─── Register ─────────────────────────────────────────────────────────────────
app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password ||
      typeof name !== "string" || typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Name, email aur password zaroori hain." });
  }

  const trimName = name.trim();
  const key = email.trim().toLowerCase();

  if (trimName.length < 2) return res.status(400).json({ error: "Name bahut chhota hai." });
  if (!isValidEmail(key)) return res.status(400).json({ error: "Valid email daalein." });
  if (password.length < 6) return res.status(400).json({ error: "Password kam se kam 6 characters ka hona chahiye." });
  if (userStore.has(key) && userStore.get(key).verified) {
    return res.status(409).json({ error: "Yeh email pehle se registered hai." });
  }

  // Save user (unverified)
  userStore.set(key, {
    name: trimName,
    hashedPassword: hashPassword(password),
    verified: false,
    plan: "free",
  });

  // Generate & send OTP
  const otp = generateOtp();
  otpStore.set(`${key}:verify`, {
    otp,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  try {
    await sendOtpEmail(key, otp, "verify");
    return res.status(200).json({ success: true, message: "OTP bhej diya gaya. Email check karein." });
  } catch (err) {
    console.error("Email send error:", err.message);
    return res.status(500).json({ error: "OTP email bhejne mein problem aayi. Admin se contact karein." });
  }
});

// ─── Verify OTP ───────────────────────────────────────────────────────────────
app.post("/verify-otp", async (req, res) => {
  const { email, otp, purpose } = req.body;

  if (!email || !otp || !purpose ||
      typeof email !== "string" || typeof otp !== "string" || typeof purpose !== "string") {
    return res.status(400).json({ error: "Email, OTP aur purpose zaroori hain." });
  }

  const key = email.trim().toLowerCase();
  const storeKey = `${key}:${purpose}`;
  const record = otpStore.get(storeKey);

  if (!record) return res.status(400).json({ error: "OTP expired ya invalid hai. Dobara request karein." });
  if (Date.now() > record.expiresAt) {
    otpStore.delete(storeKey);
    return res.status(400).json({ error: "OTP expire ho gaya. Dobara request karein." });
  }
  if (record.otp !== otp.trim()) {
    return res.status(400).json({ error: "Galat OTP. Dobara check karein." });
  }

  // OTP valid!
  if (purpose === "verify") {
    const user = userStore.get(key);
    if (user) userStore.set(key, { ...user, verified: true });
    otpStore.delete(storeKey);
    return res.status(200).json({ success: true, message: "Email verify ho gayi!" });
  }

  if (purpose === "reset") {
    // Keep OTP in store for reset-password step (mark as verified)
    otpStore.set(storeKey, { ...record, verified: true });
    return res.status(200).json({ success: true, message: "OTP verified. Ab naya password set karein." });
  }

  return res.status(400).json({ error: "Invalid purpose." });
});

// ─── Forgot Password (send OTP) ───────────────────────────────────────────────
app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email zaroori hai." });
  }

  const key = email.trim().toLowerCase();
  if (!isValidEmail(key)) return res.status(400).json({ error: "Valid email daalein." });

  // Always return success to prevent email enumeration
  if (!userStore.has(key)) {
    return res.status(200).json({ success: true, message: "Agar email registered hai toh OTP bhej diya jayega." });
  }

  const otp = generateOtp();
  otpStore.set(`${key}:reset`, {
    otp,
    expiresAt: Date.now() + 10 * 60 * 1000,
    verified: false,
  });

  try {
    await sendOtpEmail(key, otp, "reset");
    return res.status(200).json({ success: true, message: "OTP bhej diya gaya. Email check karein." });
  } catch (err) {
    console.error("Email send error:", err.message);
    return res.status(500).json({ error: "OTP email bhejne mein problem aayi. Dobara try karein." });
  }
});

// ─── Reset Password ───────────────────────────────────────────────────────────
app.post("/reset-password", async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword ||
      typeof email !== "string" || typeof otp !== "string" || typeof newPassword !== "string") {
    return res.status(400).json({ error: "Email, OTP aur new password zaroori hain." });
  }

  const key = email.trim().toLowerCase();
  const storeKey = `${key}:reset`;
  const record = otpStore.get(storeKey);

  if (!record || !record.verified) {
    return res.status(400).json({ error: "OTP verify karo pehle." });
  }
  if (record.otp !== otp.trim()) {
    return res.status(400).json({ error: "Invalid OTP." });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "Password kam se kam 6 characters ka hona chahiye." });
  }

  const user = userStore.get(key);
  if (!user) return res.status(404).json({ error: "User nahi mila." });

  userStore.set(key, { ...user, hashedPassword: hashPassword(newPassword) });
  otpStore.delete(storeKey);

  return res.status(200).json({ success: true, message: "Password reset ho gaya! Ab login karein." });
});

// ─── Resend OTP ───────────────────────────────────────────────────────────────
app.post("/resend-otp", async (req, res) => {
  const { email, purpose } = req.body;

  if (!email || !purpose || typeof email !== "string" || typeof purpose !== "string") {
    return res.status(400).json({ error: "Email aur purpose zaroori hain." });
  }

  const key = email.trim().toLowerCase();
  if (!isValidEmail(key)) return res.status(400).json({ error: "Valid email daalein." });

  const otp = generateOtp();
  otpStore.set(`${key}:${purpose}`, {
    otp,
    expiresAt: Date.now() + 10 * 60 * 1000,
    verified: false,
  });

  try {
    await sendOtpEmail(key, otp, purpose);
    return res.status(200).json({ success: true, message: "OTP dobara bhej diya gaya." });
  } catch (err) {
    console.error("Resend error:", err.message);
    return res.status(500).json({ error: "OTP email nahi bheji ja saki. Dobara try karein." });
  }
});

// ─── Facebook OAuth ───────────────────────────────────────────────────────────
app.post("/auth/facebook", (req, res) => {
  if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
    return res.status(503).json({ error: "Facebook login is not configured." });
  }

  const redirectUri = encodeURIComponent(
    process.env.FACEBOOK_REDIRECT_URI || `${process.env.BACKEND_URL || "https://viralmate-production.up.railway.app"}/auth/facebook/callback`
  );
  const loginUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${process.env.FACEBOOK_APP_ID}&redirect_uri=${redirectUri}&scope=email,public_profile&response_type=code`;

  return res.status(200).json({ success: true, loginUrl });
});

// Facebook callback (browser redirect karenge yahan)
app.get("/auth/facebook/callback", async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect("/?fb_error=access_denied");
  }

  try {
    const redirectUri = process.env.FACEBOOK_REDIRECT_URI ||
      `${process.env.BACKEND_URL || "https://viralmate-production.up.railway.app"}/auth/facebook/callback`;

    // Exchange code for access token
    const tokenRes = await axios.get("https://graph.facebook.com/v19.0/oauth/access_token", {
      params: {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      },
    });

    const accessToken = tokenRes.data.access_token;

    // Get user info
    const userRes = await axios.get("https://graph.facebook.com/me", {
      params: { fields: "id,name,email", access_token: accessToken },
    });

    const fbUser = userRes.data;
    const email = fbUser.email || `fb_${fbUser.id}@viralmate.com`;
    const key = email.toLowerCase();

    // Create or update user
    if (!userStore.has(key)) {
      userStore.set(key, {
        name: fbUser.name,
        hashedPassword: hashPassword(crypto.randomBytes(32).toString("hex")),
        verified: true,
        plan: "free",
        facebookId: fbUser.id,
      });
    }

    const token = "jwt-fb-" + crypto.randomBytes(16).toString("hex");
    const user = userStore.get(key);

    // In production: redirect to deep link or Flutter WebView with token
    return res.json({
      success: true,
      token,
      user: { name: user.name, email: key, plan: user.plan },
    });
  } catch (err) {
    console.error("Facebook callback error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Facebook login failed. Dobara try karein." });
  }
});

// ─── AI Generation ─────────────────────────────────────────────────────────────
app.post("/ai", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return res.status(400).json({ error: "Prompt required aur non-empty hona chahiye." });
  }
  if (prompt.trim().length > 2000) {
    return res.status(400).json({ error: "Prompt bahut lamba hai. 2000 characters se kam rakho." });
  }

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama3-70b-8192",
        messages: [
          {
            role: "system",
            content: "You are ViralMate, an expert social media content creator specializing in viral content for Instagram, YouTube Shorts, and other platforms. Be creative, engaging, and practical.",
          },
          { role: "user", content: prompt.trim() },
        ],
        max_tokens: 1024,
        temperature: 0.8,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const result = response.data.choices[0].message.content;
    return res.status(200).json({ result });
  } catch (error) {
    console.error("Groq API Error:", error.response?.data || error.message);
    if (error.code === "ECONNABORTED") return res.status(504).json({ error: "AI response timeout. Dobara try karo." });
    if (error.response?.status === 401) return res.status(500).json({ error: "AI authentication failed." });
    if (error.response?.status === 429) return res.status(429).json({ error: "Too many requests. Thodi der baad try karo." });
    return res.status(500).json({ error: error.response?.data?.error?.message || "AI service unavailable." });
  }
});

// ─── 404 & Error Handlers ─────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Route not found." }));
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ ViralMate server running on port ${PORT}`));
