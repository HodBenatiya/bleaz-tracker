import { useState, useEffect, useCallback } from 'react'
import type { View, DailyReport, SavedPosition, PipelineCompany, Task, Candidate } from './types'
import {
  loadReports, upsertReport, deleteReport,
  loadPositions, savePositions,
  loadPipeline,  savePipeline,
  loadTasks,     saveTasks,
  loadCandidates, upsertCandidate, deleteCandidate,
  migrateFromLocalStorage,
} from './utils/storage'
import { supabase } from './utils/supabase'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import DailyForm from './components/DailyForm'
import History from './components/History'
import PositionsManager from './components/PositionsManager'
import Pipeline from './components/Pipeline'
import Tasks from './components/Tasks'
import Candidates from './components/Candidates'
import MarketingROI from './components/MarketingROI'
import DataView from './components/DataView'
import Board from './components/Board'
import Management from './components/Management'

// ── Local upsert helper (keeps state consistent before DB responds) ──
function localUpsert(reports: DailyReport[], report: DailyReport): DailyReport[] {
  const byId   = reports.findIndex(r => r.id === report.id)
  if (byId >= 0) { const u = [...reports]; u[byId] = report; return u }
  const byDate = reports.findIndex(r => r.date === report.date)
  if (byDate >= 0) { const u = [...reports]; u[byDate] = { ...report, id: reports[byDate].id }; return u }
  return [...reports, report]
}

