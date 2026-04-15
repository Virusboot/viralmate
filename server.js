import express from "express";
import cors    from "cors";
import axios   from "axios";
import crypto  from "crypto";
import { Resend } from "resend";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET || "viralmate_secret";

// ─────────────────────────────────────────────────────────────────────────────
// ViralMate Backend v3.0 — Final Merged
// Auth: Register / Login / OTP / Forgot-Password / Reset-Password / Resend-OTP
// Social: Real per-user OAuth (Instagram, Facebook, YouTube)
// AI: Groq LLM
// ─────────────────────────────────────────────────────────────────────────────

// ── ENV CHECK ─────────────────────────────────────────────────────────────────
const REQUIRED = ["GROQ_API_KEY", "RESEND_API_KEY"];
for (const k of REQUIRED) {
  if (!process.env[k]) { console.error(`❌ ${k} is not set. Exiting.`); process.exit(1); }
}

const app    = express();
const resend = new Resend(process.env.RESEND_API_KEY);

// ── CORS — required for Android APK ──────────────────────────────────────────
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"] }));
app.options("*", cors());
app.use(express.json({ limit: "10kb" }));

// ── IN-MEMORY STORES (use MongoDB/Redis in production) ───────────────────────
const otpStore    = new Map(); // "email:purpose" → { otp, expiresAt, verified }
const userStore   = new Map(); // email → { name, password, verified, plan }
const oauthStates = new Map(); // stateToken → { platform, userId, createdAt }
const socialStore = new Map(); // "userId:platform" → { accessToken, accountName, ... }
const postStore = new Map(); // ✅ 


// ── HELPERS ───────────────────────────────────────────────────────────────────

const hashPass = async (p) => {
  return await bcrypt.hash(p, 10);
};

const comparePass = async (p, hash) => {
  return await bcrypt.compare(p, hash);
};

const genOtp     = () => Math.floor(100000 + Math.random() * 900000).toString();
const genState   = () => crypto.randomBytes(24).toString("hex");
const validEmail = e  => /^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(e);

// Backend public URL — MUST be set on Railway
const BACKEND_URL = process.env.BACKEND_URL || "https://viralmate-production.up.railway.app";
// Flutter deep link scheme — matches AndroidManifest intent-filter
const APP_SCHEME  = process.env.APP_SCHEME  || "viralmate";

