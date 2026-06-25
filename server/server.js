import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];

async function callGemini(prompt, responseSchema) {
  for (let i = 0; i < MODELS.length; i++) {
    try {
      const response = await ai.models.generateContent({
        model: MODELS[i],
        contents: prompt,
        config: { responseMimeType: 'application/json', responseSchema },
      });
      return JSON.parse(response.text);
    } catch (err) {
      const isQuota = err?.status === 429 || /quota/i.test(err?.message ?? '');
      if (isQuota && i < MODELS.length - 1) continue;
      throw err;
    }
  }
}

app.post('/api/generate-questions', async (req, res) => {
  const schema = {
    type: Type.ARRAY,
    minItems: 4,
    maxItems: 4,
    items: {
      type: Type.OBJECT,
      required: ['question', 'options'],
      properties: {
        question: { type: Type.STRING },
        options: { type: Type.ARRAY, minItems: 4, maxItems: 4, items: { type: Type.STRING } },
      },
    },
  };

  const prompt = `
    אתה מומחה לאבחון תעסוקתי.
    צור בדיוק 4 שאלות אמריקאיות מגוונות בעברית לאבחון תעסוקתי ראשוני.
    לכל שאלה בדיוק 4 אפשרויות תשובה בעברית.
    השאלות יכסו תחומים שונים: אישיות, כישורים, סביבת עבודה, תחומי עניין.
    החזר JSON בלבד לפי הסכמה.
  `;

  try {
    res.json(await callGemini(prompt, schema));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/analyze-results', async (req, res) => {
  const { questions, answers } = req.body;

  const schema = {
    type: Type.ARRAY,
    minItems: 3,
    maxItems: 3,
    items: {
      type: Type.OBJECT,
      required: ['profession', 'match_percentage', 'explanation'],
      properties: {
        profession: { type: Type.STRING },
        match_percentage: { type: Type.NUMBER },
        explanation: { type: Type.STRING },
      },
    },
  };

  const answersText = questions
    .map((q, i) => `שאלה: ${q.question}\nתשובה: ${answers[i]}`)
    .join('\n\n');

  const prompt = `
    אתה מומחה לאבחון תעסוקתי.
    להלן 4 שאלות ותשובות שמשתמש בחר:

    ${answersText}

    נתח את הבחירות והחזר את 3 המקצועות המתאימים ביותר.
    לכל מקצוע: שם בעברית, אחוז התאמה (0–100), הסבר קצר בעברית.
    החזר JSON בלבד לפי הסכמה.
  `;

  try {
    res.json(await callGemini(prompt, schema));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
