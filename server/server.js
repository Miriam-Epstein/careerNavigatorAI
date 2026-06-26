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
const MAX_ITERATIONS = 6;
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

async function callGemini(contents, tools, responseSchema) {
  for (let i = 0; i < MODELS.length; i++) {
    try {
      const config = {};
      if (responseSchema) {
        config.responseMimeType = 'application/json';
        config.responseSchema = responseSchema;
      }
      if (tools) config.tools = tools;
      const response = await ai.models.generateContent({ model: MODELS[i], contents, config });
      return response;
    } catch (err) {
      const isQuota = err?.status === 429 || /quota/i.test(err?.message ?? '');
      if (isQuota && i < MODELS.length - 1) continue;
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
    null,
    skillsSchema
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

// ── Routes ───────────────────────────────────────────────────────────────────

app.post('/api/session', async (req, res) => {
  const session = createSession();
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

  const historyText = session.history.filter(h => h.answer).length === 0
    ? 'עדיין לא נשאלו שאלות.'
    : session.history
        .filter(h => h.answer)
        .map((h, i) => `${i + 1}. שאלה: ${h.question}\n   תשובה: ${h.answer}`)
        .join('\n');

  const systemPrompt = `אתה סוכן אבחון תעסוקתי חכם.
היסטוריית השיחה עד כה:
${historyText}

החלט:
- אם יש מספיק מידע (לפחות 4 שאלות ותשובות), הגדר done=true והחזר 3 המלצות מקצוע.
- אחרת, הגדר done=false והחזר שאלה הבאה עם 4 אפשרויות בעברית.
- אם נדרש ניתוח ביניים, קרא לפונקציה analyze_skills.
החזר JSON בלבד לפי הסכמה.`;

  try {
    let contents = systemPrompt;
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const response = await callGemini(contents, [analyzeSkillsTool], null);
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const toolCallPart = parts.find(p => p.functionCall);

      if (toolCallPart) {
        const { name, args } = toolCallPart.functionCall;
        if (name === 'analyze_skills') {
          const skillsResult = await executeAnalyzeSkills(args.qa_pairs);

          session.skillsAnalysis = skillsResult;
          session.agentLog.push({ iteration: iterations, action: 'tool_call', tool: name, result: skillsResult, at: new Date().toISOString() });

          contents = [
            { role: 'user', parts: [{ text: systemPrompt }] },
            { role: 'model', parts: [{ functionCall: toolCallPart.functionCall }] },
            { role: 'user', parts: [{ functionResponse: { name, response: { output: JSON.stringify(skillsResult) } } }] },
          ];
          continue;
        }
      }

      const finalResponse = await callGemini(
        typeof contents === 'string'
          ? `${contents}\n\nהחזר עכשיו JSON סופי לפי הסכמה.`
          : [...contents, { role: 'user', parts: [{ text: 'החזר עכשיו JSON סופי לפי הסכמה.' }] }],
        null,
        resultsSchema
      );

      const agentDecision = JSON.parse(finalResponse.text);
      session.agentLog.push({ iteration: iterations, action: 'decision', done: agentDecision.done, at: new Date().toISOString() });

      if (agentDecision.done) {
        session.status = 'completed';
        session.results = agentDecision.results;
        session.completedAt = new Date().toISOString();
      } else {
        session.history.push({ question: agentDecision.next_question.question, options: agentDecision.next_question.options, askedAt: new Date().toISOString(), answer: null, answeredAt: null });
      }

      session.updatedAt = new Date().toISOString();
      await saveSession(session);

      return res.json(agentDecision);
    }

    res.status(500).json({ error: 'Agent loop exceeded max iterations' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
