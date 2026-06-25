# Plan: Gemini Integration — Career Navigator AI

## Goal
Replace the static question/scoring logic with a dynamic Gemini-powered backend.

---

## Files to Create / Modify

| File | Action | Purpose |
|---|---|---|
| `server/server.js` | Create | Express server + all route handlers |
| `server/package.json` | Modify | Add `"type": "module"` + `"start"` script |
| `.env` | Exists | Must contain `GEMINI_API_KEY` |

---

## Server Architecture

```
server/
├── server.js       ← single entry point (routes + Gemini logic)
└── package.json    ← type: module, start script
```

---

## Fallback Strategy

```
callGemini(prompt, schema):
  try  → gemini-2.5-flash-lite
  catch (429 / quota error)
       → retry with gemini-2.5-flash
  catch (other error)
       → throw immediately
```

---

## API Routes

### POST `/api/generate-questions`
- No request body
- Prompts Gemini to generate 4 varied Hebrew multiple-choice questions for occupational diagnosis
- Each question has exactly 4 answer options
- Returns a JSON array of 4 questions

### POST `/api/analyze-results`
- Request body: `{ questions: Question[], answers: string[] }`
- Prompts Gemini to analyze the user's 4 answers
- Returns a JSON array of the 3 most suitable professions

---

## Response Schemas (ResponseSchema — clean JSON only)

### `/api/generate-questions` output shape
```
Array (length: 4) of:
  {
    question: string,
    options: string[4]
  }
```

### `/api/analyze-results` output shape
```
Array (length: 3) of:
  {
    profession:        string,   ← profession name in Hebrew
    match_percentage:  number,   ← 0–100
    explanation:       string    ← short Hebrew explanation
  }
```

---

## Technical Notes

- ES Modules (`import`/`export`) — required by `"type": "module"`
- CORS enabled for all origins (client runs on a different port)
- API key loaded via `dotenv` from `.env`
- `ResponseSchema` uses the `Type` enum from `@google/genai` — guarantees JSON-only output, no markdown wrapping
- `.env` location: project root. If running `npm start` from inside `server/`, configure dotenv path explicitly to `../env`
- Server default port: `3001`
