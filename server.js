import express from "express";
import cors from "cors";
import axios from "axios";
import nodemailer from "nodemailer";

// ─── Startup Checks ────────────────────────────────────────────────────────────
const missingKeys = [];
if (!process.env.GROQ_API_KEY) missingKeys.push("GROQ_API_KEY");

if (missingKeys.length > 0) {
  console.error(`❌ Missing required env variables: ${missingKeys.join(", ")}`);
  console.error("Server will start but affected features will be disabled.");
}

// ─── Email Transporter Setup ──────────────────────────────────────────────────
let emailTransporter = null;

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  emailTransporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS, // Gmail: App Password use karo (not account password)
    },
    connectionTimeout: 10000,  // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  // Verify connection at startup
  emailTransporter.verify((error) => {
    if (error) {
      console.warn("⚠️  Email service not connected:", error.message);
      console.warn("    EMAIL_USER aur EMAIL_PASS check karo, ya Gmail App Password use karo.");
    } else {
      console.log("✅ Email service connected");
    }
  });
} else {
  console.warn("⚠️  EMAIL_USER / EMAIL_PASS not set. Email features will be disabled.");
}

// ─── App Setup ─────────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: "*", // Production mein apna domain set karo
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json({ limit: "10kb" }));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "ViralMate Backend running 🚀",
    services: {
      ai: !!process.env.GROQ_API_KEY,
      email: !!emailTransporter,
    },
  });
});

// ─── Login Route ──────────────────────────────────────────────────────────────
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email aur password dono zaroori hain." });
  }

  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Invalid input format." });
  }

  const trimmedEmail = email.trim().toLowerCase();

  // ── TODO: Apna real DB auth yahan lagao ─────────────────────────────────────
  // Example: const user = await User.findOne({ email: trimmedEmail });
  // if (!user || !await bcrypt.compare(password, user.passwordHash)) { ... }
  // ────────────────────────────────────────────────────────────────────────────

  const DEMO_EMAIL = process.env.DEMO_EMAIL || "user@viralmate.com";
  const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "secret123";

  if (trimmedEmail === DEMO_EMAIL && password === DEMO_PASSWORD) {
    return res.status(200).json({
      success: true,
      token: "demo-jwt-token-replace-with-real-jwt",
      user: {
        name: "Harsh Bhardwaj",
        email: trimmedEmail,
        plan: "free",
      },
    });
  }

  return res.status(401).json({ error: "Email ya password galat hai." });
});

// ─── Send Email Route ─────────────────────────────────────────────────────────
app.post("/send-email", async (req, res) => {
  if (!emailTransporter) {
    return res.status(503).json({
      error: "Email service is not configured. Admin se contact karo.",
    });
  }

  const { to, subject, message } = req.body;

  if (!to || !subject || !message) {
    return res.status(400).json({ error: "to, subject aur message zaroori hain." });
  }

  if (typeof to !== "string" || !to.includes("@")) {
    return res.status(400).json({ error: "Valid email address daalein." });
  }

  try {
    await emailTransporter.sendMail({
      from: `"ViralMate" <${process.env.EMAIL_USER}>`,
      to: to.trim(),
      subject: subject.trim(),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #6366F1;">ViralMate</h2>
          <p>${message}</p>
          <hr style="border: 1px solid #eee;" />
          <small style="color: #9CA3AF;">ViralMate - AI Powered Content Creator</small>
        </div>
      `,
    });

    return res.status(200).json({ success: true, message: "Email sent successfully." });
  } catch (error) {
    console.error("Email send error:", error.message);

    if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
      return res.status(503).json({
        error: "Email server se connect nahi ho pa raha. Internet ya SMTP settings check karo.",
      });
    }

    if (error.responseCode === 535) {
      return res.status(500).json({
        error: "Email authentication failed. Gmail App Password use karo.",
      });
    }

    return res.status(500).json({ error: "Email send karne mein error aya. Dobara try karo." });
  }
});

// ─── AI Generation Route ───────────────────────────────────────────────────────
app.post("/ai", async (req, res) => {
  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: "AI service is not configured." });
  }

  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return res.status(400).json({ error: "Prompt required aur non-empty hona chahiye." });
  }

  if (prompt.trim().length > 2000) {
    return res.status(400).json({ error: "Prompt 2000 characters se kam hona chahiye." });
  }

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama3-70b-8192",
        messages: [
          {
            role: "system",
            content:
              "You are ViralMate, an expert social media content creator specializing in viral content for Instagram, YouTube Shorts, and other platforms. Be creative, engaging, and practical.",
          },
          {
            role: "user",
            content: prompt.trim(),
          },
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

    return res.status(200).json({
      result: response.data.choices[0].message.content,
    });
  } catch (error) {
    console.error("Groq API Error:", error.response?.data || error.message);

    if (error.code === "ECONNABORTED") {
      return res.status(504).json({ error: "AI response timeout. Dobara try karo." });
    }
    if (error.response?.status === 401) {
      return res.status(500).json({ error: "AI authentication failed. GROQ_API_KEY check karo." });
    }
    if (error.response?.status === 429) {
      return res.status(429).json({ error: "Too many requests. Thodi der baad try karo." });
    }

    return res.status(500).json({
      error: error.response?.data?.error?.message || "AI service temporarily unavailable.",
    });
  }
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route '${req.path}' not found.` });
});

// ─── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error." });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ ViralMate server running on port ${PORT}`);
});
