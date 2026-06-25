import { useEffect, useState } from 'react'

type Question = {
  id: number
  text: string
  weights: Record<string, number>
}

type AppData = {
  questions: Question[]
  professions: Record<string, string>
}

export default function App() {
  const [data, setData] = useState<AppData | null>(null)
  const [step, setStep] = useState(0)
  const [scores, setScores] = useState<Record<string, number>>({})

  useEffect(() => {
    fetch('/data.json').then(r => r.json()).then(setData)
  }, [])

  if (!data) return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <span className="text-slate-400 text-sm tracking-wide">טוען...</span>
    </div>
  )

  const { questions, professions } = data

  const handleAnswer = (yes: boolean) => {
    if (yes) {
      const weights = questions[step].weights
      setScores(prev => {
        const next = { ...prev }
        for (const [key, val] of Object.entries(weights)) {
          next[key] = (next[key] ?? 0) + val
        }
        return next
      })
    }
    setStep(s => s + 1)
  }

  const restart = () => { setStep(0); setScores({}) }

  if (step >= questions.length) {
    const topKey = Object.keys(professions).reduce((a, b) => (scores[a] ?? 0) >= (scores[b] ?? 0) ? a : b)
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 p-6">
        <div className="bg-white rounded-3xl shadow-[0_8px_40px_rgba(0,0,0,0.08)] p-12 max-w-sm w-full text-center space-y-5">
          <p className="text-slate-400 text-sm tracking-widest uppercase">המקצוע המומלץ עבורך</p>
          <h1 className="text-4xl font-bold text-slate-800 leading-tight">{professions[topKey]}</h1>
          <button
            onClick={restart}
            className="mt-2 px-8 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-full hover:bg-indigo-700 active:scale-95 transition-all duration-150"
          >
            התחל מחדש
          </button>
        </div>
      </div>
    )
  }

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
          {questions[step].text}
        </h2>

        <div className="flex gap-3">
          <button
            onClick={() => handleAnswer(true)}
            className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl text-base font-medium hover:bg-indigo-700 active:scale-95 shadow-[0_4px_14px_rgba(99,102,241,0.35)] transition-all duration-150"
          >
            כן
          </button>
          <button
            onClick={() => handleAnswer(false)}
            className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl text-base font-medium hover:bg-slate-200 active:scale-95 transition-all duration-150"
          >
            לא
          </button>
        </div>

      </div>
    </div>
  )
}
