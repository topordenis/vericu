import { useEffect, useState } from 'react'
import vericu from './assets/vericu.png'

const DURATION = 10000
const TICK = 50

export default function LoadingScreen({ onFinish }) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - start
      const pct = Math.min(elapsed / DURATION, 1)
      setProgress(pct)
      if (pct >= 1) {
        clearInterval(interval)
        setTimeout(onFinish, 300)
      }
    }, TICK)
    return () => clearInterval(interval)
  }, [onFinish])

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-zinc-950">
      <img
        src={vericu}
        alt="vericu tuning"
        className="w-64 h-64 object-contain mb-8 drop-shadow-[0_0_30px_rgba(59,130,246,0.5)] animate-pulse"
      />

      <p className="text-blue-400 text-2xl font-bold mb-6 tracking-wide"
         style={{ fontFamily: 'monospace' }}>
        vericu incarca softul..
      </p>

      <div className="w-80 h-4 bg-zinc-800 rounded-full overflow-hidden border border-zinc-700">
        <div
          className="h-full bg-gradient-to-r from-blue-600 via-blue-400 to-cyan-400 rounded-full transition-all duration-100 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <p className="text-zinc-500 text-sm mt-3 font-mono">
        {Math.round(progress * 100)}%
      </p>
    </div>
  )
}
