import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';
import { readFile, writeFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { randomUUID, createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

// ── RAG: Professions Knowledge Base ─────────────────────────────────────────
// Loaded once at startup — used to inject real profession data into the final
// recommendation prompt instead of relying on the model's internal knowledge.
const PROFESSIONS_DB = JSON.parse(
  readFileSync(resolve(__dirname, 'professions_data.json'), 'utf-8')
);

// Retrieves the most relevant professions from the knowledge base based on
// the skills identified by the analyze_skills tool.
function retrieveProfessions(skillsAnalysis) {
  const topSkills = skillsAnalysis
    .sort((a, b) => b.match_percentage - a.match_percentage)
    .slice(0, 3)
    .map(s => s.skill.toLowerCase());

  const scored = Object.values(PROFESSIONS_DB).map(prof => {
    const overlap = prof.required_skills.filter(s =>
      topSkills.some(ts => s.toLowerCase().includes(ts) || ts.includes(s.toLowerCase()))
    ).length;
    return { ...prof, _score: overlap };
  });

  return scored
    .sort((a, b) => b._score - a._score)
    .slice(0, 3)
    .map(({ _score, ...prof }) => prof);
}

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
const MAX_ITERATIONS = 8;
const MIN_QUESTIONS = 3;
const SESSIONS_DIR = resolve(__dirname, 'sessions');

// ── Webhook Cache ────────────────────────────────────────────────────────────
// Stores recent webhook analysis results in memory to avoid redundant Gemini calls.
// Key: SHA-256 hash of userText | Value: { result, expiresAt }
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const webhookCache = new Map();

// ── Input Validation ────────────────────────────────────────────────────────
// Protects against empty input, oversized payloads, and prompt injection attempts.
const MAX_INPUT_LENGTH = 2000;
const INJECTION_PATTERNS = [
  /ignore (all |previous |prior )?instructions/i,
  /forget (everything|all|your instructions)/i,
  /you are now/i,
  /system prompt/i,
  /reveal (your|the) (prompt|instructions|api key)/i,
];

function validateInput(text, fieldName = 'input') {
  if (!text || typeof text !== 'string' || text.trim().length === 0)
    return `${fieldName} is required and cannot be empty`;
  if (text.length > MAX_INPUT_LENGTH)
    return `${fieldName} exceeds maximum length of ${MAX_INPUT_LENGTH} characters`;
  if (INJECTION_PATTERNS.some(p => p.test(text)))
    return `${fieldName} contains disallowed content`;
  return null; // valid
}

function getCached(userText) {
  const key = createHash('sha256').update(userText).digest('hex');
  const entry = webhookCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { webhookCache.delete(key); return null; }
  return entry.result;
}

function setCache(userText, result) {
  const key = createHash('sha256').update(userText).digest('hex');
  webhookCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Session helpers ──────────────────────────────────────────────────────────

async function loadSession(sessionId) {
  try {
    const raw = await readFile(resolve(SESSIONS_DIR, `${sessionId}.json`), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveSession(session) {
  await writeFile(
    resolve(SESSIONS_DIR, `${session.sessionId}.json`),
    JSON.stringify(session, null, 2),
    'utf-8'
  );
}

function createSession() {
  return {
    sessionId: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
    history: [],
    skillsAnalysis: null,
    results: null,
    agentLog: [],
  };
}

// ── Gemini helpers ───────────────────────────────────────────────────────────

async function callGemini(contents, config = {}) {
  for (let i = 0; i < MODELS.length; i++) {
    try {
      const response = await ai.models.generateContent({ model: MODELS[i], contents, config });
      return response;
    } catch (err) {
      const isRetryable = err?.status === 429 || err?.status === 503 || /quota|unavailable/i.test(err?.message ?? '');
      if (isRetryable && i < MODELS.length - 1) continue;
      console.error(`Model ${MODELS[i]} failed:`, err.message);
      throw err;
    }
  }
}

// ── Tool: analyze_skills ─────────────────────────────────────────────────────

const analyzeSkillsTool = {
  functionDeclarations: [{
    name: 'analyze_skills',
    description: 'Analyzes the user answers so far and returns a list of skills with match percentages',
    parameters: {
      type: Type.OBJECT,
      required: ['qa_pairs'],
      properties: {
        qa_pairs: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: ['question', 'answer'],
            properties: {
              question: { type: Type.STRING },
              answer: { type: Type.STRING },
            },
          },
        },
      },
    },
  }],
};

const skillsSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    required: ['skill', 'match_percentage'],
    properties: {
      skill: { type: Type.STRING },
      match_percentage: { type: Type.NUMBER },
    },
  },
};

async function executeAnalyzeSkills(qaPairs) {
  const text = qaPairs.map(p => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n');
  const result = await callGemini(
    `Analyze the following answers and return a list of skills with match percentages. Respond in English only:\n\n${text}`,
    { responseMimeType: 'application/json', responseSchema: skillsSchema }
  );
  return JSON.parse(result.text);
}

// ── Agent response schema ────────────────────────────────────────────────────

const resultsSchema = {
  type: Type.OBJECT,
  required: ['done', 'next_question', 'results'],
  properties: {
    done: { type: Type.BOOLEAN },
    next_question: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        question: { type: Type.STRING },
        options: { type: Type.ARRAY, minItems: 4, maxItems: 4, items: { type: Type.STRING } },
      },
    },
    results: {
      type: Type.ARRAY,
      nullable: true,
      items: {
        type: Type.OBJECT,
        required: ['profession', 'match_percentage', 'explanation'],
        properties: {
          profession: { type: Type.STRING },
          match_percentage: { type: Type.NUMBER },
          explanation: { type: Type.STRING },
        },
      },
    },
  },
};

// ── Agent Loop ───────────────────────────────────────────────────────────────

function buildSystemPrompt(session) {
  const historyText = session.history.filter(h => h.answer).length === 0
    ? 'No questions asked yet.'
    : session.history
        .filter(h => h.answer)
        .map((h, i) => `${i + 1}. Q: ${h.question}\n   A: ${h.answer}`)
        .join('\n');

  const skillsText = session.skillsAnalysis
    ? `\nSkills analysis completed:\n${session.skillsAnalysis.map(s => `- ${s.skill}: ${s.match_percentage}%`).join('\n')}`
    : '';

  // RAG: inject real profession data so the model recommends based on facts
  const ragText = session.skillsAnalysis
    ? `\n\nReal profession data (use ONLY this data for your recommendation):\n${
        retrieveProfessions(session.skillsAnalysis)
          .map(p => `• ${p.title} | Avg salary: ${p.avg_salary_ils.toLocaleString()}₪ | Demand: ${p.demand}\n  Required skills: ${p.required_skills.join(', ')}\n  ${p.description}`)
          .join('\n')
      }`
    : '';

  const answeredCount = session.history.filter(h => h.answer).length;
  const canFinish = answeredCount >= MIN_QUESTIONS && session.skillsAnalysis !== null;
  const finishLine = canFinish
    ? 'You may return a final recommendation.'
    : `Do NOT return a final recommendation yet — only ${answeredCount} answers collected.`;

  return `You are an intelligent career diagnosis agent. Always respond in English only.
The user described themselves: "${session.userText}"
Conversation history so far (${answeredCount} answers):
${historyText}${skillsText}${ragText}

Mandatory rules:
- You MUST ask at least ${MIN_QUESTIONS} questions before making a final decision. Currently ${answeredCount} answers.
- If there are ${MIN_QUESTIONS}+ answers and skills analysis has NOT been done — call analyze_skills.
- If skills analysis is already done — set done=true and return one profession in the results array.
- If fewer than ${MIN_QUESTIONS} answers — you MUST set done=false and provide a new question.
- All questions, options, and explanations MUST be in English.
${finishLine}`;
}

async function runAgentLoop(session) {
  let iterations = 0;
  const answeredCount = () => session.history.filter(h => h.answer).length;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`\n[Agent] iteration=${iterations} answered=${answeredCount()} skillsAnalysis=${!!session.skillsAnalysis}`);

    const systemPrompt = buildSystemPrompt(session);

    // Step 1: Ask model to decide — may call a tool (skip if skills already analyzed)
    if (!session.skillsAnalysis) {
      const toolResponse = await callGemini(
        [{ role: 'user', parts: [{ text: systemPrompt }] }],
        { tools: [analyzeSkillsTool] }
      );

      const parts = toolResponse.candidates?.[0]?.content?.parts ?? [];
      const toolCallPart = parts.find(p => p.functionCall);

      if (toolCallPart) {
        const { name, args } = toolCallPart.functionCall;
        if (name === 'analyze_skills') {
          console.log(`[Agent] 🔧 Tool called: analyze_skills with ${args.qa_pairs?.length} pairs`);
          const skillsResult = await executeAnalyzeSkills(args.qa_pairs);
          console.log(`[Agent] ✅ Skills result:`, JSON.stringify(skillsResult, null, 2));
          session.skillsAnalysis = skillsResult;
          session.agentLog.push({ iteration: iterations, action: 'tool_call', tool: name, result: skillsResult, at: new Date().toISOString() });
          continue;
        }
      }
    }

    // Step 2: No tool call (or skills already exist) — ask model for final JSON decision
    const finalPrompt = buildSystemPrompt(session) + '\n\nReturn the final JSON now according to the schema.';
    const finalResponse = await callGemini(
      finalPrompt,
      { responseMimeType: 'application/json', responseSchema: resultsSchema }
    );

    const agentDecision = JSON.parse(finalResponse.text);
    console.log(`[Agent] decision: done=${agentDecision.done}, question="${agentDecision.next_question?.question ?? '-'}"`);

    // Hard guard: never allow done=true before MIN_QUESTIONS answered
    if (agentDecision.done && answeredCount() < MIN_QUESTIONS) {
      console.log(`[Agent] ⚠️  Forced done=false — only ${answeredCount()}/${MIN_QUESTIONS} answers`);
      agentDecision.done = false;
      agentDecision.results = null;
      if (!agentDecision.next_question) {
        // Model didn't provide a question — ask again
        continue;
      }
    }

    // If skills were already analyzed, force done=true to prevent infinite loop
    if (session.skillsAnalysis && !agentDecision.done) {
      console.log('[Agent] ⚠️  Forced done=true — skills already analyzed');
      agentDecision.done = true;
      agentDecision.next_question = null;
    }

    session.agentLog.push({ iteration: iterations, action: 'decision', done: agentDecision.done, at: new Date().toISOString() });

    return agentDecision;
  }

  throw new Error('Agent loop exceeded max iterations');
}

