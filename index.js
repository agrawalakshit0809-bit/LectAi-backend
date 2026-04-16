require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");

const app = express();

app.use(cors());
app.use(express.json());

// ── CLEANER ─────────────────────────────
const cleanSyllabus = (text) => {
  return text
    .replace(/\d+\s*of\s*\d+/g, "")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/\n\s*\n/g, "\n")
    .trim()
    .substring(0, 6000);
};

// ── GROQ SETUP ─────────────────────────
const GROQ_KEYS = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
].filter(Boolean);

let currentKeyIndex = 0;

function getGroqClient() {
  return new Groq({ apiKey: GROQ_KEYS[currentKeyIndex] });
}

function rotateKey() {
  currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
}

async function groqChat(messages) {
  let attempts = 0;

  while (attempts < GROQ_KEYS.length) {
    try {
      const groq = getGroqClient();
      const chat = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        max_tokens: 4000,
        temperature: 0.3,
        messages,
      });

      return chat.choices[0].message.content;
    } catch (e) {
      if (e.status === 429) {
        rotateKey();
        attempts++;
      } else throw e;
    }
  }

  throw new Error("All API keys rate limited.");
}

// ── EXTRACT DAY 1 ───────────────────────
function extractTodayPlan(plan) {
  const match = plan.match(/\*\*DAY 1[\s\S]*?(?=\*\*DAY 2|\*\*FINAL|$)/);
  return match ? match[0] : plan;
}

// ── ROUTE ──────────────────────────────
app.post("/study-plan", async (req, res) => {
  try {
    const { syllabus, examDate, hoursPerDay = 4 } = req.body;

    if (!syllabus || !examDate) {
      return res.status(400).json({ success: false, error: "Missing data" });
    }

    const today = new Date();
    const exam = new Date(examDate);

    const daysLeft = Math.max(
      1,
      Math.ceil((exam - today) / (1000 * 60 * 60 * 24))
    );

    const todayStr = today.toDateString();

    const cleanedSyllabus = cleanSyllabus(syllabus);

    const plan = await groqChat([
      {
        role: "system",
        content: `You are ExamPilot — expert Indian exam planner.`,
      },
      {
        role: "user",
        content: `Create ${daysLeft}-day plan.

Today is ${todayStr}. Use correct weekdays.

Syllabus:
${cleanedSyllabus}

Format strictly:

**DAY 1 — [Day Name]**
- Morning:
- Evening:

**Key Points:**
...

**Practice Questions:**
...

**Memory Tricks:**
...

Repeat for all days.

End with checklist.`,
      },
    ]);

    const todayPlan = extractTodayPlan(plan);

    res.json({
      success: true,
      plan,
      todayPlan,
      daysLeft,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed" });
  }
});

const PORT = process.env.PORT || 5001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 ExamPilot running on ${PORT}`);
});