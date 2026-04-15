require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");

const app = express();

app.use(cors({
    origin: [
        "http://localhost:3000",
        "https://exampilot-frontend.vercel.app",
        process.env.FRONTEND_URL
    ].filter(Boolean),
    credentials: true
}));
app.use(express.json());

// ── UTILITY: Syllabus Cleaner ────────────────────────────────
const cleanSyllabus = (text) => {
    return text
        .replace(/\d+\s*of\s*\d+/g, "") 
        .replace(/[^\x20-\x7E\n]/g, "") 
        .replace(/\n\s*\n/g, '\n')     
        .trim()
        .substring(0, 6000);
};

// ── Groq Multi-Key Rotation (Already Perfect) ─────────────────
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
    console.log(`🔄 Rotated to API key ${currentKeyIndex + 1}`);
}

async function groqChat(messages, maxTokens = 4000) {
    let attempts = 0;
    while (attempts < GROQ_KEYS.length) {
        try {
            const groq = getGroqClient();
            const chat = await groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                max_tokens: maxTokens,
                temperature: 0.3,
                messages,
            });
            return chat.choices[0].message.content;
        } catch (e) {
            if (e.status === 429) {
                rotateKey();
                attempts++;
            } else {
                throw e;
            }
        }
    }
    throw new Error("All API keys rate limited.");
}

// ── Health Check ─────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "awake", app: "ExamPilot" }));

// ── EXAMPILOT CORE ROUTE (Day 1 - Final Version) ─────────────
app.post("/study-plan", async (req, res) => {
    const { syllabus, examDate, hoursPerDay = 4, university = "Indian University", subject = "" } = req.body;

    if (!syllabus || !examDate) {
        return res.status(400).json({ 
            success: false, 
            error: "Syllabus and examDate are required" 
        });
    }

    const daysLeft = Math.max(1, Math.ceil(
        (new Date(examDate) - new Date()) / (1000 * 60 * 60 * 24)
    ));

    const cleanedSyllabus = cleanSyllabus(syllabus);

    try {
        const plan = await groqChat([
            {
                role: "system",
                content: `You are ExamPilot — an expert Indian university exam coach. You deeply understand VIT, Mumbai University, Delhi University, Anna University exam patterns, marking schemes, and student panic. Create practical, motivating, and highly exam-oriented study plans.`
            },
            {
                role: "user",
                content: `Create a ${daysLeft}-day personalized study plan for a stressed Indian college student.

University: ${university}
Subject: ${subject}
Hours per day: ${hoursPerDay}
Syllabus:
${cleanedSyllabus}

Return ONLY in this exact clean markdown format (no extra text):

**EXAMPILOT — ${daysLeft}-DAY PLAN**
${university} | ${subject}

**DAY 1 — [Day Name]**
- Morning (X hrs): Topic...
- Evening (X hrs): Topic...

**Key Points (Exam-Focused):**
- Point 1
- Point 2
...

**Practice Questions (University Exam Style):**
1. Question 1
2. Question 2
...

**Memory Tricks:**
...

Repeat the exact same format for every day until the last day.
At the very end add:

**EXAM DAY MORNING CHECKLIST** (only 10-15 mins)
- Quick revision tips
- What to do right before exam
- Encouragement message`
            }
        ]);

        res.json({
            success: true,
            daysLeft,
            plan,
            message: "✅ Your personalized study plan is ready!"
        });
    } catch (error) {
        console.error("Study plan error:", error);
        res.status(500).json({ 
            success: false, 
            error: "Failed to generate plan. Please try again." 
        });
    }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 ExamPilot Engine Live on ${PORT}`));