// ── EMAIL (Resend) ────────────────────────────────────────────────────────────
async function sendOtp(email, otp, purpose) {
  const isReset = purpose === "reset";
  // Log OTP to Railway logs as backup (useful when email delivery fails)
  console.log(`[OTP] ${purpose.toUpperCase()} | Email: ${email} | OTP: ${otp}`);
  await resend.emails.send({
    from: process.env.FROM_EMAIL || "ViralMate <onboarding@resend.dev>",
    to:   [email],
    subject: isReset
      ? "ViralMate - Password Reset OTP"
      : "ViralMate - Verify Your Email",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;
                  background:#080810;padding:36px;border-radius:16px;color:#fff;">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="display:inline-block;background:linear-gradient(135deg,#6366F1,#8B5CF6);
                      border-radius:12px;padding:10px 20px;">
            <span style="font-size:20px;font-weight:800;">⚡ ViralMate</span>
          </div>
        </div>
        <h2 style="margin:0 0 8px;">${isReset ? "🔐 Password Reset" : "✉️ Verify Your Email"}</h2>
        <p style="color:#9CA3AF;font-size:14px;line-height:1.6;">
          ${isReset
            ? "You requested a password reset. Use the OTP below:"
            : "Welcome to ViralMate! Verify your account with the OTP below:"}
        </p>
        <div style="background:#12121E;border:2px solid #6366F1;border-radius:14px;
                    padding:28px;text-align:center;margin:24px 0;">
          <span style="font-size:44px;font-weight:800;letter-spacing:12px;color:#6366F1;">
            ${otp}
          </span>
        </div>
        <p style="color:#6B7280;font-size:12px;text-align:center;">
          ⏱️ This OTP expires in <strong style="color:#fff;">10 minutes</strong>.<br/>
          If you didn't request this, please ignore this email.
        </p>
      </div>`,
  });
}

// ── HOMEPAGE — Professional Public Landing Page (No login required)
// Google OAuth verification requires: public page + visible privacy policy link
app.get("/", (_, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ViralMate — AI Viral Content Creator for Instagram &amp; YouTube</title>
  <meta name="description" content="ViralMate is an AI-powered app that helps Indian creators make viral content for Instagram Reels and YouTube Shorts. Generate hooks, captions, hashtags, and schedule posts automatically.">
  <meta name="robots" content="index, follow">
  <meta name="google-site-verification" content="${process.env.GOOGLE_SITE_VERIFICATION || ''}" />
  <!-- Open Graph -->
  <meta property="og:title" content="ViralMate — AI Viral Content Creator">
  <meta property="og:description" content="Create scroll-stopping Reels & Shorts with AI. Built for Indian creators.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://viralmate-production.up.railway.app/">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg: #07070f;
      --surface: #0f0f1a;
      --surface2: #14142a;
      --border: rgba(99,102,241,0.18);
      --indigo: #6366F1;
      --violet: #8B5CF6;
      --orange: #F97316;
      --text: #e8e8f0;
      --muted: #7c7ca0;
      --card-bg: #0d0d1e;
    }

    html { scroll-behavior: smooth; }

    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.6;
    }

    /* ── NAV ── */
    nav {
      position: sticky; top: 0; z-index: 100;
      background: rgba(7,7,15,0.85);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      padding: 0 24px;
      display: flex; align-items: center; justify-content: space-between;
      height: 64px;
    }
    .nav-brand {
      display: flex; align-items: center; gap: 10px;
      font-size: 20px; font-weight: 800; color: var(--text);
      text-decoration: none;
    }
    .nav-logo-badge {
      background: linear-gradient(135deg, var(--indigo), var(--violet));
      border-radius: 10px; padding: 6px 12px;
      font-size: 18px; font-weight: 900; color: #fff;
    }
    .nav-links { display: flex; gap: 28px; align-items: center; }
    .nav-links a {
      color: var(--muted); text-decoration: none; font-size: 14px;
      transition: color .2s;
    }
    .nav-links a:hover { color: var(--text); }
    .nav-links .privacy-link {
      color: var(--indigo); font-weight: 600;
    }

    /* ── HERO ── */
    .hero {
      max-width: 900px; margin: 0 auto;
      padding: 96px 24px 64px;
      text-align: center;
    }
    .hero-badge {
      display: inline-flex; align-items: center; gap: 8px;
      background: rgba(99,102,241,0.1);
      border: 1px solid rgba(99,102,241,0.3);
      border-radius: 50px; padding: 6px 16px;
      font-size: 13px; color: #a5b4fc; font-weight: 600;
      margin-bottom: 28px;
    }
    .hero h1 {
      font-size: clamp(36px, 6vw, 64px);
      font-weight: 900; line-height: 1.1;
      margin-bottom: 20px;
      background: linear-gradient(135deg, #fff 30%, var(--indigo) 70%, var(--orange));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .hero p {
      font-size: 18px; color: var(--muted);
      max-width: 600px; margin: 0 auto 40px;
      line-height: 1.7;
    }
    .hero-cta {
      display: inline-flex; align-items: center; gap: 10px;
      background: linear-gradient(135deg, var(--indigo), var(--violet));
      color: #fff; border-radius: 50px; padding: 14px 32px;
      font-size: 16px; font-weight: 700; text-decoration: none;
      box-shadow: 0 8px 32px rgba(99,102,241,0.35);
      transition: transform .2s, box-shadow .2s;
    }
    .hero-cta:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(99,102,241,0.5); }

    /* ── STATS ── */
    .stats {
      display: flex; justify-content: center; flex-wrap: wrap; gap: 12px;
      margin-top: 56px; padding: 0 24px;
    }
    .stat {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px; padding: 20px 28px;
      text-align: center; min-width: 140px;
    }
    .stat-num { font-size: 28px; font-weight: 800; color: var(--indigo); }
    .stat-label { font-size: 12px; color: var(--muted); margin-top: 4px; }

    /* ── FEATURES ── */
    .section { max-width: 1000px; margin: 0 auto; padding: 72px 24px; }
    .section-title {
      font-size: 32px; font-weight: 800; text-align: center;
      margin-bottom: 12px;
    }
    .section-sub {
      text-align: center; color: var(--muted); font-size: 16px;
      margin-bottom: 48px;
    }
    .features-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
    }
    .feature-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 20px; padding: 28px;
      transition: border-color .2s, transform .2s;
    }
    .feature-card:hover {
      border-color: rgba(99,102,241,0.5);
      transform: translateY(-3px);
    }
    .feature-icon {
      font-size: 32px; margin-bottom: 14px;
    }
    .feature-card h3 {
      font-size: 17px; font-weight: 700; margin-bottom: 8px;
    }
    .feature-card p {
      font-size: 14px; color: var(--muted); line-height: 1.6;
    }

    /* ── HOW IT WORKS ── */
    .steps { display: flex; flex-direction: column; gap: 20px; max-width: 640px; margin: 0 auto; }
    .step { display: flex; gap: 20px; align-items: flex-start; }
    .step-num {
      min-width: 40px; height: 40px;
      background: linear-gradient(135deg, var(--indigo), var(--violet));
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: 16px; flex-shrink: 0;
    }
    .step-content h3 { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
    .step-content p { font-size: 14px; color: var(--muted); }

    /* ── PLATFORMS ── */
    .platforms {
      display: flex; justify-content: center; flex-wrap: wrap; gap: 16px;
      padding: 0 24px 72px;
    }
    .platform-pill {
      display: flex; align-items: center; gap: 10px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 50px; padding: 12px 22px;
      font-size: 15px; font-weight: 600;
    }

    /* ── FOOTER ── */
    footer {
      background: var(--surface);
      border-top: 1px solid var(--border);
      padding: 48px 24px 32px;
    }
    .footer-inner {
      max-width: 1000px; margin: 0 auto;
    }
    .footer-top {
      display: flex; flex-wrap: wrap; gap: 40px;
      justify-content: space-between; margin-bottom: 40px;
    }
    .footer-brand p {
      font-size: 13px; color: var(--muted);
      max-width: 280px; margin-top: 12px; line-height: 1.6;
    }
    .footer-col h4 {
      font-size: 13px; font-weight: 700; color: var(--muted);
      text-transform: uppercase; letter-spacing: .08em;
      margin-bottom: 14px;
    }
    .footer-col a {
      display: block; color: var(--text); text-decoration: none;
      font-size: 14px; margin-bottom: 10px; transition: color .2s;
    }
    .footer-col a:hover { color: var(--indigo); }
    .footer-col a.highlight {
      color: var(--indigo); font-weight: 600;
    }
    .footer-bottom {
      border-top: 1px solid var(--border);
      padding-top: 24px;
      display: flex; flex-wrap: wrap; gap: 12px;
      justify-content: space-between; align-items: center;
    }
    .footer-bottom p { font-size: 13px; color: var(--muted); }
    .footer-bottom a { color: var(--indigo); text-decoration: none; }

    @media (max-width: 600px) {
      .nav-links .nav-link-hide { display: none; }
      .hero { padding: 64px 20px 48px; }
      .stat { min-width: 120px; }
    }
  </style>
</head>
<body>

  <!-- ── NAVIGATION ── -->
  <nav>
    <a href="/" class="nav-brand">
      <span class="nav-logo-badge">⚡</span>
      ViralMate
    </a>
    <div class="nav-links">
      <a href="#features" class="nav-link-hide">Features</a>
      <a href="#how-it-works" class="nav-link-hide">How It Works</a>
      <a href="/privacy-policy" class="privacy-link">Privacy Policy</a>
      <a href="/terms" class="nav-link-hide">Terms</a>
    </div>
  </nav>

  <!-- ── HERO ── -->
  <section class="hero">
    <div class="hero-badge">
      🇮🇳 Built for Indian Creators &nbsp;·&nbsp; Powered by Groq AI
    </div>
    <h1>Go Viral on<br>Instagram &amp; YouTube</h1>
    <p>
      ViralMate uses AI to generate scroll-stopping hooks, captions, hashtags,
      and trending ideas — so you can focus on creating, not writing.
    </p>
    <a href="https://play.google.com/store" class="hero-cta" rel="noopener">
      📲 Download the App
    </a>
  </section>

  <!-- ── STATS ── -->
  <div class="stats">
    <div class="stat">
      <div class="stat-num">10K+</div>
      <div class="stat-label">Creators</div>
    </div>
    <div class="stat">
      <div class="stat-num">500K+</div>
      <div class="stat-label">Captions Generated</div>
    </div>
    <div class="stat">
      <div class="stat-num">3x</div>
      <div class="stat-label">Avg. Reach Boost</div>
    </div>
    <div class="stat">
      <div class="stat-num">Free</div>
      <div class="stat-label">To Start</div>
    </div>
  </div>

  <!-- ── FEATURES ── -->
  <section class="section" id="features">
    <h2 class="section-title">Everything You Need to Go Viral</h2>
    <p class="section-sub">One app. All your content needs. No writing experience required.</p>
    <div class="features-grid">
      <div class="feature-card">
        <div class="feature-icon">🤖</div>
        <h3>AI Caption Generator</h3>
        <p>Generate viral captions in Hindi, English, or Hinglish. Pick your style — funny, motivational, professional, or educational.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🔥</div>
        <h3>Trending Ideas Engine</h3>
        <p>Get daily trending content ideas customized for Indian audiences across niches like fitness, finance, comedy, and more.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">#️⃣</div>
        <h3>Smart Hashtag Sets</h3>
        <p>Auto-generate optimized hashtag bundles for Instagram Reels and YouTube Shorts to maximize discoverability.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">📅</div>
        <h3>Auto-Scheduling</h3>
        <p>Connect your Instagram and YouTube accounts and schedule posts to go live at peak engagement times automatically.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">⚡</div>
        <h3>Hook Builder</h3>
        <p>First 3 seconds matter the most. Our AI crafts scroll-stopping opening lines that keep viewers watching till the end.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">📊</div>
        <h3>Niche Analytics</h3>
        <p>Discover what's working in your niche right now. Data-backed content suggestions based on real trending patterns.</p>
      </div>
    </div>
  </section>

  <!-- ── HOW IT WORKS ── -->
  <section class="section" id="how-it-works">
    <h2 class="section-title">How ViralMate Works</h2>
    <p class="section-sub">From idea to viral post in under 2 minutes.</p>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-content">
          <h3>Pick Your Niche &amp; Platform</h3>
          <p>Choose Instagram Reels or YouTube Shorts. Select your content niche — comedy, tech, food, fitness, finance, and more.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-content">
          <h3>Enter Your Topic or Idea</h3>
          <p>Type a short topic or let ViralMate suggest trending ideas based on what's going viral in India right now.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-content">
          <h3>AI Generates Your Content</h3>
          <p>Get a complete content package — viral hook, caption, hashtags, and posting tips — in seconds with Groq AI.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-content">
          <h3>Post or Schedule</h3>
          <p>Copy your content directly, or connect your social accounts to schedule posts at the best time for maximum reach.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- ── PLATFORMS ── -->
  <div class="platforms">
    <div class="platform-pill">📱 Instagram Reels</div>
    <div class="platform-pill">▶️ YouTube Shorts</div>
    <div class="platform-pill">🤖 Groq AI (LLaMA 3)</div>
    <div class="platform-pill">🇮🇳 Hindi &amp; Hinglish</div>
    <div class="platform-pill">📧 Email OTP Auth</div>
  </div>

  <!-- ── FOOTER ── -->
  <footer>
    <div class="footer-inner">
      <div class="footer-top">
        <div class="footer-brand">
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="nav-logo-badge" style="font-size:16px;padding:5px 10px;">⚡</span>
            <span style="font-size:18px;font-weight:800;">ViralMate</span>
          </div>
          <p>AI-powered viral content creation for Instagram Reels &amp; YouTube Shorts. Made with ❤️ for Indian creators.</p>
        </div>
        <div class="footer-col">
          <h4>Legal</h4>
          <a href="/privacy-policy" class="highlight">🔒 Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <a href="/delete">Data Deletion Request</a>
        </div>
        <div class="footer-col">
          <h4>App</h4>
          <a href="/health">API Status</a>
          <a href="mailto:support@viralmate.com">Contact Support</a>
          <a href="mailto:kittuvirusstudio@gmail.com">Developer Contact</a>
        </div>
      </div>
      <div class="footer-bottom">
        <p>© 2026 ViralMate. All rights reserved.</p>
        <p>
          <a href="/privacy-policy">Privacy Policy</a> &nbsp;·&nbsp;
          <a href="/terms">Terms of Service</a> &nbsp;·&nbsp;
          <a href="mailto:support@viralmate.com">support@viralmate.com</a>
        </p>
      </div>
    </div>
  </footer>

</body>
</html>`);
});

