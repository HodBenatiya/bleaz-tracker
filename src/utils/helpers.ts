import type { DailyReport } from '../types'

export function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayISO(): string {
  return toISODate(new Date())
}

export function formatDateHe(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatDateShortHe(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })
}

export function getDayNameHe(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('he-IL', { weekday: 'short' })
}

export function formatMonthHe(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
}

export function formatCurrency(amount: number): string {
  return `₪${amount.toLocaleString('he-IL')}`
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function calcCostPerLead(cost: number, leads: number): number {
  if (leads <= 0) return 0
  return Math.round((cost / leads) * 10) / 10
}

export function calcRevenue(placements: number): number {
  return placements * 5000
}

// Returns Sunday of the week containing date
export function getWeekStart(date: Date = new Date()): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

// Business week: Sunday–Thursday (0–4)
export function getWeekDates(weekStart: Date): string[] {
  return [0, 1, 2, 3, 4].map(i => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return toISODate(d)
  })
}

export function newEmptyReport(date?: string): DailyReport {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    date: date ?? todayISO(),
    createdAt: now,
    updatedAt: now,
    jobs: [],
    screeningCalls: 0,
    nonaUsersRegistered: 0,
    hodBlockers: '',
    outreachSent: 0,
    companiesNearClose: 0,
    newClientsSigned: 0,
    tzachiBlockers: '',
    activeClients: [],
    generalNotes: '',
  }
}

export function sortedReports(reports: DailyReport[]): DailyReport[] {
  return [...reports].sort((a, b) => b.date.localeCompare(a.date))
}

export function reportForDate(reports: DailyReport[], date: string): DailyReport | undefined {
  return reports.find(r => r.date === date)
}

export function reportsForWeek(reports: DailyReport[], weekStart: Date): DailyReport[] {
  const dates = getWeekDates(weekStart)
  return reports.filter(r => dates.includes(r.date))
}

export function reportsForMonth(reports: DailyReport[], year: number, month: number): DailyReport[] {
  return reports.filter(r => {
    const d = new Date(r.date + 'T12:00:00')
    return d.getFullYear() === year && d.getMonth() === month
  })
}

export function sumField(
  reports: DailyReport[],
  field: 'outreachSent' | 'screeningCalls' | 'nonaUsersRegistered'
       | 'newClientsSigned' | 'companiesNearClose',
): number {
  return reports.reduce((s, r) => s + ((r[field] as number) ?? 0), 0)
}

export function totalJobStats(reports: DailyReport[]): { cost: number; leads: number; relevant: number } {
  let cost = 0, leads = 0, relevant = 0
  for (const r of reports) {
    for (const j of r.jobs) {
      cost += j.campaignCost
      leads += j.leadsIn
      relevant += j.relevantLeads
    }
  }
  return { cost, leads, relevant }
}

export interface CompanyStat {
  companyName: string
  positions: string[]
  totalCost: number
  totalLeads: number
  totalRelevant: number
  costPerLead: number
  daysActive: number
}

export function aggregateByCompany(reports: DailyReport[]): CompanyStat[] {
  const map = new Map<string, CompanyStat>()
  for (const r of reports) {
    for (const j of r.jobs) {
      const key = j.companyName.trim()
      if (!key) continue
      if (!map.has(key)) {
        map.set(key, {
          companyName: key, positions: [], totalCost: 0,
          totalLeads: 0, totalRelevant: 0, costPerLead: 0, daysActive: 0,
        })
      }
      const s = map.get(key)!
      s.totalCost    += j.campaignCost
      s.totalLeads   += j.leadsIn
      s.totalRelevant += j.relevantLeads
      s.daysActive++
      if (j.positionTitle && !s.positions.includes(j.positionTitle))
        s.positions.push(j.positionTitle)
    }
  }
  for (const s of map.values()) s.costPerLead = calcCostPerLead(s.totalCost, s.totalLeads)
  return Array.from(map.values()).sort((a, b) => b.totalLeads - a.totalLeads)
}

export function trendDirection(positions: SavedPosition[]): 'up' | 'down' | 'stable' {
  // trend based on confirmed placements across all positions
  const total = positions.reduce((s, p) => s + p.funnelConfirmed, 0)
  if (total === 0) return 'stable'
  // simple: if any position has confirmed > accepted ratio improving we call it up
  const ratio = positions.length > 0
    ? positions.reduce((s, p) => s + (p.funnelAccepted > 0 ? p.funnelConfirmed / p.funnelAccepted : 0), 0) / positions.length
    : 0
  if (ratio >= 0.6) return 'up'
  if (ratio < 0.3 && total > 0) return 'down'
  return 'stable'
}

