import type { Candidate, SavedPosition } from '../types'

/** Blank candidate, same fields the Candidates tab starts with. */
export function emptyCandidate(now = new Date().toISOString()): Candidate {
  return {
    id: crypto.randomUUID(),
    name: '',
    phone: '',
    status: 'new',
    positionType: '',
    source: '',
    nonaStatus: '',
    cvUrl: '',
    cvFileName: '',
    notes: '',
    savedPositionIds: [],
    noteHistory: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** The Candidates tab save: interview dates, archived interviews, then insert or replace. */
export function applyCandidateSave(candidates: Candidate[], draft: Candidate, positions: SavedPosition[]): Candidate[] {
  const todayStr = new Date().toISOString().split('T')[0]
  const prev = candidates.find(item => item.id === draft.id)
  let candidate = { ...draft }

  if (prev?.status !== candidate.status) {
    if (candidate.status === 'interview_scheduled' && !candidate.interviewDate)
      candidate = { ...candidate, interviewDate: todayStr }
    if (candidate.status === 'started_working' && !candidate.startDate)
      candidate = { ...candidate, startDate: todayStr }
  }

  if (prev?.status === 'interview_scheduled' && prev.interviewDate) {
    const prevIds = [...(prev.savedPositionIds ?? (prev.savedPositionId ? [prev.savedPositionId] : []))].sort()
    const newIds = [...(candidate.savedPositionIds ?? (candidate.savedPositionId ? [candidate.savedPositionId] : []))].sort()
    const companyChanged = JSON.stringify(prevIds) !== JSON.stringify(newIds)
    const statusLeft = candidate.status !== 'interview_scheduled'
    if (companyChanged || statusLeft) {
      const prevPos = prevIds.map(id => positions.find(item => item.id === id)).find(Boolean)
      candidate = {
        ...candidate,
        interviewHistory: [...(prev.interviewHistory ?? []), {
          id: crypto.randomUUID(),
          date: prev.interviewDate,
          time: prev.interviewTime,
          companyName: prevPos?.companyName ?? prev.positionType ?? 'לא ידוע',
          positionTitle: prevPos?.positionTitle,
          savedPositionId: prevIds[0],
          createdAt: new Date().toISOString(),
        }],
      }
    }
  }

  const updated = { ...candidate, updatedAt: new Date().toISOString() }
  const exists = candidates.some(item => item.id === updated.id)
  return exists
    ? candidates.map(item => item.id === updated.id ? updated : item)
    : [...candidates, updated]
}