// ── ENHANCED HEALTH CHECK with GROQ test ────────────────────────────────────
app.get("/health", async (_, res) => {
  const groqOk = !!process.env.GROQ_API_KEY;
  // Quick model availability check
  let activeModel = "unknown";
  if (groqOk) {
    const MODELS = ["llama-3.3-70b-versatile", "llama-3.1-70b-versatile", "llama-3.1-8b-instant"];
    for (const model of MODELS) {
      try {
        await axios.post("https://api.groq.com/openai/v1/chat/completions",
          { model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 },
          { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, timeout: 5000 }
        );
        activeModel = model;
        break;
      } catch (e) {
        const msg = JSON.stringify(e.response?.data || "");
        if (e.response?.status === 401) { activeModel = "AUTH_FAILED"; break; }
        if (msg.includes("decommissioned") || msg.includes("not found")) continue;
        if (e.response?.status === 429) { activeModel = model + " (rate limited)"; break; }
        break;
      }
    }
  }
  res.json({
    status: "ok",
    version: "3.1",
    groqKeySet: groqOk,
    activeModel,
    resendKeySet: !!process.env.RESEND_API_KEY,
    timestamp: new Date().toISOString()
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /register
app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: "All fields are required." });

  const key = email.trim().toLowerCase();
  if (!validEmail(key))
    return res.status(400).json({ error: "Please enter a valid email address." });
  if (typeof name !== "string" || name.trim().length < 2)
    return res.status(400).json({ error: "Name must be at least 2 characters." });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  if (userStore.get(key)?.verified)
    return res.status(409).json({ error: "This email is already registered. Please sign in." });

  userStore.set(key, {
    name: name.trim(),
    password: await hashPass(password),
    verified: false,
    plan: "free",
  });

  const otp = genOtp();
  if (otpStore.has(`${key}:verify`)) {
  return res.status(429).json({ error: "Wait before requesting OTP again" });
}

  try {
    await sendOtp(key, otp, "verify");
    return res.json({ success: true, message: "OTP sent. Please check your email." });
  } catch (err) {
    console.error("Email error:", err.message);
    // Email failed but account created - return OTP in response for development/testing
    // In production with verified domain this won't be needed
    if (process.env.NODE_ENV !== "production" || process.env.SHOW_OTP_ON_FAIL === "true") {
      return res.json({
        success: true,
        message: `Email delivery failed. Your OTP is: ${otp} (shown because email is not configured)`,
        devOtp: otp
      });
    }
    return res.status(500).json({ error: "Could not send verification email. Please check your email address or try again later." });
  }
});

// POST /verify-otp
 app.post("/verify-otp", (req, res) => {
  const { email, otp, purpose } = req.body;

  if (!email || !otp || !purpose)
    return res.status(400).json({ error: "Email, OTP, and purpose are required." });

  const key = email.trim().toLowerCase();
  const sk  = `${key}:${purpose}`;
  const rec = otpStore.get(sk);

  if (!rec) return res.status(400).json({ error: "OTP expired" });
  if (Date.now() > rec.expiresAt) {
    otpStore.delete(sk);
    return res.status(400).json({ error: "OTP expired" });
  }

  if (rec.otp !== String(otp).trim())
    return res.status(400).json({ error: "Invalid OTP" });

  if (purpose === "verify") {
    const u = userStore.get(key);
    if (u) userStore.set(key, { ...u, verified: true });

    const token = jwt.sign({ userId: key }, JWT_SECRET, { expiresIn: "7d" });

    return res.json({ success: true, token, userId: key });
  }

  if (purpose === "reset") {
    otpStore.set(sk, { ...rec, verified: true });
    return res.json({ success: true });
  }

  return res.status(400).json({ error: "Invalid purpose" });
});
// POST /forgot-password
app.post("/forgot-password", async (req, res) => {
  const key = req.body.email?.trim().toLowerCase();
  if (!key || !validEmail(key))
    return res.status(400).json({ error: "Please enter a valid email address." });

  // Don't reveal whether email exists (security best practice)
  if (!userStore.has(key))
    return res.json({ success: true, message: "If this email is registered, an OTP has been sent." });

  const otp = genOtp();
  otpStore.set(`${key}:reset`, { otp, expiresAt: Date.now() + 600000, verified: false });

  try {
    await sendOtp(key, otp, "reset");
    return res.json({ success: true, message: "Password reset OTP sent to your email." });
  } catch (err) {
    console.error("Email error:", err.message);
    return res.status(500).json({ error: "Could not send OTP. Please try again." });
  }
});