// ── Conversion funnel — built from positions (not daily reports) ──
export interface FunnelData {
  leads:      number
  relevant:   number
  sent:       number
  interviews: number
  accepted:   number
  confirmed:  number   // passed probation = revenue
  // conversion rates (0–100)
  leadsToRelevant:    number
  relevantToSent:     number
  sentToInterview:    number
  interviewToAccept:  number
  acceptToConfirmed:  number
  overallConversion:  number
}

export function calcFunnelFromPositions(
  reports:   DailyReport[],
  positions: SavedPosition[],
): FunnelData {
  const leads    = reports.reduce((s, r) => s + r.jobs.reduce((ss, j) => ss + j.leadsIn, 0), 0)
  const relevant = reports.reduce((s, r) => s + r.jobs.reduce((ss, j) => ss + j.relevantLeads, 0), 0)
  const sent       = positions.reduce((s, p) => s + p.funnelSentToClient, 0)
  const interviews = positions.reduce((s, p) => s + p.funnelInterviews, 0)
  const accepted   = positions.reduce((s, p) => s + p.funnelAccepted, 0)
  const confirmed  = positions.reduce((s, p) => s + p.funnelConfirmed, 0)

  const pct = (num: number, den: number) => den > 0 ? Math.round((num / den) * 100) : 0

  return {
    leads, relevant, sent, interviews, accepted, confirmed,
    leadsToRelevant:   pct(relevant,   leads),
    relevantToSent:    pct(sent,       relevant),
    sentToInterview:   pct(interviews, sent),
    interviewToAccept: pct(accepted,   interviews),
    acceptToConfirmed: pct(confirmed,  accepted),
    overallConversion: pct(confirmed,  leads),
  }
}

// Funnel for a single position (pass all reports for that position)
export function calcFunnelForPosition(
  reports:  DailyReport[],
  position: SavedPosition,
): FunnelData {
  const posReports = reports.filter(r => r.jobs.some(j => j.savedPositionId === position.id))
  return calcFunnelFromPositions(posReports, [position])
}

// ── Monthly forecast — based on confirmed placements from positions ──
export interface ForecastData {
  daysElapsed:       number
  daysInMonth:       number
  daysRemaining:     number
  confirmedTotal:    number  // total confirmed placements (all time from positions)
  projected:         number
  onTrack:           boolean
  neededPerDay:      number
}

export function calcMonthForecast(
  positions: SavedPosition[],
  year: number,
  month: number,
): ForecastData {
  const today       = new Date()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month
  const daysElapsed = isCurrentMonth ? today.getDate() : daysInMonth
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed)

  // confirmed placements come from positions (not time-bound)
  const confirmedTotal = positions.reduce((s, p) => s + p.funnelConfirmed, 0)

  // project based on daily rate this month
  const dailyRate  = daysElapsed > 0 ? confirmedTotal / daysElapsed : 0
  const projected  = Math.round(dailyRate * daysInMonth * 10) / 10
  const neededPerDay = daysRemaining > 0
    ? Math.round(((12 - confirmedTotal) / daysRemaining) * 10) / 10
    : 0

  return {
    daysElapsed, daysInMonth, daysRemaining,
    confirmedTotal, projected,
    onTrack: projected >= 12,
    neededPerDay: Math.max(0, neededPerDay),
  }
}

// ── ROI ──
export interface RoiData {
  totalRevenue:          number
  totalCampaignCost:     number
  netProfit:             number
  costPerPlacement:      number
  revenuePerCostShekels: number
  roi:                   number
}

export function calcRoi(reports: DailyReport[], positions: SavedPosition[]): RoiData {
  const totalCampaignCost = reports.reduce((s, r) => s + r.jobs.reduce((ss, j) => ss + j.campaignCost, 0), 0)
  const placements        = positions.reduce((s, p) => s + p.funnelConfirmed, 0)
  const totalRevenue      = calcRevenue(placements)
  const netProfit         = totalRevenue - totalCampaignCost
  const costPerPlacement  = placements > 0 ? Math.round(totalCampaignCost / placements) : 0
  const roi               = totalCampaignCost > 0 ? Math.round((netProfit / totalCampaignCost) * 100) : 0
  const revenuePerCostShekels = totalCampaignCost > 0
    ? Math.round((totalRevenue / totalCampaignCost) * 10) / 10
    : 0
  return { totalRevenue, totalCampaignCost, netProfit, costPerPlacement, revenuePerCostShekels, roi }
}

// Import type needed above
import type { SavedPosition } from '../types'