export default function App() {
  const [view,          setView]          = useState<View>('management')
  const [reports,       setReports]       = useState<DailyReport[]>([])
  const [positions,     setPositions]     = useState<SavedPosition[]>([])
  const [pipeline,      setPipeline]      = useState<PipelineCompany[]>([])
  const [tasks,         setTasks]         = useState<Task[]>([])
  const [candidates,    setCandidates]    = useState<Candidate[]>([])
  const [editingReport, setEditingReport] = useState<DailyReport | null>(null)
  const [loading,       setLoading]       = useState(true)

  // ── Initial data load + optional localStorage migration ──
  useEffect(() => {
    async function init() {
      setLoading(true)
      const [r, p, pl, t, c] = await Promise.all([
        loadReports(), loadPositions(), loadPipeline(), loadTasks(), loadCandidates(),
      ])

      if (r.length === 0 && p.length === 0 && pl.length === 0 && t.length === 0) {
        // DB is empty — try migrating from localStorage
        const migrated = await migrateFromLocalStorage()
        setReports(migrated.reports)
        setPositions(migrated.positions)
        setPipeline(migrated.pipeline)
        setTasks(migrated.tasks)
      } else {
        setReports(r)
        setPositions(p)
        setPipeline(pl)
        setTasks(t)
      }
      setCandidates(c)
      setLoading(false)
    }
    init()
  }, [])

  // ── Real-time subscriptions (sync between Hod and Tzachi) ──
  useEffect(() => {
    const channel = supabase.channel('bleaz-realtime')

      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reports' }, payload => {
        const report = (payload.new as { data: DailyReport }).data
        setReports(prev => prev.some(r => r.id === report.id) ? prev : [...prev, report])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'reports' }, payload => {
        const report = (payload.new as { data: DailyReport }).data
        setReports(prev => prev.map(r => r.id === report.id ? report : r))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reports' }, payload => {
        setReports(prev => prev.filter(r => r.id !== (payload.old as { id: string }).id))
      })

      .on('postgres_changes', { event: '*', schema: 'public', table: 'positions' }, () => {
        loadPositions().then(setPositions)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pipeline_companies' }, () => {
        loadPipeline().then(setPipeline)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        loadTasks().then(setTasks)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'candidates' }, payload => {
        const c = (payload.new as { data: Candidate }).data
        if (!c?.id) return
        setCandidates(prev => prev.some(x => x.id === c.id) ? prev : [...prev, c])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'candidates' }, payload => {
        const c = (payload.new as { data: Candidate }).data
        if (!c?.id) return
        setCandidates(prev => prev.map(x => x.id === c.id ? c : x))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'candidates' }, payload => {
        const id = (payload.old as { id: string }).id
        setCandidates(prev => prev.filter(x => x.id !== id))
      })

      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Handlers ──
  const handleSave = useCallback((report: DailyReport) => {
    setReports(prev => localUpsert(prev, report))
    upsertReport(report)
  }, [])

  const handleDelete = useCallback((id: string) => {
    setReports(prev => prev.filter(r => r.id !== id))
    deleteReport(id)
  }, [])

  const handleEdit    = useCallback((report: DailyReport) => { setEditingReport(report); setView('form') }, [])
  const handleNewDay  = useCallback(() => { setEditingReport(null); setView('form') }, [])
  const handleNav     = useCallback((v: View) => { setView(v); if (v !== 'form') setEditingReport(null) }, [])

  const handlePositionsChange = useCallback((newPositions: SavedPosition[]) => {
    setPositions(newPositions)
    savePositions(newPositions)
  }, [])

  const handlePipelineChange = useCallback((newPipeline: PipelineCompany[]) => {
    setPipeline(newPipeline)
    savePipeline(newPipeline)
  }, [])

  const handleTasksChange = useCallback((newTasks: Task[]) => {
    setTasks(newTasks)
    saveTasks(newTasks)
  }, [])

  const handleCandidatesChange = useCallback(async (newCandidates: Candidate[]) => {
    const prevIds = candidates.map(c => c.id)
    const newIds  = newCandidates.map(c => c.id)

    // שמור רק מועמדים שבאמת השתנו — מונע דריסת שינויים של השותף
    const changed = newCandidates.filter(nc => {
      const prev = candidates.find(c => c.id === nc.id)
      if (!prev) return true
      return JSON.stringify(prev) !== JSON.stringify(nc)
    })
    const removed = prevIds.filter(id => !newIds.includes(id))

    try {
      if (changed.length > 0)  await Promise.all(changed.map(c => upsertCandidate(c)))
      if (removed.length > 0)  await Promise.all(removed.map(id => deleteCandidate(id)))
      setCandidates(newCandidates)
    } catch (err) {
      console.error('שגיאה בשמירת מועמד:', err)
      alert('שגיאה בשמירה: ' + (err instanceof Error ? err.message : 'נסה שוב'))
    }
  }, [candidates])

  // ── Loading screen ──
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50" dir="rtl">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 font-medium">טוען נתונים...</p>
        </div>
      </div>
    )
  }

  return (
    <Layout view={view} onNav={handleNav} onNewDay={handleNewDay} tasks={tasks}>
      {view === 'dashboard' && (
        <Dashboard
          reports={reports}
          positions={positions}
          pipeline={pipeline}
          tasks={tasks}
          candidates={candidates}
          onNav={v => handleNav(v)}
        />
      )}
      {view === 'form' && (
        <DailyForm
          reports={reports}
          savedPositions={positions}
          pipeline={pipeline}
          editingReport={editingReport}
          onSave={handleSave}
          onGoToPositions={() => handleNav('positions')}
        />
      )}
      {view === 'positions' && (
        <PositionsManager positions={positions} reports={reports} candidates={candidates} onChange={handlePositionsChange} />
      )}
      {view === 'pipeline'   && <Pipeline pipeline={pipeline} onChange={handlePipelineChange} />}
      {view === 'tasks'      && <Tasks    tasks={tasks}       onChange={handleTasksChange} />}
      {view === 'history'    && <History  reports={reports}   onEdit={handleEdit} onDelete={handleDelete} />}
      {view === 'candidates' && <Candidates candidates={candidates} positions={positions} onChange={handleCandidatesChange} />}
      {view === 'marketing'  && <MarketingROI reports={reports} candidates={candidates} positions={positions} />}
      {view === 'data'       && <DataView candidates={candidates} positions={positions} onChange={handleCandidatesChange} />}
      {view === 'board'      && <Board positions={positions} candidates={candidates} />}
      {view === 'management' && <Management candidates={candidates} positions={positions} reports={reports} onCandidatesChange={handleCandidatesChange} />}
    </Layout>
  )
}
