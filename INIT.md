# Project: Career Navigator AI

## Overview
A career recommendation quiz app. Users answer Yes/No questions and receive a profession recommendation based on weighted scoring.

## Tech Stack
- React 19 + TypeScript + Vite
- Tailwind CSS v4
- Data loaded from `/public/data.json` (no backend)

## Project Structure
```
client/
├── src/
│   ├── App.tsx        # Main component — quiz logic + UI
│   └── App.css        # Global styles
└── public/
    └── data.json      # Questions and professions data
```

## Current Features
- Fetches questions + professions from `data.json`
- Yes/No answer buttons update weighted scores per profession
- Progress bar shows current step
- Results screen shows top-scored profession
- Restart button resets the quiz

## Data Shape
```ts
Question = { id, text, weights: Record<professionKey, number> }
AppData  = { questions: Question[], professions: Record<string, string> }
```

## Goals
Improve UI/UX and code quality of the existing app — no new features unless explicitly requested.

## Rules
- Keep all existing logic unless told otherwise
- Preserve Hebrew text content
- Minimal code changes — only what is asked
- No tests unless explicitly requested
