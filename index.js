require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const path = require("path");
const Groq = require("groq-sdk");

const app = express();
app.use(cors({
  origin: [
    "http://localhost:3000",
    process.env.FRONTEND_URL   // you'll set this in Railway after Vercel deploy
  ],
  credentials: true
}));
app.use(express.json());

// ── Key Rotation Setup ────────────────────────────────────────
// Add all your free Groq API keys here
const GROQ_KEYS = [
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
].filter(Boolean); // removes undefined keys

let currentKeyIndex = 0;

function getGroqClient() {
    return new Groq({ apiKey: GROQ_KEYS[currentKeyIndex] });
}

function rotateKey() {
    currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
    console.log(`🔄 Rotated to API key ${currentKeyIndex + 1}`);
}

// ── Updated groqChat (no forced JSON mode) ─────────────────────
async function groqChat(messages) {
    let attempts = 0;
    while (attempts < GROQ_KEYS.length) {
        try {
            const groq = getGroqClient();
            const chat = await groq.chat.completions.create({
                model: "llama-3.1-8b-instant",   // you can change to "llama-3.3-70b-versatile" later for better quality
                max_tokens: 1500,
                temperature: 0.4,
                messages,
                // ❌ Removed response_format so Summary & Ask AI work again
            });
            return chat.choices[0].message.content;
        } catch (e) {
            if (e.status === 429) {
                console.log(`⚠️ Key ${currentKeyIndex + 1} rate limited, rotating...`);
                rotateKey();
                attempts++;
            } else {
                throw e;
            }
        }
    }
    throw new Error("All API keys are rate limited. Please wait a few minutes.");
}
let sessions = {};

