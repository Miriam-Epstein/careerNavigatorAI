import { useEffect, useState } from 'react'

type Question = {
  question: string
  options: string[]
}

type Profession = {
  profession: string
  match_percentage: number
  explanation: string
}

type Phase = 'intro' | 'loading' | 'quiz' | 'analyzing' | 'results'

export default function App() {
  const [phase, setPhase] = useState<Phase>('intro')
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<string[]>([])
  const [step, setStep] = useState(0)
  const [results, setResults] = useState<Profession[]>([])
  const [userText, setUserText] = useState('')

  const loadQuestions = (text: string) => {
    setPhase('loading')
    setAnswers([])
    setStep(0)
    setResults([])
    fetch('/api/generate-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userText: text }),
    })
      .then(r => r.json())
      .then(data => { setQuestions(data); setPhase('quiz') })
  }

  const restart = () => { setUserText(''); setPhase('intro') }

  useEffect(() => {}, [])

  const handleAnswer = (option: string) => {
    const newAnswers = [...answers, option]
    setAnswers(newAnswers)

    if (step + 1 < questions.length) {
      setStep(s => s + 1)
    } else {
      setPhase('analyzing')
      fetch('/api/analyze-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions, answers: newAnswers, userText }),
      })
        .then(r => r.json())
        .then(data => { setResults(data); setPhase('results') })
    }
  }

  if (phase === 'intro') return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 p-6">
      <div className="bg-white rounded-3xl shadow-[0_8px_40px_rgba(0,0,0,0.08)] p-10 max-w-sm w-full space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-slate-800">career</span>
            <span className="text-indigo-600">Navigator</span>
            <span className="text-slate-800">AI</span>
          </h1>
          <p className="text-slate-400 text-xs tracking-widest mt-1">מצא את הקריירה שמתאימה לך</p>
        </div>
        <p className="text-slate-600 text-sm text-center">ספר לנו קצת על עצמך, תחומי העניין שלך, כישוריך, או מה שחשוב לך בעבודה</p>
        <textarea
          className="w-full rounded-2xl border border-slate-200 p-4 text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
          rows={4}
          placeholder="לדוגמה: אני אוהב לעבוד עם אנשים, יש לי כישורים טכניים..."
          value={userText}
          onChange={e => setUserText(e.target.value)}
          dir="rtl"
        />
        <button
          onClick={() => loadQuestions(userText)}
          disabled={!userText.trim()}
          className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-full hover:bg-indigo-700 active:scale-95 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          המשך
        </button>
      </div>
    </div>
  )

  if (phase === 'loading' || phase === 'analyzing') return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <span className="text-slate-400 text-sm tracking-wide">
        {phase === 'loading' ? 'טוען שאלות...' : 'מנתח תוצאות...'}
      </span>
    </div>
  )

  if (phase === 'results') return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 p-6">
      <div className="bg-white rounded-3xl shadow-[0_8px_40px_rgba(0,0,0,0.08)] p-10 max-w-md w-full space-y-6">
        <p className="text-slate-400 text-sm tracking-widest uppercase text-center">המקצועות המומלצים עבורך</p>
        {results.map((r, i) => (
          <div key={i} className="space-y-1 border-b border-slate-100 pb-4 last:border-0">
            <div className="flex justify-between items-center">
              <span className="text-lg font-bold text-slate-800">{r.profession}</span>
              <span className="text-indigo-600 font-semibold text-sm">{r.match_percentage}%</span>
            </div>
            <p className="text-slate-500 text-sm leading-relaxed">{r.explanation}</p>
          </div>
        ))}
        <button
          onClick={restart}
          className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-full hover:bg-indigo-700 active:scale-95 transition-all duration-150"
        >
          התחל מחדש
        </button>
      </div>
    </div>
  )

  const progress = (step / questions.length) * 100

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 p-6 gap-6">

      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="text-slate-800">career</span>
          <span className="text-indigo-600">Navigator</span>
          <span className="text-slate-800">AI</span>
        </h1>
        <p className="text-slate-400 text-xs tracking-widest mt-1">מצא את הקריירה שמתאימה לך</p>
      </div>

      <div className="bg-white rounded-3xl shadow-[0_8px_40px_rgba(0,0,0,0.08)] p-10 max-w-sm w-full space-y-8">

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-400">
            <span>שאלה {step + 1}</span>
            <span>{questions.length}</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-indigo-500 h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <h2 className="text-xl font-semibold text-slate-800 text-center leading-relaxed">
          {questions[step].question}
        </h2>

        <div className="flex flex-col gap-3">
          {questions[step].options.map((opt, i) => (
            <button
              key={i}
              onClick={() => handleAnswer(opt)}
              className="w-full py-3 px-4 bg-slate-100 text-slate-700 rounded-2xl text-base font-medium hover:bg-indigo-50 hover:text-indigo-700 active:scale-95 transition-all duration-150 text-right"
            >
              {opt}
            </button>
          ))}
        </div>

      </div>
    </div>
  )
}
