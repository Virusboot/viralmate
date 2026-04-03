import express from "express";
import cors    from "cors";
import axios   from "axios";
import crypto  from "crypto";
import { Resend } from "resend";

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

// ── HELPERS ───────────────────────────────────────────────────────────────────
const hashPass = p =>
  crypto.createHash("sha256")
    .update(p + (process.env.PASSWORD_SALT || "viralmate_2024"))
    .digest("hex");

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
  await resend.emails.send({
    from: "ViralMate <onboarding@resend.dev>",
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

// ── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/", (_, res) =>
  res.json({ status: "ok", message: "ViralMate Backend 🚀", version: "3.0" })
);

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
    password: hashPass(password),
    verified: false,
    plan: "free",
  });

  const otp = genOtp();
  otpStore.set(`${key}:verify`, { otp, expiresAt: Date.now() + 600000 });

  try {
    await sendOtp(key, otp, "verify");
    return res.json({ success: true, message: "OTP sent. Please check your email." });
  } catch (err) {
    console.error("Email error:", err.message);
    return res.status(500).json({ error: "Could not send verification email. Please try again." });
  }
});

// POST /login
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required." });

  const key  = email.trim().toLowerCase();
  if (!validEmail(key))
    return res.status(400).json({ error: "Please enter a valid email address." });

  const user = userStore.get(key);
  if (!user || user.password !== hashPass(password))
    return res.status(401).json({ error: "Incorrect email or password." });
  if (!user.verified)
    return res.status(403).json({ error: "Please verify your email before signing in." });

  const token = crypto.randomBytes(32).toString("hex");
  return res.json({
    success: true,
    token,
    user: { name: user.name, email: key, plan: user.plan || "free" },
  });
});

// POST /verify-otp
app.post("/verify-otp", (req, res) => {
  const { email, otp, purpose } = req.body;
  if (!email || !otp || !purpose)
    return res.status(400).json({ error: "Email, OTP, and purpose are required." });

  const key = email.trim().toLowerCase();
  const sk  = `${key}:${purpose}`;
  const rec = otpStore.get(sk);

  if (!rec)
    return res.status(400).json({ error: "OTP expired or invalid. Please request a new one." });
  if (Date.now() > rec.expiresAt) {
    otpStore.delete(sk);
    return res.status(400).json({ error: "OTP has expired. Please request a new one." });
  }
  if (rec.otp !== String(otp).trim())
    return res.status(400).json({ error: "Invalid OTP. Please try again." });

  if (purpose === "verify") {
    const u = userStore.get(key);
    if (u) userStore.set(key, { ...u, verified: true });
    otpStore.delete(sk);
    return res.json({ success: true, message: "Email verified successfully!" });
  }
  if (purpose === "reset") {
    otpStore.set(sk, { ...rec, verified: true });
    return res.json({ success: true, message: "OTP verified. You can now set a new password." });
  }
  return res.status(400).json({ error: "Invalid purpose." });
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

  userStore.set(key, { ...user, password: hashPass(newPassword) });
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
      });
    }
    const redirectUri = encodeURIComponent(process.env.FACEBOOK_REDIRECT_URL || `${BACKEND_URL}/social/callback/facebook`);
    const scope = platform === "instagram"
      ? "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement"
      : "pages_manage_posts,pages_read_engagement,pages_show_list";
    authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${process.env.FACEBOOK_APP_ID}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}&response_type=code`;

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
        return res.redirect(
          `${APP_SCHEME}://social-callback?error=no_instagram_business&platform=instagram`
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
    return res.redirect(`${APP_SCHEME}://social-callback?error=${errCode}&platform=${platform}`);
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

// POST /social/disconnect — disconnect a platform
app.post("/social/disconnect", (req, res) => {
  const { platform, userId } = req.body;
  if (!platform || !userId)
    return res.status(400).json({ error: "Platform and userId are required." });
  socialStore.delete(`${userId}:${platform}`);
  return res.json({ success: true });
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

  try {
    const r = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
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
        max_tokens:  1024,
        temperature: 0.8,
      },
      {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        timeout: 30000,
      }
    );
    return res.json({ result: r.data.choices[0].message.content });

  } catch (err) {
    console.error("Groq error:", err.response?.data || err.message);
    if (err.code === "ECONNABORTED")     return res.status(504).json({ error: "AI request timed out. Please try again." });
    if (err.response?.status === 429)   return res.status(429).json({ error: "Too many requests. Please wait a moment." });
    if (err.response?.status === 401)   return res.status(500).json({ error: "AI authentication failed." });
    return res.status(500).json({ error: "AI service is unavailable. Please try again." });
  }
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
app.post("/delete-account", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required." });
  const key = email.trim().toLowerCase();
  if (userStore.has(key)) {
    userStore.delete(key);
    // Delete all social connections
    for (const p of ["instagram", "facebook", "youtube"]) {
      socialStore.delete(`${key}:${p}`);
    }
  }
  return res.json({ success: true, message: "Account and all data deleted successfully." });
});


