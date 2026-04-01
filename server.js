const express = require("express");
const cors = require("cors");
const { OpenAI } = require("openai");

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: "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",
});

app.post("/generate", async (req, res) => {
  try {
    const { prompt } = req.body;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "Generate Flutter UI code only" },
        { role: "user", content: prompt },
      ],
    });

    res.json({
      code: response.choices[0].message.content,
    });

  } catch (err) {
    console.error("ERROR:", err);

    res.json({
      code: "Backend Error:\n\n" + err.message,
    });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});