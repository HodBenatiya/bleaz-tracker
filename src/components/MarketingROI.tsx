import type { DailyReport, Candidate, SavedPosition } from '../types'

interface Props {
  reports:    DailyReport[]
  candidates: Candidate[]
  positions:  SavedPosition[]
}

const PLACEMENT_VALUE = 5000 // ₪ per placement

// ── per-source funnel ─────────────────────────────────────────────────────────

interface SourceRow {
  source:    string
  total:     number   // all candidates from this source
  screening: number   // screening | call_scheduled | called
  relevant:  number   // relevant | sent_to_client | interview_scheduled | started_working | placement_complete
  sent:      number   // sent_to_client | interview_scheduled | started_working | placement_complete
  interview: number   // interview_scheduled | started_working | placement_complete
  working:   number   // started_working | placement_complete
  placed:    number   // placement_complete
  convRate:  number   // placed / total %
}

function buildSourceFunnel(candidates: Candidate[]): SourceRow[] {
  const map: Record<string, SourceRow> = {}

  for (const c of candidates) {
    const src = c.source || 'אחר'
    if (!map[src]) {
      map[src] = { source: src, total: 0, screening: 0, relevant: 0, sent: 0, interview: 0, working: 0, placed: 0, convRate: 0 }
    }
    const r = map[src]
    r.total++

    const s = c.status
    if (['screening','call_scheduled','called','relevant','sent_to_client','interview_scheduled','started_working','placement_complete'].includes(s)) r.screening++
    if (['relevant','sent_to_client','interview_scheduled','started_working','placement_complete'].includes(s)) r.relevant++
    if (['sent_to_client','interview_scheduled','started_working','placement_complete'].includes(s)) r.sent++
    if (['interview_scheduled','started_working','placement_complete'].includes(s)) r.interview++
    if (['started_working','placement_complete'].includes(s)) r.working++
    if (s === 'placement_complete') r.placed++
  }

  return Object.values(map)
    .map(r => ({ ...r, convRate: r.total > 0 ? (r.placed / r.total) * 100 : 0 }))
    .sort((a, b) => b.placed - a.placed || b.total - a.total)
}

// ── per-campaign spend table ──────────────────────────────────────────────────

interface CampaignRow {
  name:    string
  spend:   number
  leads:   number
  cpl:     number
}

function buildCampaignRows(reports: DailyReport[]): CampaignRow[] {
  const map: Record<string, { spend: number; leads: number }> = {}
  for (const r of reports) {
    for (const job of r.jobs) {
      const key = `${job.positionTitle} — ${job.companyName}`
      if (!map[key]) map[key] = { spend: 0, leads: 0 }
      map[key].spend += job.campaignCost || 0
      map[key].leads += job.leadsIn      || 0
    }
  }
  return Object.entries(map)
    .map(([name, { spend, leads }]) => ({
      name, spend, leads,
      cpl: leads > 0 ? spend / leads : 0,
    }))
    .sort((a, b) => b.spend - a.spend)
}

// ── component ─────────────────────────────────────────────────────────────────

