import { useEffect, useRef, useState } from 'react'

type Question = {
  question: string
  options: string[]
}

type Profession = {
  profession: string
  match_percentage: number
  explanation: string
}

type AgentResponse =
  | { done: false; next_question: Question; results: null }
  | { done: true; next_question: null; results: Profession[] }

type Phase = 'intro' | 'loading' | 'quiz' | 'results'

const SESSION_KEY = 'career_navigator_session_id'

async function createSession(userText: string): Promise<string> {
  const r = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userText }),
  })
  const { sessionId } = await r.json()
  localStorage.setItem(SESSION_KEY, sessionId)
  return sessionId
}

async function callAgent(sessionId: string, answer?: string): Promise<AgentResponse> {
  const r = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, answer }),
  })
  return r.json()
}

function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.opacity = '0'
    el.style.transform = 'translateY(10px)'
    el.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out'
    requestAnimationFrame(() => {
      el.style.opacity = '1'
      el.style.transform = 'translateY(0)'
    })
  }, [])
  return ref
}

function Orbs() {
  return (
    <>
      <div className="pointer-events-none absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-indigo-600/[0.12] blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full bg-violet-600/[0.12] blur-[140px]" />
    </>
  )
}

function Logo() {
  return (
    <div className="text-center space-y-1.5">
      <h1 className="text-3xl font-bold tracking-tight">
        <span className="text-white/90">career</span>
        <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">Navigator</span>
        <span className="text-white/90">AI</span>
      </h1>
      <p className="text-slate-500 text-xs tracking-widest">Discover the career that fits you</p>
    </div>
  )
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('intro')
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null)
  const [questionCount, setQuestionCount] = useState(0)
  const [results, setResults] = useState<Profession[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [userText, setUserText] = useState('')

  const startSession = async (text: string) => {
    setPhase('loading')
    setQuestionCount(0)
    setResults([])
    const id = await createSession(text)
    setSessionId(id)
    const data = await callAgent(id)
    if (!data.done && data.next_question) {
      setCurrentQuestion(data.next_question)
      setQuestionCount(1)
      setPhase('quiz')
    }
  }

  useEffect(() => {}, [])

  const handleAnswer = async (option: string) => {
    if (!currentQuestion || !sessionId) return
    setPhase('loading')
    const data = await callAgent(sessionId, option)
    if (data.done && data.results) {
      setResults(data.results)
      setPhase('results')
    } else if (!data.done && data.next_question) {
      setCurrentQuestion(data.next_question)
      setQuestionCount(q => q + 1)
      setPhase('quiz')
    }
  }

  if (phase === 'intro') return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-[#0c0c10] p-6 overflow-hidden">
      <Orbs />
      <IntroCard userText={userText} setUserText={setUserText} onStart={startSession} />
    </div>
  )

  if (phase === 'loading') return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-[#0c0c10] gap-5 overflow-hidden">
      <Orbs />
      <LoadingIndicator questionCount={questionCount} />
    </div>
  )

  if (phase === 'results') return (
    <div className="relative flex items-center justify-center min-h-screen bg-[#0c0c10] p-6 overflow-hidden">
      <Orbs />
      <ResultsCard results={results} onRestart={() => { setUserText(''); setPhase('intro') }} />
    </div>
  )

  const progress = (questionCount / (questionCount + 1)) * 100

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-[#0c0c10] p-6 gap-6 overflow-hidden">
      <Orbs />
      <Logo />
      <QuizCard
        question={currentQuestion!}
        questionCount={questionCount}
        progress={progress}
        onAnswer={handleAnswer}
      />
    </div>
  )
}

function IntroCard({ userText, setUserText, onStart }: {
  userText: string
  setUserText: (v: string) => void
  onStart: (text: string) => void
}) {
  const ref = useFadeIn()
  return (
    <div ref={ref} className="relative bg-white/[0.04] backdrop-blur-2xl border border-white/[0.08] rounded-3xl p-10 max-w-sm w-full space-y-7 shadow-[0_0_100px_rgba(99,102,241,0.1)]">
      <Logo />
      <p className="text-slate-400 text-sm text-center leading-relaxed">
        Tell us about yourself — your interests, skills, or what matters most to you in a job
      </p>
      <textarea
        className="w-full rounded-2xl bg-white/[0.04] border border-white/[0.08] p-4 text-sm text-slate-200 placeholder:text-slate-600 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500/60 focus:border-indigo-500/40 transition-all duration-300 ease-out"
        rows={4}
        placeholder="e.g. I enjoy working with people, I have technical skills..."
        value={userText}
        onChange={e => setUserText(e.target.value)}
      />
      <button
        onClick={() => onStart(userText)}
        disabled={!userText.trim()}
        className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-semibold rounded-2xl hover:from-indigo-500 hover:to-violet-500 active:scale-[0.98] transition-all duration-300 ease-out disabled:opacity-25 disabled:cursor-not-allowed shadow-lg shadow-indigo-600/20"
      >
        Continue →
      </button>
    </div>
  )
}

const LOADING_STEPS_INTRO = [
  'Analyzing your profile...',
  'Identifying key traits...',
  'Preparing your questions...',
]

