import express from "express";
import cors from "cors";
import axios from "axios";

// ─── Startup Check ────────────────────────────────────────────────────────────
if (!process.env.GROQ_API_KEY) {
  console.error("❌ GROQ_API_KEY is not set in environment variables. Exiting.");
  process.exit(1);
}

const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: "*", // Production mein apna domain dalo e.g. "https://yourapp.com"
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json({ limit: "10kb" })); // DoS protection

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "ViralMate Backend running 🚀" });
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

  // ── TODO: Yahan apna real database auth lagao ──
  // Example ke liye hardcoded check hai
  // Real app mein: bcrypt.compare(password, hashedPasswordFromDB)
  const DEMO_EMAIL = "user@viralmate.com";
  const DEMO_PASSWORD = "secret123";

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

// ─── AI Generation Route ───────────────────────────────────────────────────────
app.post("/ai", async (req, res) => {
  const { prompt } = req.body;

  // Input validation
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
        timeout: 30000, // 30 second timeout
      }
    );

    const result = response.data.choices[0].message.content;
    return res.status(200).json({ result });

  } catch (error) {
    console.error("Groq API Error:", error.response?.data || error.message);

    if (error.code === "ECONNABORTED") {
      return res.status(504).json({ error: "AI response timeout. Dobara try karo." });
    }

    if (error.response?.status === 401) {
      return res.status(500).json({ error: "AI service authentication failed. Admin se contact karo." });
    }

    if (error.response?.status === 429) {
      return res.status(429).json({ error: "Too many requests. Thodi der baad try karo." });
    }

    return res.status(500).json({
      error: error.response?.data?.error?.message || "AI service temporarily unavailable. Please try again.",
    });
  }
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Route not found." });
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