// ── Routes ───────────────────────────────────────────────────────────────────

// ── Webhook (Make / Zapier integration) ─────────────────────────────────────
// External automation platforms (e.g. Make) POST a lead/user here.
// The server creates a session, runs a first Gemini analysis, and returns
// a structured JSON result that Make can use to update a CRM or Google Sheet.
app.post('/api/webhook', async (req, res) => {
  const { name, email, userText } = req.body;
  const webhookErr = validateInput(userText, 'userText');
  if (webhookErr) return res.status(400).json({ error: webhookErr });

  const session = { ...createSession(), userText, meta: { name, email } };

  // Ask Gemini for a quick initial analysis of the user's text
  const summarySchema = {
    type: Type.OBJECT,
    required: ['summary', 'top_skills', 'recommended_profession'],
    properties: {
      summary: { type: Type.STRING },
      top_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
      recommended_profession: { type: Type.STRING },
    },
  };

  // Return cached result if this exact text was analyzed recently
  const cached = getCached(userText);
  if (cached) {
    console.log('[Webhook] Cache hit — skipping Gemini call');
    return res.json({ sessionId: 'cached', name, email, analysis: cached, fromCache: true });
  }

  const analysis = await callGemini(
    `Analyze the following candidate text and return a summary, top skills, and profession recommendation. Respond in English only:\n\n"${userText}"`,
    { responseMimeType: 'application/json', responseSchema: summarySchema }
  );

  session.webhookAnalysis = JSON.parse(analysis.text);
  setCache(userText, session.webhookAnalysis);
  await saveSession(session);

  res.json({
    sessionId: session.sessionId,
    name,
    email,
    analysis: session.webhookAnalysis,
  });
});

app.post('/api/session', async (req, res) => {
  const session = { ...createSession(), userText: req.body.userText || '' };
  await saveSession(session);
  res.json({ sessionId: session.sessionId });
});

app.post('/api/agent', async (req, res) => {
  const { sessionId, answer } = req.body;

  let session = await loadSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'completed') return res.json({ done: true, results: session.results });

  if (answer) {
    const answerErr = validateInput(answer, 'answer');
    if (answerErr) return res.status(400).json({ error: answerErr });
  }

  if (answer && session.history.length > 0) {
    const last = session.history[session.history.length - 1];
    if (!last.answer) {
      last.answer = answer;
      last.answeredAt = new Date().toISOString();
    }
  }

  try {
    const agentDecision = await runAgentLoop(session);

    if (agentDecision.done) {
      session.status = 'completed';
      session.results = agentDecision.results;
      session.completedAt = new Date().toISOString();
    } else {
      session.history.push({
        question: agentDecision.next_question.question,
        options: agentDecision.next_question.options,
        askedAt: new Date().toISOString(),
        answer: null,
        answeredAt: null,
      });
    }

    session.updatedAt = new Date().toISOString();
    await saveSession(session);

    return res.json(agentDecision);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
