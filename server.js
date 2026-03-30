import express from "express";
import cors from "cors";
import axios from "axios";
import crypto from "crypto";
const { Resend } = require("resend");

// ─── ENV CHECK ─────────────────────────
const REQUIRED_ENV = ["GROQ_API_KEY", "RESEND_API_KEY"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ ${key} is not set. Exiting.`);
    process.exit(1);
  }
}

// ─── INIT ──────────────────────────────
const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors());
app.use(express.json());

// ─── STORAGE ───────────────────────────
const otpStore = new Map();
const userStore = new Map();

// ─── HELPERS ───────────────────────────
function hashPassword(plain) {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── EMAIL (RESEND) ────────────────────
async function sendOtpEmail(email, otp, purpose) {
  try {
    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: email,
      subject:
        purpose === "reset"
          ? "Password Reset OTP"
          : "Verify Your Email OTP",
      html: `<h2>Your OTP is: ${otp}</h2>`,
    });
    console.log("OTP sent");
  } catch (err) {
    console.error("Email error:", err);
    throw new Error("Email failed");
  }
}

// ─── ROUTES ────────────────────────────

// Health
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// Register
app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!email || !password || !name)
    return res.status(400).json({ error: "All fields required" });

  const key = email.toLowerCase();

  userStore.set(key, {
    name,
    password: hashPassword(password),
    verified: false,
  });

  const otp = generateOtp();
  otpStore.set(key, otp);

  try {
    await sendOtpEmail(key, otp, "verify");
    res.json({ success: true, message: "OTP sent" });
  } catch {
    res.status(500).json({ error: "Email failed" });
  }
});

// Verify OTP
app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  const key = email.toLowerCase();

  if (otpStore.get(key) !== otp)
    return res.status(400).json({ error: "Invalid OTP" });

  const user = userStore.get(key);
  user.verified = true;

  res.json({ success: true });
});

// Login
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const key = email.toLowerCase();

  const user = userStore.get(key);

  if (!user || user.password !== hashPassword(password))
    return res.status(401).json({ error: "Invalid credentials" });

  if (!user.verified)
    return res.status(403).json({ error: "Verify OTP first" });

  res.json({ success: true });
});

// Forgot Password
app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  const key = email.toLowerCase();

  const otp = generateOtp();
  otpStore.set(key + "_reset", otp);

  try {
    await sendOtpEmail(key, otp, "reset");
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Email failed" });
  }
});

// Reset Password
app.post("/reset-password", (req, res) => {
  const { email, otp, newPassword } = req.body;
  const key = email.toLowerCase();

  if (otpStore.get(key + "_reset") !== otp)
    return res.status(400).json({ error: "Invalid OTP" });

  const user = userStore.get(key);
  user.password = hashPassword(newPassword);

  res.json({ success: true });
});

// AI
app.post("/ai", async (req, res) => {
  const { prompt } = req.body;

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
      }
    );

    res.json({
      result: response.data.choices[0].message.content,
    });
  } catch (e) {
    res.status(500).json({ error: "AI failed" });
  }
});

// ─── START ─────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);