export default function MarketingROI({ reports, candidates, positions }: Props) {
  const sourceRows   = buildSourceFunnel(candidates)
  const campaignRows = buildCampaignRows(reports)

  const totalSpend   = campaignRows.reduce((s, r) => s + r.spend, 0)
  const totalLeads   = campaignRows.reduce((s, r) => s + r.leads, 0)
  const totalPlaced  = positions.reduce((s, p) => s + (p.funnelConfirmed || 0), 0)
  const totalRevenue = totalPlaced * PLACEMENT_VALUE
  const totalROI     = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend) * 100 : 0
  const cpl          = totalLeads  > 0 ? totalSpend / totalLeads  : 0
  const cpp          = totalPlaced > 0 ? totalSpend / totalPlaced : 0

  const candTotal    = candidates.length
  const candPlaced   = candidates.filter(c => c.status === 'placement_complete').length
  const candRelevant = candidates.filter(c =>
    ['relevant','sent_to_client','interview_scheduled','started_working','placement_complete'].includes(c.status)).length

  return (
    <div className="space-y-6">

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI label="סה״כ הוצאה"  value={`₪${totalSpend.toLocaleString()}`}                          sub="כל הקמפיינים"        color="text-slate-700" />
        <KPI label="סה״כ לידים"  value={totalLeads.toLocaleString()}                                  sub="נכנסו מהמודעות"      color="text-blue-600" />
        <KPI label="עלות לליד"   value={cpl > 0 ? `₪${cpl.toFixed(0)}` : '—'}                       sub="CPL"                 color="text-slate-700" />
        <KPI label="הוצבו"        value={totalPlaced.toString()}                                      sub="הצבות מאושרות"       color="text-emerald-600" />
        <KPI label="הכנסה"        value={`₪${totalRevenue.toLocaleString()}`}                         sub={`${totalPlaced} × ₪5,000`} color="text-green-600" />
        <KPI
          label="ROI"
          value={totalROI > 0 ? `${totalROI.toFixed(0)}%` : '—'}
          sub={cpp > 0 ? `₪${cpp.toFixed(0)} לביצוע` : 'אין הצבות עדיין'}
          color={totalROI > 0 ? 'text-emerald-600' : 'text-slate-400'}
        />
      </div>

      {/* ── per-source funnel ── */}
      {sourceRows.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-800">משפך המרה לפי מקור</h3>
              <p className="text-xs text-slate-500 mt-0.5">מבוסס על {candTotal} מועמדים ב-CRM</p>
            </div>
            {candTotal > 0 && (
              <div className="text-right text-sm">
                <span className="text-slate-500">המרה כוללת: </span>
                <span className="font-bold text-slate-800">
                  {((candPlaced / candTotal) * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600 min-w-36">מקור</th>
                  <th className="text-center px-3 py-3 font-semibold text-slate-600">לידים</th>
                  <th className="text-center px-3 py-3 font-semibold text-yellow-700 bg-yellow-50">בסינון</th>
                  <th className="text-center px-3 py-3 font-semibold text-green-700  bg-green-50">רלוונטי</th>
                  <th className="text-center px-3 py-3 font-semibold text-teal-700   bg-teal-50">נשלח</th>
                  <th className="text-center px-3 py-3 font-semibold text-indigo-700 bg-indigo-50">ראיון</th>
                  <th className="text-center px-3 py-3 font-semibold text-emerald-700 bg-emerald-50">עובד</th>
                  <th className="text-center px-3 py-3 font-semibold text-emerald-800 bg-emerald-100">הוצב</th>
                  <th className="text-center px-3 py-3 font-semibold text-slate-600">המרה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sourceRows.map(row => (
                  <tr key={row.source} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{row.source}</td>
                    <td className="px-3 py-3 text-center text-slate-700 font-medium">{row.total}</td>
                    <td className="px-3 py-3 text-center text-yellow-700  bg-yellow-50">
                      <FunnelCell value={row.screening} total={row.total} />
                    </td>
                    <td className="px-3 py-3 text-center text-green-700   bg-green-50">
                      <FunnelCell value={row.relevant}  total={row.total} />
                    </td>
                    <td className="px-3 py-3 text-center text-teal-700    bg-teal-50">
                      <FunnelCell value={row.sent}      total={row.total} />
                    </td>
                    <td className="px-3 py-3 text-center text-indigo-700  bg-indigo-50">
                      <FunnelCell value={row.interview} total={row.total} />
                    </td>
                    <td className="px-3 py-3 text-center text-emerald-700 bg-emerald-50">
                      <FunnelCell value={row.working}   total={row.total} />
                    </td>
                    <td className="px-3 py-3 text-center bg-emerald-100">
                      <span className="font-black text-emerald-800">{row.placed}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <ConvBadge pct={row.convRate} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-bold">
                <tr>
                  <td className="px-4 py-3 text-slate-700">סה״כ</td>
                  <td className="px-3 py-3 text-center text-slate-800">{candTotal}</td>
                  <td className="px-3 py-3 text-center text-yellow-700  bg-yellow-50">
                    {sourceRows.reduce((s, r) => s + r.screening, 0)}
                  </td>
                  <td className="px-3 py-3 text-center text-green-700   bg-green-50">
                    {candRelevant}
                  </td>
                  <td className="px-3 py-3 text-center text-teal-700    bg-teal-50">
                    {sourceRows.reduce((s, r) => s + r.sent, 0)}
                  </td>
                  <td className="px-3 py-3 text-center text-indigo-700  bg-indigo-50">
                    {sourceRows.reduce((s, r) => s + r.interview, 0)}
                  </td>
                  <td className="px-3 py-3 text-center text-emerald-700 bg-emerald-50">
                    {sourceRows.reduce((s, r) => s + r.working, 0)}
                  </td>
                  <td className="px-3 py-3 text-center bg-emerald-100 text-emerald-800">
                    {candPlaced}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <ConvBadge pct={candTotal > 0 ? (candPlaced / candTotal) * 100 : 0} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* drop-off analysis */}
          {candTotal > 0 && (
            <div className="px-5 py-4 border-t border-slate-100 bg-slate-50">
              <p className="text-xs font-semibold text-slate-600 mb-3">ניתוח נשירה בין שלבים</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <DropOff
                  label="ליד → בסינון"
                  from={candTotal}
                  to={sourceRows.reduce((s, r) => s + r.screening, 0)}
                />
                <DropOff
                  label="סינון → רלוונטי"
                  from={sourceRows.reduce((s, r) => s + r.screening, 0)}
                  to={candRelevant}
                />
                <DropOff
                  label="רלוונטי → ראיון"
                  from={candRelevant}
                  to={sourceRows.reduce((s, r) => s + r.interview, 0)}
                />
                <DropOff
                  label="ראיון → הוצב"
                  from={sourceRows.reduce((s, r) => s + r.interview, 0)}
                  to={candPlaced}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── campaign spend table ── */}
      {campaignRows.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-base font-bold text-slate-800">הוצאות לפי קמפיין</h3>
            <p className="text-xs text-slate-500 mt-0.5">מתוך דיווחים יומיים · לקישור עם המשפך — תייג מועמדים באותו שם מקור</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-right px-4 py-3 font-semibold text-slate-600 min-w-40">קמפיין</th>
                  <th className="text-left  px-4 py-3 font-semibold text-slate-600">הוצאה</th>
                  <th className="text-left  px-4 py-3 font-semibold text-slate-600">לידים</th>
                  <th className="text-left  px-4 py-3 font-semibold text-slate-600">עלות/ליד</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaignRows.map(row => (
                  <tr key={row.name} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{row.name}</td>
                    <td className="px-4 py-3 text-slate-700">₪{row.spend.toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-700">{row.leads}</td>
                    <td className="px-4 py-3 text-slate-500">{row.cpl > 0 ? `₪${row.cpl.toFixed(0)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-bold">
                <tr>
                  <td className="px-4 py-3 text-slate-700">סה״כ</td>
                  <td className="px-4 py-3 text-slate-800">₪{totalSpend.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-800">{totalLeads}</td>
                  <td className="px-4 py-3 text-slate-600">{cpl > 0 ? `₪${cpl.toFixed(0)}` : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {sourceRows.length === 0 && campaignRows.length === 0 && (
        <div className="card text-center py-12 text-slate-400">
          <p className="text-lg mb-2">אין נתונים עדיין</p>
          <p className="text-sm">הוסף מועמדים עם שדה "מקור" כדי לראות את משפך ההמרה לפי ערוץ</p>
        </div>
      )}
    </div>
  )
}

// ── small components ──────────────────────────────────────────────────────────

function KPI({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="card py-3 px-4">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-xl font-black ${color}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-0.5">{sub}</div>
    </div>
  )
}

function FunnelCell({ value, total }: { value: number; total: number }) {
  if (value === 0) return <span className="text-slate-300">—</span>
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <span className="font-semibold">
      {value}
      <span className="text-[10px] font-normal opacity-60 ml-0.5">({pct}%)</span>
    </span>
  )
}

function ConvBadge({ pct }: { pct: number }) {
  if (pct === 0) return <span className="text-slate-300 text-xs">—</span>
  const color = pct >= 10 ? 'text-emerald-700 bg-emerald-100'
              : pct >= 5  ? 'text-yellow-700 bg-yellow-100'
              :              'text-red-600 bg-red-100'
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>
      {pct.toFixed(1)}%
    </span>
  )
}

function DropOff({ label, from, to }: { label: string; from: number; to: number }) {
  const kept    = from > 0 ? Math.round((to / from) * 100) : 0
  const dropped = 100 - kept
  return (
    <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
      <div className="flex items-center gap-1 mb-1">
        <div
          className="h-1.5 rounded-full bg-emerald-400 transition-all"
          style={{ width: `${kept}%`, minWidth: kept > 0 ? 4 : 0 }}
        />
        <div
          className="h-1.5 rounded-full bg-red-200 transition-all"
          style={{ width: `${dropped}%`, minWidth: dropped > 0 ? 4 : 0 }}
        />
      </div>
      <div className="flex justify-between text-[10px]">
        <span className="text-emerald-700 font-semibold">עבר {kept}%</span>
        <span className="text-red-500">נשר {dropped}%</span>
      </div>
      <div className="text-[10px] text-slate-400 mt-0.5">{from} → {to}</div>
    </div>
  )
}
