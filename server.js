import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ✅ TEST ROUTE
app.get("/", (req, res) => {
  res.send("Backend running 🚀");
});

// ✅ AI ROUTE
app.post("/ai", async (req, res) => {
  const { prompt } = req.body;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a viral content expert. Give trending Instagram reel hooks, captions and ideas."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.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}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({
      result: response.data.choices[0].message.content
    });

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "AI failed" });
  }
});

// ✅ IMPORTANT (PORT LISTEN)
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});