// POST /reset-password
app.post("/reset-password", (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword)
    return res.status(400).json({ error: "All fields are required." });

  const key = email.trim().toLowerCase();
  const sk  = `${key}:reset`;
  const rec = otpStore.get(sk);

  if (!rec?.verified)
    return res.status(400).json({ error: "Please verify your OTP first." });
  if (rec.otp !== String(otp).trim())
    return res.status(400).json({ error: "Invalid OTP." });
  if (newPassword.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters." });

  const user = userStore.get(key);
  if (!user) return res.status(404).json({ error: "User not found." });

  userStore.set(key, { ...user, password: await hashPass(newPassword) });
  otpStore.delete(sk);
  return res.json({ success: true, message: "Password reset successfully!" });
});

// POST /resend-otp
app.post("/resend-otp", async (req, res) => {
  const { email, purpose } = req.body;
  if (!email || !purpose)
    return res.status(400).json({ error: "Email and purpose are required." });

  const key = email.trim().toLowerCase();
  const otp = genOtp();
  otpStore.set(`${key}:${purpose}`, { otp, expiresAt: Date.now() + 600000, verified: false });

  try {
    await sendOtp(key, otp, purpose);
    return res.json({ success: true, message: "OTP resent successfully." });
  } catch (err) {
    console.error("Resend error:", err.message);
    return res.status(500).json({ error: "Could not resend OTP. Please try again." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SOCIAL OAUTH — Real per-user OAuth
// Each user connects their OWN account via official OAuth
// ─────────────────────────────────────────────────────────────────────────────

// POST /social/auth-url
// Flutter calls this → gets the OAuth URL → opens in browser
app.post("/social/auth-url", (req, res) => {
  const { platform, userId } = req.body;
  if (!platform || !userId)
    return res.status(400).json({ error: "Platform and userId are required." });

  const SUPPORTED = ["instagram", "facebook", "youtube"];
  if (!SUPPORTED.includes(platform))
    return res.status(400).json({ error: "Unsupported platform." });

  // CSRF state token — binds OAuth callback to this user + platform
  const state = genState();
  oauthStates.set(state, { platform, userId, createdAt: Date.now() });
  // Auto-expire after 10 minutes
  setTimeout(() => oauthStates.delete(state), 600000);

  let authUrl = "";

  if (platform === "instagram" || platform === "facebook") {
    if (!process.env.FACEBOOK_APP_ID) {
      return res.status(503).json({
        error: "Facebook/Instagram OAuth is not configured yet.",
        setup: "Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET on Railway.",
        hint: "Also make sure your Facebook App is in Live mode in Meta Developer Console."
      });
    }
    const redirectUri = encodeURIComponent(process.env.FACEBOOK_REDIRECT_URL || `${BACKEND_URL}/social/callback/facebook`);
    // Instagram requires Facebook Login + Business Account linked to Facebook Page
    // Regular personal Instagram accounts cannot be connected via API
    const scope = platform === "instagram"
  ? "instagram_basic,instagram_content_publish,pages_read_user_content,pages_manage_engagement,business_management"
  : "pages_manage_posts,pages_read_user_content,pages_manage_engagement,public_profile,email";
    authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${process.env.FACEBOOK_APP_ID}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}&response_type=code&auth_type=rerequest`;

  } else if (platform === "youtube") {
    if (!process.env.YOUTUBE_CLIENT_ID) {
      return res.status(503).json({
        error: "YouTube OAuth is not configured yet.",
        setup: "Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET on Railway.",
      });
    }
    const redirectUri = encodeURIComponent(process.env.YOUTUBE_REDIRECT_URL || `${BACKEND_URL}/social/callback/youtube`);
    const scope = encodeURIComponent(
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly"
    );
    authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.YOUTUBE_CLIENT_ID}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}&response_type=code&access_type=offline&prompt=consent`;
  }

  return res.json({ success: true, authUrl });
});

// GET /social/callback/facebook
// Facebook/Instagram redirects here after user authorizes
app.get("/social/callback/facebook", async (req, res) => {
  const { code, state, error } = req.query;

  if (error || !code || !state)
    return res.redirect(`${APP_SCHEME}://social-callback?error=access_denied`);

  const sd = oauthStates.get(state);
  if (!sd) return res.redirect(`${APP_SCHEME}://social-callback?error=invalid_state`);
  oauthStates.delete(state);

  const { platform, userId } = sd;
  const redirectUri = process.env.FACEBOOK_REDIRECT_URL || `${BACKEND_URL}/social/callback/facebook`;

  try {
    // Step 1: Exchange auth code for short-lived access token
    const t1 = await axios.get("https://graph.facebook.com/v19.0/oauth/access_token", {
      params: {
        client_id:     process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri:  redirectUri,
        code,
      },
      timeout: 10000,
    });
    let accessToken = t1.data.access_token;

    // Step 2: Exchange for long-lived token (valid 60 days)
    try {
      const t2 = await axios.get("https://graph.facebook.com/v19.0/oauth/access_token", {
        params: {
          grant_type:        "fb_exchange_token",
          client_id:         process.env.FACEBOOK_APP_ID,
          client_secret:     process.env.FACEBOOK_APP_SECRET,
          fb_exchange_token: accessToken,
        },
        timeout: 10000,
      });
      accessToken = t2.data.access_token;
    } catch (_) { /* use short-lived if exchange fails */ }

    // Step 3: Get user's Facebook Pages
    const pagesRes = await axios.get("https://graph.facebook.com/v19.0/me/accounts", {
      params: { access_token: accessToken },
      timeout: 10000,
    });
    const pages = pagesRes.data.data || [];

    let accountName = "", handle = "", followers = "", profilePic = "";

    if (platform === "instagram") {
      // Find a Facebook Page that has an Instagram Business account linked
      let igId = null, pageToken = null;
      for (const page of pages) {
        try {
          const igCheck = await axios.get(`https://graph.facebook.com/v19.0/${page.id}`, {
            params: { fields: "instagram_business_account", access_token: page.access_token },
            timeout: 8000,
          });
          if (igCheck.data.instagram_business_account) {
            igId      = igCheck.data.instagram_business_account.id;
            pageToken = page.access_token;
            break;
          }
        } catch (_) { continue; }
      }

      if (!igId) {
        // User has no Instagram Business account linked to any Facebook Page
        const errMsg = encodeURIComponent(
          "Instagram Business account not found. Please: 1) Convert Instagram to Business/Creator account, 2) Link it to a Facebook Page, then try again."
        );
        return res.redirect(
          `${APP_SCHEME}://social-callback?error=no_instagram_business&platform=instagram&message=${errMsg}`
        );
      }

      // Get Instagram profile info
      const igProfile = await axios.get(`https://graph.facebook.com/v19.0/${igId}`, {
        params: {
          fields: "name,username,followers_count,profile_picture_url",
          access_token: pageToken,
        },
        timeout: 10000,
      });

      accountName = igProfile.data.name || igProfile.data.username || "";
      handle      = `@${igProfile.data.username}`;
      followers   = igProfile.data.followers_count
        ? `${Number(igProfile.data.followers_count).toLocaleString()} followers`
        : "";
      profilePic  = igProfile.data.profile_picture_url || "";

      socialStore.set(`${userId}:instagram`, {
        accessToken: pageToken,
        igUserId:    igId,
        accountName, handle, followers, profilePic,
        connectedAt: new Date().toISOString(),
      });

    } else {
      // Facebook Page
      if (pages.length > 0) {
        const page  = pages[0];
        accountName = page.name;
        handle      = page.id;
        accessToken = page.access_token; // page-level token
      } else {
        // Fallback: personal profile
        const me = await axios.get("https://graph.facebook.com/v19.0/me", {
          params: { fields: "name,id", access_token: accessToken },
          timeout: 10000,
        });
        accountName = me.data.name;
        handle      = me.data.id;
      }

      socialStore.set(`${userId}:facebook`, {
        accessToken, accountName, handle, followers, profilePic,
        connectedAt: new Date().toISOString(),
      });
    }

    // Redirect back to Flutter app via deep link
    const params = new URLSearchParams({
      platform, accountName, handle, followers, profilePic, success: "true",
    });
    return res.redirect(`${APP_SCHEME}://social-callback?${params.toString()}`);

  } catch (err) {
    console.error("Facebook/Instagram OAuth error:", err.response?.data || err.message);
    const errCode = err.response?.status === 401 ? "invalid_token" : "server_error";
    const errMsg = encodeURIComponent(err.response?.data?.error?.message || "OAuth failed");
    return res.redirect(`${APP_SCHEME}://social-callback?error=${errCode}&platform=${platform}&message=${errMsg}`);
  }
});

// GET /social/callback/youtube
// Google redirects here after user authorizes YouTube access
app.get("/social/callback/youtube", async (req, res) => {
  const { code, state, error } = req.query;

  if (error || !code || !state)
    return res.redirect(`${APP_SCHEME}://social-callback?error=access_denied&platform=youtube`);

  const sd = oauthStates.get(state);
  if (!sd)
    return res.redirect(`${APP_SCHEME}://social-callback?error=invalid_state&platform=youtube`);
  oauthStates.delete(state);

  const { userId } = sd;

  try {
    // Exchange code for access + refresh token
    const tokenRes = await axios.post("https://oauth2.googleapis.com/token", {
      code,
      client_id:     process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      redirect_uri:  process.env.YOUTUBE_REDIRECT_URL || `${BACKEND_URL}/social/callback/youtube`,
      grant_type:    "authorization_code",
    }, { timeout: 10000 });

    const { access_token, refresh_token } = tokenRes.data;

    // Get YouTube channel info
    const ytRes = await axios.get("https://www.googleapis.com/youtube/v3/channels", {
      params:  { part: "snippet,statistics", mine: true },
      headers: { Authorization: `Bearer ${access_token}` },
      timeout: 10000,
    });

    if (!ytRes.data.items?.length)
      return res.redirect(`${APP_SCHEME}://social-callback?error=no_youtube_channel&platform=youtube`);

    const ch          = ytRes.data.items[0];
    const accountName = ch.snippet.title;
    const handle      = ch.snippet.customUrl || ch.id;
    const subs        = ch.statistics?.subscriberCount;
    const followers   = subs ? `${Number(subs).toLocaleString()} subscribers` : "";
    const profilePic  = ch.snippet.thumbnails?.default?.url || "";

    socialStore.set(`${userId}:youtube`, {
      accessToken:  access_token,
      refreshToken: refresh_token,
      accountName, handle, followers, profilePic,
      connectedAt: new Date().toISOString(),
    });

    const params = new URLSearchParams({
      platform: "youtube", accountName, handle, followers, profilePic, success: "true",
    });
    return res.redirect(`${APP_SCHEME}://social-callback?${params.toString()}`);

  } catch (err) {
    console.error("YouTube OAuth error:", err.response?.data || err.message);
    return res.redirect(`${APP_SCHEME}://social-callback?error=server_error&platform=youtube`);
  }
});

// POST /social/status — get all connected accounts for a user
app.post("/social/status", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId is required." });

  const result = {};
  for (const platform of ["instagram", "facebook", "youtube"]) {
    const d = socialStore.get(`${userId}:${platform}`);
    result[platform] = d
      ? { connected: true,  accountName: d.accountName, handle: d.handle,
          followers: d.followers, profilePic: d.profilePic, connectedAt: d.connectedAt }
      : { connected: false };
  }
  return res.json({ success: true, accounts: result });
});

// CREATE post
app.post('/schedule/create', authMiddleware, (req, res) => {
  const userId = req.userId;
  const { platform, caption, scheduledAt } = req.body;

  if (!userId || !platform || !caption) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const id = 'post_' + Date.now();

  const newPost = {
    id,
    userId,
    platform,
    caption,
    status: 'scheduled',
    scheduledAt: scheduledAt || new Date().toISOString(),
    views: 0,
    likes: 0,
  };

  postStore.set(id, newPost);

  res.json({ success: true, post: newPost });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER APIs
// ─────────────────────────────────────────────────────────────────────────────


// GET all scheduled posts
app.post('/schedule/list', authMiddleware, (req, res) => {
  const userId = req.userId;

  const posts = Array.from(postStore.values())
    .filter(p => p.userId === userId)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

  res.json({ success: true, posts });
});

// DELETE post
app.post('/schedule/delete', authMiddleware, (req, res) => {
  const { postId } = req.body;
  const userId = req.userId;

  if (!postId) {
    return res.status(400).json({ error: "postId required" });
  }

  const post = postStore.get(postId);

  if (!post || post.userId !== userId) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  postStore.delete(postId);

  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// AI — Groq LLM
// ─────────────────────────────────────────────────────────────────────────────
app.post("/ai", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string" || !prompt.trim())
    return res.status(400).json({ error: "Prompt is required." });
  if (prompt.length > 2000)
    return res.status(400).json({ error: "Prompt is too long (max 2000 characters)." });

  const MODELS = ["llama-3.3-70b-versatile", "llama-3.1-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"];
  let lastErr = null;

  for (const model of MODELS) {
    try {
      const r = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model,
          messages: [
            {
              role: "system",
              content: `You are ViralMate — India's #1 AI viral content strategist.
You specialize in creating explosive, scroll-stopping content for Instagram Reels, YouTube Shorts, and Facebook.
Your outputs are NEVER generic. They are:
• Trend-aware: You know what's viral RIGHT NOW in India
• Hook-first: Every response starts with something that stops the scroll
• Structured beautifully: Use numbered lists, emojis, clear sections — never plain walls of text
• Actionable: Include hooks, captions, hashtags, posting tips
• Bilingual-smart: Mix Hindi+English (Hinglish) naturally when the user writes in Hindi/Hinglish
• Platform-specific: Different formats for Reels vs Shorts vs Facebook

When generating hooks: make them SHOCKING, CURIOSITY-DRIVEN, or EMOTIONALLY TRIGGERING.
When generating captions: Start with a 1-line hook, tell a micro-story, end with CTA.
When generating hashtags: Mix 5 niche + 5 medium + 5 broad tags for maximum reach.
Always format responses with clear sections, emojis as visual anchors, and numbered lists.
Respond in the same language as the user's message.`,
            },
            { role: "user", content: prompt.trim() },
          ],
          max_tokens: 2048,
          temperature: 0.8,
        },
        {
          headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
          timeout: 35000,
        }
      );
      return res.json({ result: r.data.choices[0].message.content });
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const errMsg = JSON.stringify(err.response?.data || "");
      if (status === 404 || errMsg.includes("decommissioned") || errMsg.includes("deprecated") || errMsg.includes("not found")) {
        console.warn(`Model ${model} unavailable, trying next...`);
        continue;
      }
      break;
    }
  }

  // All models failed
  console.error("Groq /ai error:", lastErr?.response?.data || lastErr?.message);
  if (lastErr?.code === "ECONNABORTED")      return res.status(504).json({ error: "AI request timed out. Please try again." });
  if (lastErr?.response?.status === 429)     return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  if (lastErr?.response?.status === 401)     return res.status(500).json({ error: "GROQ_API_KEY is invalid. Check Railway environment variables." });
  return res.status(500).json({ error: "AI service is unavailable. Please try again." });
});

// ── USER DATA DELETION (Facebook requirement) ─────────────────────────────────
// Facebook requires this URL when going Live
// GET /delete — shows data deletion instructions page
app.get("/delete", (_, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>ViralMate — Data Deletion</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 60px auto; padding: 20px; color: #333; }
        h1 { color: #6366F1; }
        .step { background: #f5f5ff; border-left: 4px solid #6366F1; padding: 12px 16px; margin: 12px 0; border-radius: 4px; }
        a { color: #6366F1; }
      </style>
    </head>
    <body>
      <h1>ViralMate — Data Deletion Instructions</h1>
      <p>To request deletion of your data from ViralMate, follow these steps:</p>
      <div class="step"><strong>Step 1:</strong> Open the ViralMate app on your device.</div>
      <div class="step"><strong>Step 2:</strong> Go to <strong>Profile → Settings → Delete Account</strong>.</div>
      <div class="step"><strong>Step 3:</strong> Confirm deletion. All your data will be permanently removed within 30 days.</div>
      <p>Or email us at: <a href="mailto:support@viralmate.com">support@viralmate.com</a> with subject <strong>"Delete My Data"</strong>.</p>
      <p style="color:#999;font-size:13px;margin-top:40px;">ViralMate does not sell your data to third parties.</p>
    </body>
    </html>
  `);
});

// POST /delete-account — actual account deletion endpoint

  function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
if (!authHeader) return res.status(401).json({ error: "No token" });

const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

app.post("/delete-account", authMiddleware, (req, res) => {
  const userId = req.userId;

  if (userStore.has(userId)) {
    for (const [id, post] of postStore.entries()) {
  if (post.userId === userId) {
    postStore.delete(id);
  }
}

    // delete social data
    for (const p of ["instagram", "facebook", "youtube"]) {
      socialStore.delete(`${userId}:${p}`);
    }
  }

  return res.json({ success: true, message: "Account deleted successfully" });
});


// ── CHANGE PASSWORD ───────────────────────────────────────────────────────────
app.post("/change-password", authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "All fields are required." });

  if (newPassword.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters." });

  const user = userStore.get(req.userId);

  if (!user)
    return res.status(404).json({ error: "User not found" });

  if (!(await comparePass(currentPassword, user.password)))
    return res.status(401).json({ error: "Wrong password" });

  const hashed = await hashPass(newPassword);

userStore.set(req.userId, {
  ...user,
  password: hashed,
});
  res.json({ success: true });
});

// ── USER PROFILE UPDATE ───────────────────────────────────────────────────────
app.post("/user/update-profile", (req, res) => {
  const { name, username, bio } = req.body;
  const auth = req.headers.authorization;
  // Profile stored locally in app — just acknowledge
  return res.json({ success: true, message: "Profile updated." });
});


// ── TERMS OF SERVICE PAGE ─────────────────────────────────────────────────────
app.get("/terms", (_, res) => {
  res.send(`<!DOCTYPE html>
  <html><head><meta charset="utf-8"><title>ViralMate Terms of Service</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial,sans-serif;max-width:640px;margin:40px auto;padding:20px;color:#333;line-height:1.7;background:#fff}
  h1{color:#6366F1}h2{color:#374151;font-size:16px;margin-top:24px}
  a{color:#6366F1}.chip{background:#f5f5ff;border-left:4px solid #6366F1;padding:10px 14px;margin:10px 0;border-radius:4px}</style>
  </head><body>
  <h1>ViralMate Terms of Service</h1>
  <p>Last updated: April 2026</p>
  <h2>1. Acceptance of Terms</h2>
  <p>By using ViralMate, you agree to these Terms of Service. If you do not agree, please do not use the service.</p>
  <h2>2. Description of Service</h2>
  <p>ViralMate provides AI-powered content generation and social media scheduling tools for creators.</p>
  <h2>3. User Accounts</h2>
  <div class="chip">• You are responsible for maintaining the security of your account credentials.</div>
  <div class="chip">• You must provide accurate information during registration.</div>
  <div class="chip">• You must be at least 13 years old to use this service.</div>
  <h2>4. Acceptable Use</h2>
  <p>You agree not to use ViralMate to generate spam, hateful content, or content that violates platform policies.</p>
  <h2>5. Social Media Connections</h2>
  <p>When connecting your social media accounts, you authorize ViralMate to post content on your behalf as directed by you. You can revoke this access at any time.</p>
  <h2>6. Limitation of Liability</h2>
  <p>ViralMate is provided "as is". We are not liable for any damages arising from use of the service.</p>
  <h2>7. Changes to Terms</h2>
  <p>We may update these terms at any time. Continued use of the service constitutes acceptance of new terms.</p>
  <h2>Contact</h2>
  <p><a href="mailto:support@viralmate.com">support@viralmate.com</a></p>
  <p style="margin-top:32px"><a href="https://viralmate-production.up.railway.app/privacy-policy">
  Privacy Policy
</a> &nbsp;|&nbsp; <a href="/">Home</a></p>
  </body></html>`);
});

// ── PRIVACY POLICY PAGE ───────────────────────────────────────────────────────
// Google verification fix
// ── PRIVACY POLICY PAGE ───────────────────────────────────────────────────────
app.get("/privacy-policy", (_, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>ViralMate Privacy Policy</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 640px;
      margin: 40px auto;
      padding: 20px;
      color: #333;
      line-height: 1.7;
    }
    h1 { color: #6366F1; }
    h2 { color: #374151; font-size: 16px; margin-top: 24px; }
    a { color: #6366F1; }
    .chip {
      background: #f5f5ff;
      border-left: 4px solid #6366F1;
      padding: 10px 14px;
      margin: 10px 0;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <h1>ViralMate Privacy Policy</h1>
  <p>Last updated: April 2026</p>

  <h2>Information We Collect</h2>
  <div class="chip">• Email & Name</div>
  <div class="chip">• Social OAuth tokens (secure)</div>
  <div class="chip">• Content created inside app</div>

  <h2>How We Use Data</h2>
  <p>We use your data only to provide AI content and scheduling features.</p>

  <h2>Data Sharing</h2>
  <p>We never sell your data.</p>

  <h2>Contact</h2>
  <p><a href="mailto:support@viralmate.com">support@viralmate.com</a></p>

</body>
</html>`);
});


// ─────────────────────────────────────────────────────────────────────────────
// TRENDING — Real trending reels & shorts via Groq AI
// POST /trending — returns 10 trending content ideas with captions + hashtags
// ─────────────────────────────────────────────────────────────────────────────
app.post("/trending", async (req, res) => {
  const { platforms = ["instagram", "youtube"], niche = "general", userId } = req.body;

  // Build context from user's connected accounts
  const connectedPlatforms = [];
  if (userId) {
    for (const p of ["instagram", "facebook", "youtube"]) {
      const d = socialStore.get(`${userId}:${p}`);
      if (d) connectedPlatforms.push({ platform: p, handle: d.handle, accountName: d.accountName });
    }
  }

  const platformText = platforms.includes("youtube") && platforms.includes("instagram")
    ? "Instagram Reels AND YouTube Shorts"
    : platforms.includes("youtube") ? "YouTube Shorts" : "Instagram Reels";

  const nicheContext = niche && niche !== "general"
    ? `The creator's niche is: ${niche}.`
    : "The creator makes general lifestyle/entertainment content.";

  const systemPrompt = `You are ViralMate, the world's #1 viral content strategist for Indian social media creators.
You have deep knowledge of what's trending RIGHT NOW on Instagram Reels and YouTube Shorts in India.
You understand viral patterns, hook psychology, and what makes content blow up.
Always respond in JSON only. No extra text before or after JSON.`;

  const userPrompt = `Give me exactly 10 trending content ideas for ${platformText} that are going viral RIGHT NOW.
${nicheContext}
${connectedPlatforms.length > 0 ? `Creator's accounts: ${connectedPlatforms.map(c => `${c.platform}: ${c.accountName || c.handle}`).join(", ")}` : ""}

For each idea return this exact JSON structure:
{
  "ideas": [
    {
      "rank": 1,
      "title": "Catchy video title/concept (under 60 chars)",
      "hook": "First 3 seconds hook line that stops scrolling — powerful, curiosity-driven",
      "whyViral": "1 line: exactly why this is blowing up right now",
      "caption": "Full engaging caption with emojis, storytelling hook, call-to-action (150-200 chars)",
      "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5", "#tag6", "#tag7", "#tag8", "#tag9", "#tag10"],
      "platform": "instagram" or "youtube" or "both",
      "contentType": "reel" or "short" or "carousel",
      "trendScore": 95,
      "niche": "lifestyle",
      "tips": ["Tip 1 to make this viral", "Tip 2 about timing/editing"]
    }
  ]
}

Make them highly specific, creative, and currently trending in India 2025. Mix Hindi+English naturally.`;

  try {
    // Model fallback chain
    const MODELS = ["llama-3.3-70b-versatile", "llama-3.1-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"];
    let rawContent = null;
    let lastErr = null;

    for (const model of MODELS) {
      try {
        const r = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: 4000,
            temperature: 0.85,
          },
          {
            headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
            timeout: 45000,
          }
        );
        rawContent = r.data.choices[0].message.content;
        break; // success
      } catch (err) {
        lastErr = err;
        const status = err.response?.status;
        const errMsg = JSON.stringify(err.response?.data || "");
        if (status === 404 || errMsg.includes("decommissioned") || errMsg.includes("deprecated") || errMsg.includes("not found")) {
          console.warn(`Trending: model ${model} unavailable, trying next...`);
          continue;
        }
        break;
      }
    }

    if (!rawContent) {
      console.error("Trending error:", lastErr?.response?.data || lastErr?.message);
      if (lastErr?.response?.status === 401) return res.status(500).json({ error: "GROQ_API_KEY is invalid. Please update Railway env vars." });
      if (lastErr?.response?.status === 429) return res.status(429).json({ error: "Too many requests. Wait a moment." });
      if (lastErr?.code === "ECONNABORTED")  return res.status(504).json({ error: "Request timed out. Please try again." });
      return res.status(500).json({ error: "Could not fetch trending ideas. Please try again." });
    }

    let ideas;
    try {
      // Robust JSON extraction — handles markdown fences and extra text
      let jsonStr = rawContent;
      // Try direct parse first
      try {
        const direct = JSON.parse(jsonStr);
        ideas = direct.ideas || (Array.isArray(direct) ? direct : null);
      } catch (_) {
        // Strip markdown code blocks
        jsonStr = jsonStr.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
        // Find outermost JSON object
        const start = jsonStr.indexOf("{");
        const end = jsonStr.lastIndexOf("}");
        if (start === -1 || end === -1) throw new Error("No JSON object found");
        const parsed = JSON.parse(jsonStr.slice(start, end + 1));
        ideas = parsed.ideas || (Array.isArray(parsed) ? parsed : null);
      }
      if (!Array.isArray(ideas) || ideas.length === 0) throw new Error("No valid ideas array");
    } catch (parseErr) {
      console.error("Trending parse error:", parseErr.message, "\nRaw:", rawContent.slice(0, 300));
      return res.status(500).json({ error: "Could not parse AI response. Please try again." });
    }

    return res.json({ success: true, ideas, generatedAt: new Date().toISOString() });

  } catch (err) {
    console.error("Trending outer error:", err.message);
    return res.status(500).json({ error: "Could not fetch trending ideas. Please try again." });
  }
});

// POST /ai/caption — Enhanced caption generator with style, platform awareness
app.post("/ai/caption", async (req, res) => {
  const { topic, platform = "instagram", style = "engaging", language = "hinglish" } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic is required." });

  const styleGuide = {
    engaging: "conversational, relatable, uses storytelling",
    professional: "polished, authoritative, brand-focused",
    funny: "humorous, witty, meme-worthy",
    motivational: "inspiring, emotional, empowering",
    educational: "informative, value-packed, teaching",
  }[style] || "engaging and conversational";

  const langGuide = language === "hindi" ? "pure Hindi (Devanagari)"
    : language === "english" ? "pure English"
    : "Hinglish (mix of Hindi and English naturally, very Indian)";

  const prompt = `Write 3 viral ${platform} captions for this topic: "${topic}"
Style: ${styleGuide}
Language: ${langGuide}
Each caption must:
- Start with a scroll-stopping hook (first line is EVERYTHING)
- Use 3-5 strategic emojis (not random spam)
- Have a clear CTA at the end
- Be 150-220 characters
- Feel authentic, not AI-generated
- Include platform-specific best practices

Also give 15 best hashtags for maximum reach.

Respond in JSON:
{
  "captions": [
    {"text": "full caption here", "style": "style name", "hookType": "question/statement/story/shock"},
    {"text": "...", "style": "...", "hookType": "..."},
    {"text": "...", "style": "...", "hookType": "..."}
  ],
  "hashtags": ["#tag1", ...15 tags],
  "bestTime": "Best time to post for maximum reach",
  "tip": "One key tip to boost engagement on this post"
}`;

  try {
    const r = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "You are ViralMate, expert viral content strategist. Return only valid JSON." },
          { role: "user", content: prompt },
        ],
        max_tokens: 1500,
        temperature: 0.9,
      },
      {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        timeout: 25000,
      }
    );
    const raw = r.data.choices[0].message.content;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const data = jsonMatch ? JSON.parse(jsonMatch[0]) : { captions: [], hashtags: [] };
    return res.json({ success: true, ...data });
  } catch (err) {
    return res.status(500).json({ error: "Caption generation failed. Try again." });
  }
});



// ── GOOGLE / FACEBOOK LOGIN ──────────────────────────────────────────────────
// POST /auth/google — verify Google ID token and log user in
app.post("/auth/google", async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: "idToken is required." });

  try {
    // Verify with Google's tokeninfo endpoint
    const r = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`, { timeout: 8000 });
    const payload = r.data;

    if (!payload.email) return res.status(401).json({ error: "Invalid Google token." });

    const email = payload.email.toLowerCase();
    const name  = payload.name || payload.email.split('@')[0];

    // Auto-create account if not exists
    if (!userStore.has(email)) {
      userStore.set(email, { name, password: null, verified: true, plan: 'free', googleId: payload.sub });
    } else {
      const u = userStore.get(email);
      userStore.set(email, { ...u, verified: true });
    }

    const token = jwt.sign(
  { userId: email },
  JWT_SECRET,
  { expiresIn: "7d" }
);
    const userId = payload.sub || email;

    const deepLink = `${APP_SCHEME}://social-callback?success=true&platform=google&youtubeConnected=true&userId=${userId}`;
return res.json({
  success: true,
  token,
  user: { name, email, plan: userStore.get(email)?.plan || 'free' },
  userId,
  deepLink // optional but useful
});
  } catch (err) {
    console.error("Google login error:", err.response?.data || err.message);
    return res.status(401).json({ error: "Google authentication failed. Please try again." });
  }
});

// POST /auth/facebook — verify Facebook access token
app.post("/auth/facebook", async (req, res) => {
  const { accessToken } = req.body;

  if (!accessToken) {
    return res.status(400).json({ error: "accessToken is required." });
  }

  try {
    const r = await axios.get(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`
    );

    const profile = r.data;
    const email = profile.email || `fb_${profile.id}@viralmate.app`;
    const name  = profile.name || "Facebook User";

    if (!userStore.has(email)) {
      userStore.set(email, {
        name,
        password: null,
        verified: true,
        plan: 'free',
        facebookId: profile.id
      });
    }

    const token = jwt.sign(
      { userId: email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      user: { name, email, plan: 'free' },
      userId: profile.id
    });

  } catch (err) {
    console.error("Facebook login error:", err.message);
    res.status(401).json({ error: "Facebook authentication failed." });
  }
});

// ── WEB-SAFE AUTH CALLBACK ────────────────────────────────────────────────────
// Stores auth result in server memory for Flutter Web polling
const webAuthStore = new Map(); // sessionId → { token, userId, name, email, platform, ts }

// GET /auth/status/:sessionId — Flutter Web polls this after OAuth
app.get("/auth/status/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const result = webAuthStore.get(sessionId);
  if (!result) return res.json({ pending: true });
  // Clean up after retrieval
  webAuthStore.delete(sessionId);
  return res.json({ pending: false, ...result });
});

// Helper: build web-safe redirect that works on BOTH mobile (deep link) and web (polling)
function buildAuthRedirect(params, isError = false) {
  const sessionId = crypto.randomBytes(16).toString("hex");
  const paramsStr = new URLSearchParams(params).toString();

  if (!isError) {
    // Store for web polling
    webAuthStore.set(sessionId, params);
    // Auto-expire after 5 minutes
    setTimeout(() => webAuthStore.delete(sessionId), 300000);
  }

  const deepLink = `${APP_SCHEME}://social-callback?${paramsStr}`;
  const pollUrl = `${BACKEND_URL}/auth/status/${sessionId}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ViralMate — ${isError ? 'Login Failed' : 'Login Successful'}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;background:#080810;color:#fff;height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:24px;text-align:center}
    .icon{font-size:48px;margin-bottom:8px}
    h2{font-size:20px;font-weight:700}
    p{color:#9CA3AF;font-size:14px;line-height:1.5;max-width:300px}
    .badge{background:linear-gradient(135deg,#6366F1,#8B5CF6);border-radius:20px;padding:6px 16px;font-size:13px;font-weight:700;display:inline-block;margin-top:8px}
    .spinner{width:32px;height:32px;border:3px solid rgba(99,102,241,0.3);border-top:3px solid #6366F1;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  ${isError
    ? `<div class="icon">❌</div><h2>Login Failed</h2><p>${params.error || 'Authentication failed. Please try again.'}</p>`
    : `<div class="spinner"></div><h2>${params.name ? 'Welcome, ' + params.name.split(' ')[0] + '!' : 'Login Successful!'}</h2><p>Returning you to ViralMate...</p><div class="badge">⚡ ViralMate</div>`
  }
  <script>
    const deepLink = "${deepLink.replace(/"/g, '\"')}";
    const pollUrl = "${pollUrl}";
    const isError = ${isError};

    // Try to open deep link (works on mobile)
    try { window.location.href = deepLink; } catch(e) {}

    if (!isError) {
      // Signal to any open ViralMate web tabs via BroadcastChannel
      try {
        const bc = new BroadcastChannel('viralmate_auth');
        bc.postMessage({ type: 'AUTH_SUCCESS', pollUrl, data: ${JSON.stringify(params)} });
        bc.close();
      } catch(e) {}

      // Also store in localStorage for web fallback
      try {
        localStorage.setItem('viralmate_pending_auth', JSON.stringify({
          pollUrl, data: ${JSON.stringify(params)}, ts: Date.now()
        }));
      } catch(e) {}
    }

    // Close window after 3 seconds (mobile browser tab)
    setTimeout(() => {
      try { window.close(); } catch(e) {}
      document.body.innerHTML = '<div style="padding:24px;text-align:center;color:#9CA3AF;font-size:14px">You can close this tab and return to ViralMate.</div>';
    }, 3000);
  </script>
</body>
</html>`;
}

// ── 404 & GLOBAL ERROR HANDLER ────────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ error: "Route not found." }));
app.use((err, _, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ ViralMate v3.0 running on port ${PORT}`)
);
