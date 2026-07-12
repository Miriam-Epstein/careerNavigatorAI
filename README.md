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
    │       ├── Tool Call: analyze_skills ──► Gemini (structured JSON)
    │       │
    │       └── RAG: retrieveProfessions() ──► professions_data.json
    │               └── injects real profession data into final prompt
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

### 5. RAG — Retrieval-Augmented Generation
Before returning a final career recommendation, the agent retrieves real profession data from a local knowledge base (`professions_data.json`) and injects it into the Gemini prompt.

- **Knowledge base** — 10 professions with real data: average salary, required skills, market demand, career growth path, and description
- **Retrieval logic** — matches the top skills identified by `analyze_skills` against each profession's required skills, ranks by overlap, and selects the top 3
- **Augmented prompt** — Gemini receives the instruction: *"use only this data for your recommendation"* — eliminating hallucinations on profession details

```
skills analysis result
        ↓
retrieveProfessions()  →  professions_data.json
        ↓
top 3 matching professions injected into prompt
        ↓
Gemini recommends based on real facts ✅
```

### 6. Webhook Caching

To avoid redundant Gemini calls and reduce API costs, the webhook endpoint caches analysis results in memory using a SHA-256 hash of the input text as the key.

- Cache TTL: **10 minutes**
- If the same `userText` is received within the TTL window, the server returns the cached result immediately — no Gemini call is made
- The response includes `fromCache: true` to indicate a cache hit

```
Incoming userText → SHA-256 hash → found in cache? → return immediately ✅
                                 → not found?      → call Gemini → cache result → return
```

### 7. Input Validation & Prompt Injection Protection
All user input is validated before reaching Gemini, across both `/api/webhook` and `/api/agent`:

- **Empty input** — rejected with `400`
- **Oversized input** — rejected if over `2000` characters
- **Prompt injection attempts** — blocked by pattern matching against known attack phrases (e.g. `"ignore all previous instructions"`, `"reveal your API key"`)

This prevents token waste, unexpected model behavior, and potential data leakage.

### 8. Model Fallback Strategy
Every Gemini call goes through a fallback chain:

```
gemini-2.5-flash-lite  →  (on 429 / quota error)  →  gemini-2.5-flash
```

This prevents downtime due to quota limits on a single model.

### 9. Webhook — Make / Zapier Integration
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

## UI & Design System

The frontend is built with a **dark glassmorphic aesthetic** — the same visual language used by Linear, Vercel, and Framer.

### Design Tokens

| Token | Value |
|---|---|
| Background | `#0c0c10` |
| Primary accent | `indigo-600` → `violet-600` (gradient) |
| Card surface | `bg-white/[0.04]` + `backdrop-blur-2xl` |
| Card border | `border-white/[0.08]` |
| Text primary | `text-white/90` |
| Text secondary | `text-slate-400` |
| Text muted | `text-slate-500` |

### Visual Features

- **Orbs** — two large blurred radial gradients (`blur-[140px]`) anchored to opposite corners, creating depth and ambient light behind the glass cards
- **Glassmorphism cards** — `backdrop-blur-2xl` + semi-transparent background + subtle white border
- **Gradient text** — logo uses `bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text`
- **Fade-in transitions** — every phase mounts with `opacity 0→1` + `translateY 10px→0` via a `useFadeIn` hook (no external dependencies)
- **Dual spinner** — two concentric rings spinning in opposite directions on the loading screen
- **Quiz options** — lettered badges (A/B/C/D) with indigo hover state and border animation
- **Results** — gradient progress bar per profession + `Top Match` badge on the first result

### Component Structure

```
App
├── Orbs          — background ambient light (shared)
├── Logo          — gradient wordmark (shared)
├── IntroCard     — phase: intro
├── LoadingIndicator — phase: loading
├── QuizCard      — phase: quiz
└── ResultsCard   — phase: results
```

### Fonts

Inter (Google Fonts) with `-webkit-font-smoothing: antialiased` for crisp rendering.

---

## MCP Integration

The core AI logic of this system has been packaged as a standalone **MCP (Model Context Protocol) server**, allowing any MCP-compatible client (Claude Desktop, Cursor, etc.) to call the career diagnosis tools directly.

👉 **[career-navigator-mcp](https://github.com/Miriam-Epstein/career-navigator-mcp)**

Exposed tools:
- `analyze_skills` — analyzes free text and returns a skills list with match percentages
- `recommend_profession` — receives skills and returns a profession recommendation using RAG

```
Claude Desktop / Cursor
    │
    │  tools/call
    ▼
career-navigator-mcp
    ├── analyze_skills ──► Gemini API
    └── recommend_profession ──► professions_data.json (RAG)
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
