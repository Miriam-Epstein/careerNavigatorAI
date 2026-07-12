# careerNavigatorAI

An AI-powered career diagnosis system that conducts a dynamic conversation with the user, analyzes their skills in real time, and recommends the most suitable profession — powered by Google Gemini.

---

## Architecture Overview

```
User (React)
    │
    │  POST /api/session
    │  POST /api/agent
    ▼
Express Server (Node.js)
    │
    ├── Agent Loop ──► Gemini API (gemini-2.5-flash-lite / gemini-2.5-flash)
    │       │
    │       └── Tool Call: analyze_skills ──► Gemini (structured JSON)
    │
    ├── Session Storage (JSON files)
    │
    └── POST /api/webhook  ◄── Make / Zapier (external automation)
              │
              └── Gemini instant analysis ──► returns structured JSON to Make
```

---

## AI Features

### 1. Agentic Loop with Tool Calling
The server runs a multi-iteration agent loop that autonomously decides whether to:
- Ask the user another diagnostic question
- Call the `analyze_skills` tool for intermediate skill analysis
- Return a final career recommendation

The loop is capped at `MAX_ITERATIONS = 8` to prevent infinite runs.

### 2. Tool Calling — `analyze_skills`
A Gemini function-calling tool that receives all Q&A pairs from the session and returns a structured list of skills with match percentages:

```json
[
  { "skill": "Interpersonal Communication", "match_percentage": 92 },
  { "skill": "Analytical Thinking",         "match_percentage": 78 }
]
```

The agent calls this tool automatically when enough answers have been collected, before making a final recommendation.

### 3. Structured JSON Output (Response Schema)
Every Gemini call uses a strict `responseSchema` — the model is forced to return a typed JSON object, never free text. This makes parsing reliable and eliminates prompt injection risks.

Example agent decision schema:
```json
{
  "done": false,
  "next_question": {
    "question": "What type of work environment suits you best?",
    "options": ["Independent", "Team-based", "Client-facing", "Research-oriented"]
  },
  "results": null
}
```

### 4. Dynamic System Prompt (Prompt Engineering)
Each agent iteration builds a fresh system prompt that includes:
- The user's self-description
- Full conversation history
- Skills analysis results (if already computed)
- Hard rules that prevent the model from finishing early

This ensures the model always has full context and cannot skip the minimum question threshold.

### 5. Model Fallback Strategy
Every Gemini call goes through a fallback chain:

```
gemini-2.5-flash-lite  →  (on 429 / quota error)  →  gemini-2.5-flash
```

This prevents downtime due to quota limits on a single model.

### 6. Webhook — Make / Zapier Integration
`POST /api/webhook` accepts an incoming lead from any automation platform (Make, Zapier, etc.), immediately runs a Gemini analysis on the user's text, and returns a structured JSON result that the automation can use to update a CRM, Google Sheet, or send a notification.

Request:
```json
{ "name": "John Doe", "email": "john@example.com", "userText": "I enjoy working with people and solving complex problems..." }
```

Response:
```json
{
  "sessionId": "uuid",
  "analysis": {
    "summary": "A candidate with strong interpersonal and problem-solving skills...",
    "top_skills": ["Communication", "Teamwork", "Problem Solving"],
    "recommended_profession": "HR Manager"
  }
}
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| Backend | Node.js, Express 5, ES Modules |
| AI | Google Gemini (`@google/genai`) — flash-lite + flash |
| Session Storage | JSON files (server-side) |
| Config | dotenv — API keys never committed to Git |

---

## API Endpoints

| Method | Route | Description |
|---|---|---|
| POST | `/api/session` | Create a new diagnosis session |
| POST | `/api/agent` | Send an answer and get the next question or final result |
| POST | `/api/webhook` | External webhook for Make / Zapier integration |

---

## Environment Variables

```env
GEMINI_API_KEY=your_key_here
```

The `.env` file is listed in `.gitignore` and is never committed to the repository.

---

## Running Locally

```bash
# Server
cd server
npm install
npm start        # runs on http://localhost:3001

# Client
cd client
npm install
npm run dev      # runs on http://localhost:5173
```