// ── 1. Process Video ──────────────────────────────────────────
app.post("/process-video", (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "No URL provided" });

    const match = url.match(/(?:v=|youtu\.be\/|embed\/)([^&\n?#]+)/);
    if (!match) return res.status(400).json({ error: "Invalid YouTube URL. Use a single video URL, not a playlist." });

    const videoId = match[1];
    const sessionId = `sess_${Date.now()}`;
    const scriptPath = path.join(__dirname, "get_transcript.py");

    console.log("📹 Processing:", videoId);

    exec(`python "${scriptPath}" ${videoId}`,
        { maxBuffer: 1024 * 1024 * 20, timeout: 60000 },
        (err, stdout, stderr) => {
            console.log("STDERR:", stderr?.slice(0, 200));

            if (err) return res.status(500).json({ error: "Failed to get transcript", details: stderr });

            try {
                const jsonStart = stdout.indexOf('[');
                if (jsonStart === -1) {
                    const parsed = JSON.parse(stdout);
                    return res.status(500).json({ error: parsed.error || "No transcript found" });
                }
                const data = JSON.parse(stdout.substring(jsonStart));
                // ✅ Limit to 6000 words to save tokens
                const fullText = data.map(t => t.text).join(" ").slice(0, 24000);
                sessions[sessionId] = { fullText, videoId, url, transcript: data };
                console.log("✅ Session created:", sessionId, "| Length:", fullText.length);
                res.json({ session_id: sessionId, success: true });
            } catch (e) {
                res.status(500).json({ error: "Could not read transcript", details: stdout?.slice(0, 300) });
            }
        }
    );
});

// ── 2. Summary ────────────────────────────────────────────────
// ── 2. Summary ────────────────────────────────────────────────
app.post("/summary", async (req, res) => {
    const { session_id } = req.body;
    const session = sessions[session_id];
    if (!session) return res.status(404).json({ error: "Session expired." });

    try {
        const summary = await groqChat([
             { role: "system", content: "You are an educational AI tutor. You MUST respond ONLY in English. Never use Hindi, Bengali, or any other language. Always translate and respond in English only." },
            { 
                role: "user", 
                content: `Summarize this lecture in simple English:\n\n1. One short overview paragraph.\n2. Then 5-7 key bullet points.\n\nLecture:\n${session.fullText.slice(0, 7000)}` 
            }
        ]);

        res.json({ summary });
    } catch (e) {
        console.error("Summary error:", e.message);
        res.status(500).json({ error: "Failed to generate summary. Please try again." });
    }
});
// ── 5. Timestamps ─────────────────────────────────────────────
app.post("/timestamps", async (req, res) => {
    const { session_id } = req.body;
    const session = sessions[session_id];
    if (!session) return res.status(404).json({ error: "Session expired." });

    try {
        const transcript = session.transcript;
        const total = transcript.length;
        
        // ✅ Get video duration from last transcript segment
        const lastSegment = transcript[total - 1];
        const videoDuration = lastSegment.start + (lastSegment.duration || 0);
        
        // ✅ Pick exactly 8 evenly spaced segments regardless of video length
        const numSamples = 8;
        const sampled = [];
        for (let i = 0; i < numSamples; i++) {
            const targetTime = (videoDuration / numSamples) * i;
            // Find closest transcript segment to this time
            const closest = transcript.reduce((prev, curr) =>
                Math.abs(curr.start - targetTime) < Math.abs(prev.start - targetTime) ? curr : prev
            );
            sampled.push(closest);
        }
        
        // Remove duplicates
        const unique = sampled.filter((v, i, a) => 
            a.findIndex(t => t.start === v.start) === i
        );

        const text = await groqChat([
            { role: "system", content: "You are an educational AI. Always respond in English. Return only valid JSON." },
            { role: "user", content: `From these transcript segments spread across a ${Math.round(videoDuration/3600)}hr ${Math.round((videoDuration%3600)/60)}min video, extract key topic moments. Return ONLY a JSON array:\n[{"time": 45, "label": "Short topic name"}]\nUse the actual "start" value as "time". Keep labels under 5 words.\n\nSegments:\n${JSON.stringify(unique)}` }
        ]);

        const json = text.match(/\[[\s\S]*\]/)[0];
        res.json({ timestamps: JSON.parse(json), videoId: session.videoId });
    } catch (e) {
        console.error("Timestamp error:", e.message);
        res.status(500).json({ error: "Failed to generate timestamps" });
    }
});
// ── 3. Flashcards ─────────────────────────────────────────────
// ── 3. Flashcards ─────────────────────────────────────────────
app.post("/flashcards", async (req, res) => {
    const { session_id } = req.body;
    const session = sessions[session_id];
    if (!session) return res.status(404).json({ error: "Session expired." });

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            const text = await groqChat([
                
                // Same stronger system message for ALL routes:
                { role: "system", content: "You are an educational AI tutor. You MUST respond ONLY in English. Never use Hindi, Bengali, or any other language. Always translate and respond in English only." },
                { 
                    role: "user", 
                    content: `Create exactly 8 high-quality flashcards from the lecture transcript below.

Return ONLY a JSON object in this exact format (no other text):
{
  "flashcards": [
    {"question": "Clear question or term", "answer": "Concise, accurate answer"},
    {"question": "...", "answer": "..."}
  ]
}

Transcript:
${session.fullText.slice(0, 6500)}` 
                }
            ]);

            // === SUPER ROBUST JSON CLEANING ===
            let cleaned = text.trim();

            // Remove markdown code blocks
            cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

            // Extract JSON object if model added extra text
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) cleaned = jsonMatch[0];

            const parsed = JSON.parse(cleaned);

            // Support both direct array and {flashcards: [...]}
            let flashcards = parsed.flashcards || parsed;

            if (!Array.isArray(flashcards)) {
                throw new Error("Response is not an array");
            }

            console.log(`✅ Generated ${flashcards.length} flashcards`);
            return res.json({ flashcards });

        } catch (e) {
            attempts++;
            console.error(`Flashcard attempt ${attempts} failed:`, e.message);

            if (attempts >= maxAttempts) {
                console.error("❌ All flashcard generation attempts failed");
                return res.status(500).json({ 
                    error: "Failed to generate flashcards (JSON parsing issue)",
                    flashcards: [] 
                });
            }

            // Small delay before retry
            await new Promise(r => setTimeout(r, 1200));
        }
    }
});
// ── 4. Q&A ────────────────────────────────────────────────────
// ── 4. Q&A ────────────────────────────────────────────────────
app.post("/ask", async (req, res) => {
    const { session_id, question } = req.body;
    const session = sessions[session_id];
    if (!session) return res.status(404).json({ error: "Session expired." });

    try {
        const answer = await groqChat([
            { 
                role: "system", 
                content: "You are an educational AI tutor. Answer in clear, simple, natural English. Keep answers short and easy to understand." 
            },
            { 
                role: "user", 
                content: `Lecture transcript:\n${session.fullText.slice(0, 6000)}\n\nQuestion: ${question}\n\nAnswer in simple English:` 
            }
        ]);

        res.json({ answer });
    } catch (e) {
        console.error("Ask error:", e.message);
        res.status(500).json({ error: "Failed to get answer." });
    }
});
const PORT = process.env.PORT || 5000;
// Temp debug route - remove after testing
app.get("/debug", (req, res) => {
    const cookies = process.env.YOUTUBE_COOKIES;
    res.json({
        cookies_set: !!cookies,
        cookies_length: cookies ? cookies.length : 0,
        first_line: cookies ? cookies.split('\n')[0] : 'NOT SET'
    });
});
app.listen(PORT, "0.0.0.0", () => 
    console.log(`🚀 LectAI Backend running on port ${PORT}`)
);