// ── CHANGE PASSWORD ───────────────────────────────────────────────────────────
app.post("/change-password", (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "Both fields are required." });
  if (newPassword.length < 6)
    return res.status(400).json({ error: "New password must be at least 6 characters." });

  // Find user by token from Authorization header
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Not authenticated." });

  // Verify current password — find user who matches this password
  const hashedCurrent = hashPass(currentPassword);
  let foundEmail = null;
  for (const [email, user] of userStore.entries()) {
    if (user.password === hashedCurrent) { foundEmail = email; break; }
  }
  if (!foundEmail) return res.status(401).json({ error: "Current password is incorrect." });

  const user = userStore.get(foundEmail);
  userStore.set(foundEmail, { ...user, password: hashPass(newPassword) });
  return res.json({ success: true, message: "Password updated successfully." });
});

// ── USER PROFILE UPDATE ───────────────────────────────────────────────────────
app.post("/user/update-profile", (req, res) => {
  const { name, username, bio } = req.body;
  const auth = req.headers.authorization;
  // Profile stored locally in app — just acknowledge
  return res.json({ success: true, message: "Profile updated." });
});

// ── PRIVACY POLICY PAGE ───────────────────────────────────────────────────────
app.get("/privacy", (_, res) => {
  res.send(`<!DOCTYPE html>
  <html><head><meta charset="utf-8"><title>ViralMate Privacy Policy</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial,sans-serif;max-width:640px;margin:40px auto;padding:20px;color:#333;line-height:1.7}
  h1{color:#6366F1}h2{color:#374151;font-size:16px;margin-top:24px}
  a{color:#6366F1}.chip{background:#f5f5ff;border-left:4px solid #6366F1;padding:10px 14px;margin:10px 0;border-radius:4px}</style>
  </head><body>
  <h1>ViralMate Privacy Policy</h1>
  <p>Last updated: April 2026</p>
  <h2>Information We Collect</h2>
  <div class="chip">• Account information (email, name)</div>
  <div class="chip">• Social media access tokens (OAuth — stored securely, never your password)</div>
  <div class="chip">• Content you create and schedule within the app</div>
  <h2>How We Use Your Data</h2>
  <p>We use your data solely to provide the ViralMate service — AI content generation and social media scheduling.</p>
  <h2>Data Sharing</h2>
  <p>We <strong>never</strong> sell your data to third parties. Social connections use official OAuth flows.</p>
  <h2>Data Deletion</h2>
  <p>You can delete your account and all data at any time via Profile → Settings → Delete Account, or by emailing <a href="mailto:support@viralmate.com">support@viralmate.com</a>.</p>
  <h2>Contact</h2>
  <p><a href="mailto:support@viralmate.com">support@viralmate.com</a></p>
  </body></html>`);
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
    const r = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 3000,
        temperature: 0.85,
        response_format: { type: "json_object" },
      },
      {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        timeout: 40000,
      }
    );

    let ideas;
    try {
      const raw = r.data.choices[0].message.content;
      const parsed = JSON.parse(raw);
      ideas = parsed.ideas || parsed;
    } catch (_) {
      return res.status(500).json({ error: "Could not parse AI response. Try again." });
    }

    return res.json({ success: true, ideas, generatedAt: new Date().toISOString() });

  } catch (err) {
    console.error("Trending error:", err.response?.data || err.message);
    if (err.code === "ECONNABORTED")   return res.status(504).json({ error: "Request timed out. Please try again." });
    if (err.response?.status === 429) return res.status(429).json({ error: "Too many requests. Wait a moment." });
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
        response_format: { type: "json_object" },
      },
      {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        timeout: 25000,
      }
    );
    const data = JSON.parse(r.data.choices[0].message.content);
    return res.json({ success: true, ...data });
  } catch (err) {
    return res.status(500).json({ error: "Caption generation failed. Try again." });
  }
});


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
