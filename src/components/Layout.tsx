import React from 'react'
import { BarChart2, ClipboardList, History, Briefcase, GitBranch, CheckSquare, Users, TrendingUp, Database, LayoutDashboard, LineChart } from 'lucide-react'
import type { View, Task } from '../types'

interface Props {
  view:     View
  onNav:    (v: View) => void
  children: React.ReactNode
  onNewDay: () => void
  tasks:    Task[]
}

const PAGE_SUB: Record<View, string> = {
  dashboard:  'סקירה יומית, שבועית, חודשית ולפי חברה',
  form:       'הזן את נתוני היום',
  positions:  'ניהול המשרות הקבועות שמופיעות בכל דיווח',
  pipeline:   'מעקב אחרי חברות בתהליך גיוס — פייפליין של צחי',
  history:    'כל הדיווחים היומיים השמורים',
  tasks:      'משימות ותזכורות לשני השותפים',
  candidates: 'מועמדים בכל שלבי התהליך — מליד עד הצבה',
  marketing:  'ROI לפי קמפיין, עלות לליד, עלות להצבה',
  data:       'כל המועמדים — חיפוש חופשי לפי כל שדה',
  board:      'מצב עדכני לפי משרה — כל הנתונים בזמן אמת',
  management: 'KPIs חודשיים, יעדים, גבייה, אחריות ורווחיות',
}

const SIDEBAR_W = 'w-52' // 208px

export default function Layout({ view, onNav, children, onNewDay, tasks }: Props) {
  const today       = new Date().toISOString().split('T')[0]
  const openTasks   = tasks.filter(t => !t.done)
  const urgentCount = openTasks.filter(t => t.dueDate <= today).length

  const TABS: { id: View; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'management', label: 'דשבורד ניהול', icon: <LineChart   size={16} /> },
    { id: 'dashboard',  label: 'דשבורד',     icon: <BarChart2    size={16} /> },
    { id: 'board',      label: 'לוח בקרה',  icon: <LayoutDashboard size={16} /> },
    { id: 'candidates', label: 'מועמדים',    icon: <Users        size={16} /> },
    { id: 'data',       label: 'דאטה',       icon: <Database     size={16} /> },
    { id: 'positions',  label: 'משרות',      icon: <Briefcase    size={16} /> },
    { id: 'marketing',  label: 'שיווק ROI',  icon: <TrendingUp   size={16} /> },
    { id: 'form',       label: 'דיווח יומי', icon: <ClipboardList size={16} /> },
    { id: 'pipeline',   label: 'פייפליין',   icon: <GitBranch    size={16} /> },
    { id: 'tasks',      label: 'משימות',     icon: <CheckSquare  size={16} />, badge: urgentCount },
    { id: 'history',    label: 'היסטוריה',   icon: <History      size={16} /> },
  ]

  const currentTab = TABS.find(t => t.id === view)

  return (
    <div className="min-h-screen bg-[#F3F4F6] flex" dir="rtl">

      {/* ── Fixed right sidebar (RTL start side) ── */}
      <aside className={`fixed right-0 top-0 bottom-0 ${SIDEBAR_W} bg-[#1E293B] z-50 flex flex-col shadow-2xl`}>

        {/* Brand */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
            <span className="text-white font-black text-sm">B</span>
          </div>
          <div>
            <p className="font-black text-white leading-none tracking-wider text-sm">BLEAZ</p>
            <p className="text-[10px] text-slate-400 leading-none mt-0.5">מערכת גיוס</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2.5 space-y-0.5 overflow-y-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => tab.id === 'form' ? onNewDay() : onNav(tab.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all relative text-right
                ${view === tab.id
                  ? 'bg-brand-600 text-white shadow-md'
                  : 'text-slate-400 hover:bg-white/10 hover:text-white'}`}
            >
              <span className="shrink-0">{tab.icon}</span>
              <span className="truncate">{tab.label}</span>
              {tab.badge != null && tab.badge > 0 && (
                <span className="mr-auto min-w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 shrink-0">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/10">
          <p className="text-[10px] text-slate-600 text-center">BLEAZ © 2025</p>
        </div>
      </aside>

      {/* ── Main content (shifted left of sidebar) ── */}
      <div className={`flex-1 mr-52 min-h-screen flex flex-col`}>

        {/* Slim top bar — page title only */}
        <div className="bg-white border-b border-slate-200 px-6 py-3.5 sticky top-0 z-40 flex items-center gap-3">
          <div className="text-slate-400">{currentTab?.icon}</div>
          <div>
            <h1 className="text-base font-bold text-slate-800 leading-none">{currentTab?.label}</h1>
            <p className="text-[11px] text-slate-400 mt-0.5">{PAGE_SUB[view]}</p>
          </div>
        </div>

        <main className="flex-1 p-5">
          {children}
        </main>
      </div>
    </div>
  )
}
