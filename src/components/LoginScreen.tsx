import { useState } from 'react'
import { supabase } from '../utils/supabase'

interface Props {
  recovery?: boolean
  onPasswordSaved: () => void
}

export default function LoginScreen({ recovery, onPasswordSaved }: Props) {
  const [forgotOpen, setForgotOpen] = useState(false)
  const mode = recovery ? 'recovery' : forgotOpen ? 'forgot' : 'login'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const login = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (authError) setError('האימייל או הסיסמה לא נכונים.')
  }

  const sendReset = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + '/',
    })
    setBusy(false)
    if (authError) setError('לא הצלחנו לשלוח קישור לאיפוס. בדקו את האימייל ונסו שוב.')
    else setInfo('שלחנו קישור לאיפוס הסיסמה. פתחו את המייל מהמכשיר הזה.')
  }

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    if (nextPassword.length < 8) {
      setError('הסיסמה החדשה צריכה לפחות 8 תווים.')
      return
    }
    setBusy(true)
    setError('')
    const { error: authError } = await supabase.auth.updateUser({ password: nextPassword })
    setBusy(false)
    if (authError) setError('לא הצלחנו לעדכן את הסיסמה. בקשו קישור חדש.')
    else onPasswordSaved()
  }

  const title = mode === 'recovery' ? 'סיסמה חדשה' : mode === 'forgot' ? 'איפוס סיסמה' : 'כניסה למערכת'
  const submit = mode === 'recovery' ? savePassword : mode === 'forgot' ? sendReset : login

  return (
    <div className="min-h-screen bg-[#F3F4F6] flex items-center justify-center p-4" dir="rtl">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center">
            <span className="text-white font-black">B</span>
          </div>
          <div>
            <p className="font-black text-slate-800 leading-none">BLEAZ</p>
            <p className="text-xs text-slate-400 mt-1">{title}</p>
          </div>
        </div>
        {mode !== 'recovery' && (
          <label className="block text-sm text-slate-600 mb-3">
            אימייל
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              className="input-field mt-1"
            />
          </label>
        )}
        {mode === 'login' && (
          <label className="block text-sm text-slate-600 mb-3">
            סיסמה
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="input-field mt-1"
            />
          </label>
        )}
        {mode === 'recovery' && (
          <label className="block text-sm text-slate-600 mb-3">
            סיסמה חדשה
            <input
              name="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={nextPassword}
              onChange={event => setNextPassword(event.target.value)}
              className="input-field mt-1"
            />
          </label>
        )}
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        {info && <p className="text-sm text-emerald-700 mb-3">{info}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
          {busy ? 'רגע…' : mode === 'recovery' ? 'שמירת סיסמה' : mode === 'forgot' ? 'שליחת קישור' : 'כניסה'}
        </button>
        {mode === 'login' && (
          <button type="button" onClick={() => { setError(''); setInfo(''); setForgotOpen(true) }} className="mt-4 text-sm text-slate-500 hover:text-slate-800 w-full">
            שכחתי סיסמה
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" onClick={() => { setError(''); setInfo(''); setForgotOpen(false) }} className="mt-4 text-sm text-slate-500 hover:text-slate-800 w-full">
            חזרה לכניסה
          </button>
        )}
      </form>
    </div>
  )
}
