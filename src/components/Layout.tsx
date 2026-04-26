import React from 'react'
import { BarChart2, ClipboardList, History, Briefcase, GitBranch, CheckSquare } from 'lucide-react'
import type { View, Task } from '../types'

interface Props {
  view:     View
  onNav:    (v: View) => void
  children: React.ReactNode
  onNewDay: () => void
  tasks:    Task[]
}

const PAGE_SUB: Record<View, string> = {
  dashboard: 'סקירה יומית, שבועית, חודשית ולפי חברה',
  form:      'הזן את נתוני היום',
  positions: 'ניהול המשרות הקבועות שמופיעות בכל דיווח',
  pipeline:  'מעקב אחרי חברות בתהליך גיוס — פייפליין של צחי',
  history:   'כל הדיווחים היומיים השמורים',
  tasks:     'משימות ותזכורות לשני השותפים',
}

export default function Layout({ view, onNav, children, onNewDay, tasks }: Props) {
  const today        = new Date().toISOString().split('T')[0]
  const openTasks    = tasks.filter(t => !t.done)
  const urgentCount  = openTasks.filter(t => t.dueDate <= today).length

  const TABS: { id: View; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'dashboard', label: 'דשבורד',      icon: <BarChart2 size={16} /> },
    { id: 'form',      label: 'דיווח יומי',  icon: <ClipboardList size={16} /> },
    { id: 'positions', label: 'משרות',        icon: <Briefcase size={16} /> },
    { id: 'pipeline',  label: 'פייפליין',     icon: <GitBranch size={16} /> },
    { id: 'tasks',     label: 'משימות',       icon: <CheckSquare size={16} />, badge: urgentCount },
    { id: 'history',   label: 'היסטוריה',    icon: <History size={16} /> },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
                <span className="text-white font-black text-xs">B</span>
              </div>
              <div>
                <p className="font-black text-brand-700 leading-none tracking-wide">BLEAZ</p>
                <p className="text-[10px] text-slate-400 leading-none">מערכת גיוס</p>
              </div>
            </div>
            <nav className="flex items-center gap-1">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => tab.id === 'form' ? onNewDay() : onNav(tab.id)}
                  className={`nav-tab flex items-center gap-1.5 relative ${view === tab.id ? 'nav-tab-active' : 'nav-tab-inactive'}`}
                >
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.label}</span>
                  {tab.badge != null && tab.badge > 0 && (
                    <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <div className="bg-gradient-to-l from-brand-700 to-brand-900 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
          <h1 className="text-xl font-bold">{TABS.find(t => t.id === view)?.label}</h1>
          <p className="text-brand-200 text-sm mt-0.5">{PAGE_SUB[view]}</p>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>
    </div>
  )
}
