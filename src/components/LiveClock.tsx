import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'

const TZ = 'Asia/Jerusalem'

const timeFmt = new Intl.DateTimeFormat('he-IL', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})
const dateFmt = new Intl.DateTimeFormat('he-IL', {
  timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
})

export default function LiveClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    // Align ticks to the start of each second so the display never lags
    let interval: ReturnType<typeof setInterval>
    const timeout = setTimeout(() => {
      setNow(new Date())
      interval = setInterval(() => setNow(new Date()), 1000)
    }, 1000 - (Date.now() % 1000))
    return () => { clearTimeout(timeout); clearInterval(interval) }
  }, [])

  return (
    <div className="mr-auto flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
      <Clock size={16} className="text-brand-600 shrink-0" />
      <div className="text-left leading-none">
        <p className="text-sm font-bold text-slate-800 tabular-nums" dir="ltr">{timeFmt.format(now)}</p>
        <p className="text-[11px] text-slate-400 mt-1">{dateFmt.format(now)}</p>
      </div>
    </div>
  )
}
