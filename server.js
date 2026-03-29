const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

// ✅ TEST ROUTE
app.get("/", (req, res) => {
  res.send("Backend running 🚀");
});

// ✅ AI ROUTE (GROQ - FAST + FREE)
app.post("/ai", async (req, res) => {
  const { prompt } = req.body;

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama3-70b-8192",
        messages: [
          {
            role: "system",
            content:
              "You are a viral content expert. Give trending Instagram reel hooks, captions and ideas.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      },
      {
        headers: {
          Authorization: " Bearer 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",
          "Content-Type": "application/json",
        },
      }
    );

    res.json({
      result: response.data.choices[0].message.content,
    });

  } catch (error) {
    console.log(error.response?.data || error.message);
    res.status(500).json({
      error: "Something went wrong",
    });
  }
});

// ✅ SERVER START
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});