import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';
import { readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
const MAX_ITERATIONS = 8;
const MIN_QUESTIONS = 3;
const SESSIONS_DIR = resolve(__dirname, 'sessions');

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
    description: 'מנתח את תשובות המשתמש עד כה ומחזיר רשימת כישורים עם אחוזי התאמה',
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
  const text = qaPairs.map(p => `שאלה: ${p.question}\nתשובה: ${p.answer}`).join('\n\n');
  const result = await callGemini(
    `נתח את התשובות הבאות והחזר רשימת כישורים עם אחוזי התאמה:\n\n${text}`,
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
    ? 'עדיין לא נשאלו שאלות.'
    : session.history
        .filter(h => h.answer)
        .map((h, i) => `${i + 1}. שאלה: ${h.question}\n   תשובה: ${h.answer}`)
        .join('\n');

  const skillsText = session.skillsAnalysis
    ? `\nניתוח כישורים שבוצע:\n${session.skillsAnalysis.map(s => `- ${s.skill}: ${s.match_percentage}%`).join('\n')}`
    : '';

  const answeredCount = session.history.filter(h => h.answer).length;
  const canFinish = answeredCount >= MIN_QUESTIONS && session.skillsAnalysis !== null;
  const finishLine = canFinish
    ? 'מותר להחזיר המלצה סופית.'
    : 'אסור להחזיר המלצה סופית עדיין! יש רק ' + answeredCount + ' תשובות.';

  return `אתה סוכן אבחון תעסוקתי חכם.
המשתמש תיאר את עצמו: "${session.userText}"
היסטוריית השיחה עד כה (${answeredCount} תשובות):
${historyText}${skillsText}

כללים מחייבים:
- חובה לשאול לפחות ${MIN_QUESTIONS} שאלות לפני כל החלטה סופית. כרגע יש ${answeredCount} תשובות.
- אם יש ${MIN_QUESTIONS}+ תשובות ועדיין לא בוצע ניתוח כישורים — קרא ל-analyze_skills.
- אם כבר בוצע ניתוח כישורים — הגדר done=true והחזר מקצוע אחד במערך results.
- אם יש פחות מ-${MIN_QUESTIONS} תשובות — חובה done=false ושאלה חדשה.
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
    const finalPrompt = buildSystemPrompt(session) + '\n\nהחזר עכשיו JSON סופי לפי הסכמה.';
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