const LOADING_STEPS_ANSWER = [
  'Processing your answer...',
  'Analyzing personality traits...',
  'Searching career database...',
  'Formulating career paths...',
]

function LoadingIndicator({ questionCount }: { questionCount: number }) {
  const ref = useFadeIn()
  const steps = questionCount === 0 ? LOADING_STEPS_INTRO : LOADING_STEPS_ANSWER
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex(i => (i + 1) % steps.length)
    }, 1800)
    return () => clearInterval(interval)
  }, [steps.length])

  return (
    <div ref={ref} className="flex flex-col items-center gap-5">
      <div className="relative w-11 h-11">
        <div className="absolute inset-0 rounded-full border border-white/[0.06]" />
        <div className="absolute inset-0 rounded-full border border-transparent border-t-indigo-400/80 animate-spin" />
        <div className="absolute inset-[3px] rounded-full border border-transparent border-t-violet-400/60 animate-spin [animation-duration:0.7s] [animation-direction:reverse]" />
      </div>
      <p
        key={stepIndex}
        className="text-slate-500 text-sm tracking-wide transition-opacity duration-500"
        style={{ animation: 'fadeText 0.5s ease-out' }}
      >
        {steps[stepIndex]}
      </p>
    </div>
  )
}

function AnimatedBar({ target }: { target: number }) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setWidth(target), 100)
    return () => clearTimeout(t)
  }, [target])
  return (
    <div className="w-full bg-white/[0.05] rounded-full h-1 overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
        style={{ width: `${width}%`, transition: 'width 1s ease-out' }}
      />
    </div>
  )
}

function ResultsCard({ results, onRestart }: { results: Profession[]; onRestart: () => void }) {
  const ref = useFadeIn()
  return (
    <div ref={ref} className="relative bg-white/[0.04] backdrop-blur-2xl border border-white/[0.08] rounded-3xl p-10 max-w-md w-full space-y-7 shadow-[0_0_100px_rgba(99,102,241,0.1)]">
      <div className="text-center space-y-1">
        <p className="text-indigo-400 text-xs tracking-widest uppercase font-medium">Your Results</p>
        <h2 className="text-xl font-bold text-white/90">Recommended Careers</h2>
      </div>

      <div className="space-y-6">
        {results.map((r, i) => (
          <div key={i} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {i === 0 && (
                  <span className="shrink-0 text-[11px] bg-indigo-500/15 text-indigo-300 border border-indigo-500/25 rounded-full px-2 py-0.5 font-medium">
                    Top Match
                  </span>
                )}
                <span className="text-base font-semibold text-white/90 truncate">{r.profession}</span>
              </div>
              <span className="shrink-0 text-indigo-400 font-bold text-sm tabular-nums">{r.match_percentage}%</span>
            </div>
            <AnimatedBar target={r.match_percentage} />
            <p className="text-slate-400 text-sm leading-[1.75] tracking-[0.01em]">{r.explanation}</p>
          </div>
        ))}
      </div>

      <button
        onClick={onRestart}
        className="w-full py-3 bg-white/[0.04] border border-white/[0.08] text-slate-400 text-sm font-medium rounded-2xl hover:bg-white/[0.08] hover:text-white active:scale-[0.98] transition-all duration-300 ease-out"
      >
        ← Start over
      </button>
    </div>
  )
}

function QuizCard({ question, questionCount, progress, onAnswer }: {
  question: Question
  questionCount: number
  progress: number
  onAnswer: (opt: string) => void
}) {
  const ref = useFadeIn()
  return (
    <div ref={ref} className="relative bg-white/[0.04] backdrop-blur-2xl border border-white/[0.08] rounded-3xl p-10 max-w-sm w-full space-y-8 shadow-[0_0_100px_rgba(99,102,241,0.1)]">
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-slate-500">Question {questionCount}</span>
          <span className="text-indigo-400/80 font-medium tabular-nums">{Math.round(progress)}%</span>
        </div>
        <div className="w-full bg-white/[0.05] rounded-full h-[3px] overflow-hidden">
          <div
            className="bg-gradient-to-r from-indigo-500 to-violet-500 h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <h2 className="text-base font-semibold text-white/85 text-center leading-relaxed">
        {question.question}
      </h2>

      <div className="flex flex-col gap-2.5">
        {question.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => onAnswer(opt)}
            className="group w-full py-3 px-4 bg-white/[0.04] border border-white/[0.08] text-slate-300 rounded-2xl text-sm font-medium hover:bg-indigo-500/[0.08] hover:border-indigo-500/30 hover:text-white active:scale-[0.98] transition-all duration-300 ease-out text-left flex items-center gap-3"
          >
            <span className="w-6 h-6 rounded-lg bg-white/[0.04] border border-white/[0.08] group-hover:bg-indigo-500/15 group-hover:border-indigo-500/30 flex items-center justify-center text-xs text-slate-600 group-hover:text-indigo-300 transition-all duration-300 ease-out shrink-0 font-semibold">
              {String.fromCharCode(65 + i)}
            </span>
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}
