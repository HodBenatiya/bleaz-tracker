import { useState } from 'react'
import { Plus, Trash2, CheckCircle2, Circle, AlertCircle, Clock, ChevronDown } from 'lucide-react'
import type { Task, TaskPriority } from '../types'
import { TASK_PRIORITY_LABELS } from '../types'
import { generateId, todayISO, formatDateHe } from '../utils/helpers'

interface Props {
  tasks:    Task[]
  onChange: (tasks: Task[]) => void
}

const ASSIGNEE_LABELS = { hod: 'הוד', tzachi: 'צחי', both: 'שניהם' }
const PRIORITY_COLORS: Record<TaskPriority, string> = {
  high:   'text-red-600 bg-red-50 border-red-200',
  medium: 'text-amber-600 bg-amber-50 border-amber-200',
  low:    'text-slate-500 bg-slate-50 border-slate-200',
}

const EMPTY = {
  title: '', assignee: 'both' as Task['assignee'],
  priority: 'medium' as TaskPriority, dueDate: todayISO(),
}

export default function Tasks({ tasks, onChange }: Props) {
  const [isAdding, setIsAdding] = useState(false)
  const [form,     setForm]     = useState({ ...EMPTY })
  const [filter,   setFilter]   = useState<'open' | 'done' | 'all'>('open')
  const [assigneeFilter, setAssigneeFilter] = useState<'all' | 'hod' | 'tzachi'>('all')

  const today = todayISO()

  function add() {
    if (!form.title.trim()) return
    const task: Task = { id: generateId(), ...form, done: false, createdAt: new Date().toISOString() }
    onChange([task, ...tasks])
    setIsAdding(false)
    setForm({ ...EMPTY })
  }

  function toggle(id: string) {
    onChange(tasks.map(t => t.id === id ? { ...t, done: !t.done } : t))
  }

  function remove(id: string) {
    onChange(tasks.filter(t => t.id !== id))
  }

  const filtered = tasks
    .filter(t => filter === 'all' ? true : filter === 'open' ? !t.done : t.done)
    .filter(t => assigneeFilter === 'all' ? true : t.assignee === assigneeFilter || t.assignee === 'both')
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      const pOrder = { high: 0, medium: 1, low: 2 }
      if (pOrder[a.priority] !== pOrder[b.priority]) return pOrder[a.priority] - pOrder[b.priority]
      return a.dueDate.localeCompare(b.dueDate)
    })

  const overdueCount = tasks.filter(t => !t.done && t.dueDate < today).length
  const openCount    = tasks.filter(t => !t.done).length

  return (
    <div className="max-w-2xl mx-auto pb-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-800">משימות ותזכורות</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {openCount} פתוחות
            {overdueCount > 0 && <span className="text-red-600 font-semibold mr-1"> · {overdueCount} באיחור</span>}
          </p>
        </div>
        <button onClick={() => { setIsAdding(true); setForm({ ...EMPTY }) }} className="btn-primary">
          <Plus size={16} /> הוסף משימה
        </button>
      </div>

      {/* Add form */}
      {isAdding && (
        <div className="card border border-brand-200 bg-brand-50/30 mb-5">
          <p className="font-semibold text-slate-700 mb-3">משימה חדשה</p>
          <div className="flex flex-col gap-3">
            <div>
              <label className="label">כותרת *</label>
              <input
                type="text" className="input-field" placeholder="מה צריך לעשות?"
                value={form.title} autoFocus
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && add()}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">אחראי</label>
                <select className="input-field text-sm" value={form.assignee}
                  onChange={e => setForm(f => ({ ...f, assignee: e.target.value as Task['assignee'] }))}>
                  <option value="hod">הוד</option>
                  <option value="tzachi">צחי</option>
                  <option value="both">שניהם</option>
                </select>
              </div>
              <div>
                <label className="label">עדיפות</label>
                <select className="input-field text-sm" value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value as TaskPriority }))}>
                  {(Object.entries(TASK_PRIORITY_LABELS) as [TaskPriority, string][]).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">תאריך יעד</label>
                <input type="date" className="input-field text-sm" value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={add} disabled={!form.title.trim()} className="btn-primary">
                <CheckCircle2 size={15} /> שמור
              </button>
              <button onClick={() => setIsAdding(false)} className="btn-secondary">ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {(['open','done','all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`nav-tab text-sm ${filter === f ? 'nav-tab-active' : 'nav-tab-inactive'}`}>
            {f === 'open' ? 'פתוחות' : f === 'done' ? 'בוצעו' : 'הכל'}
          </button>
        ))}
        <div className="h-5 w-px bg-slate-200 mx-1" />
        {(['all','hod','tzachi'] as const).map(a => (
          <button key={a} onClick={() => setAssigneeFilter(a)}
            className={`nav-tab text-sm ${assigneeFilter === a ? 'nav-tab-active' : 'nav-tab-inactive'}`}>
            {a === 'all' ? 'כולם' : a === 'hod' ? 'הוד' : 'צחי'}
          </button>
        ))}
      </div>

      {/* Tasks list */}
      {filtered.length === 0 ? (
        <div className="card text-center py-12 text-slate-400">
          <CheckCircle2 size={36} className="mx-auto mb-3 opacity-30" />
          <p className="font-semibold">אין משימות</p>
          <p className="text-sm mt-1">לחץ "הוסף משימה" להוספת המשימה הראשונה</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(task => {
            const isOverdue = !task.done && task.dueDate < today
            const isDueToday = !task.done && task.dueDate === today
            return (
              <div
                key={task.id}
                className={`card !p-0 overflow-hidden border-r-4 transition ${
                  task.done          ? 'border-r-slate-200 opacity-60' :
                  isOverdue          ? 'border-r-red-400' :
                  task.priority === 'high' ? 'border-r-red-400' :
                  task.priority === 'medium' ? 'border-r-amber-400' : 'border-r-slate-300'
                }`}
              >
                <div className="flex items-center gap-3 p-4">
                  <button onClick={() => toggle(task.id)} className="shrink-0 text-slate-400 hover:text-brand-600 transition">
                    {task.done
                      ? <CheckCircle2 size={22} className="text-emerald-500" />
                      : <Circle size={22} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium text-sm ${task.done ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                      {task.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`badge text-xs border ${PRIORITY_COLORS[task.priority]}`}>
                        {TASK_PRIORITY_LABELS[task.priority]}
                      </span>
                      <span className="badge badge-gray text-xs">
                        {ASSIGNEE_LABELS[task.assignee]}
                      </span>
                      <span className={`flex items-center gap-1 text-xs ${
                        isOverdue ? 'text-red-600 font-semibold' :
                        isDueToday ? 'text-amber-600 font-semibold' : 'text-slate-400'
                      }`}>
                        {isOverdue && <AlertCircle size={11} />}
                        {isDueToday && <Clock size={11} />}
                        {isOverdue ? 'באיחור · ' : isDueToday ? 'היום · ' : ''}
                        {new Date(task.dueDate + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => remove(task.id)} className="shrink-0 text-slate-300 hover:text-red-500 transition p-1">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
