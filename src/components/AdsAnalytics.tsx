import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Candidate, SavedPosition } from '../types'
import { exampleBundle, EXAMPLE_NOTE, examplePositions } from '../utils/metaAds/example'
import { suggestCampaignPositions } from '../utils/metaAds/matchCampaign'
import { campaignFunnel, type CampaignFunnelRow } from '../utils/metaAds/campaignFunnel'
import { campaignIsLive, updatedAgo, visibleCampaigns } from '../utils/metaAds/live'
import { campaignsFromMaps, computeAdsMetrics, metricLeads, type ScopeMetrics, type SpendSlice } from '../utils/metaAds/metrics'
import { costOf, formatCost, formatMoney, formatMoneyBag } from '../utils/metaAds/money'
import { buildTrend, type TrendGrain } from '../utils/metaAds/trend'
import { METRIC_COPY } from '../utils/metaAds/stages'
import { placementLabel } from '../utils/metaAds/adMetrics'
import {
  loadAdsBundle,
  loadPlacementSpend,
  mapCampaignPosition,
  saveUsdToIls,
  unmapCampaignPosition,
  type AdsBundle,
  type PlacementSpend,
} from '../utils/metaAdsStore'
import { useCanEdit } from '../access/AccessContext'
import { todayInIsrael } from '../utils/metaAds/zone'

interface Props {
  candidates: Candidate[]
  positions: SavedPosition[]
  start: string
  end: string
  rangeLabel: string
  jobIds: string[]
  example: boolean
}

const CARDS: { count: keyof ScopeMetrics['counts']; cost: 'costPerLead' | 'costPerRelevant' | 'costPerInterview' | 'costPerPlacement'; countKey: keyof typeof METRIC_COPY; costKey: keyof typeof METRIC_COPY }[] = [
  { count: 'leads', cost: 'costPerLead', countKey: 'leads', costKey: 'costPerLead' },
  { count: 'relevant', cost: 'costPerRelevant', countKey: 'relevant', costKey: 'costPerRelevant' },
  { count: 'interviews', cost: 'costPerInterview', countKey: 'interviews', costKey: 'costPerInterview' },
  { count: 'placements', cost: 'costPerPlacement', countKey: 'placements', costKey: 'costPerPlacement' },
]

function zoneLabel(timezone: string): string {
  if (timezone === 'America/Los_Angeles') return 'לוס אנג׳לס'
  if (timezone === 'Asia/Jerusalem') return 'ישראל'
  return timezone
}

function currencyLabel(currency: string): string {
  if (currency === 'USD') return 'דולר'
  if (currency === 'ILS') return 'שקל'
  return currency
}

function syncLabel(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AdsAnalytics({ candidates, positions, start, end, rangeLabel, jobIds, example }: Props) {
  const canEdit = useCanEdit()
  const locked = example || !canEdit
  const [bundle, setBundle] = useState<AdsBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!example)
  const [rateText, setRateText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [grain, setGrain] = useState<TrendGrain | null>(null)
  const [focusJob, setFocusJob] = useState<string>('all')
  const [mapQuery, setMapQuery] = useState('')
  const [placements, setPlacements] = useState<PlacementSpend[] | null>(null)
  const [addJob, setAddJob] = useState<Record<string, string>>({})

  const reload = useCallback(async () => {
    if (example) return
    setLoading(true)
    setError(null)
    try {
      const next = await loadAdsBundle(start, end)
      setBundle(next)
      setRateText(next.usdToIls == null ? '' : String(next.usdToIls))
    } catch (err) {
      setBundle(null)
      setError(err instanceof Error ? err.message : 'לא הצלחנו לטעון את נתוני המודעות')
    } finally {
      setLoading(false)
    }
  }, [example, start, end])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (example) { setPlacements(null); return }
    let cancelled = false
    loadPlacementSpend(start, end).then(rows => { if (!cancelled) setPlacements(rows) }).catch(() => { if (!cancelled) setPlacements(null) })
    return () => { cancelled = true }
  }, [example, start, end])

  const sample = useMemo(() => example ? exampleBundle(todayInIsrael()) : null, [example])
  const data = sample?.bundle ?? bundle
  const people = sample?.candidates ?? candidates
  const jobs = example ? examplePositions() : positions

  const report = useMemo(() => {
    if (!data) return null
    const known = campaignsFromMaps(data.campaigns, data.maps)
    const labels = Object.fromEntries(jobs.map(job => [job.id, `${job.positionTitle} · ${job.companyName}`]))
    return computeAdsMetrics({
      spend: data.spend,
      maps: data.maps,
      leads: metricLeads(people, known, start, end),
      jobIds: jobIds.length ? jobIds : 'all',
      labels,
      usdToIls: data.usdToIls,
      start,
      end,
      selectionLabel: jobIds.length ? 'משרות נבחרות' : 'הכל',
    })
  }, [data, people, jobs, jobIds, start, end])

  const funnel = useMemo(() => {
    if (!data) return []
    return campaignFunnel({
      candidates: people,
      campaigns: data.campaigns.map(row => ({
        accountId: row.accountId,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
      })),
      accounts: data.accounts.map(row => ({ accountId: row.accountId, name: row.name })),
      spend: data.spend,
      maps: data.maps,
      jobIds: jobIds.length ? jobIds : 'all',
      start,
      end,
      usdToIls: data.usdToIls,
    })
  }, [data, people, jobIds, start, end])

  const trend = useMemo(() => {
    if (!data || !grain) return []
    const known = campaignsFromMaps(data.campaigns, data.maps)
    return buildTrend({
      spend: data.spend,
      maps: data.maps,
      leads: metricLeads(people, known, start, end),
      jobId: focusJob,
      usdToIls: data.usdToIls,
      start,
      end,
      grain,
    })
  }, [data, people, grain, focusJob, start, end])

  async function saveRate() {
    if (example) return
    const trimmed = rateText.trim()
    const rate = trimmed === '' ? null : Number(trimmed)
    if (rate != null && (!Number.isFinite(rate) || rate <= 0)) {
      setNotice('השער צריך להיות מספר גדול מאפס, או ריק כדי לא להמיר')
      return
    }
    setBusy(true)
    const message = await saveUsdToIls(rate)
    setBusy(false)
    setNotice(message || 'השער נשמר')
    if (!message) void reload()
  }

  async function link(accountId: string, campaignId: string, positionId: string) {
    if (example || !positionId) return
    setBusy(true)
    const message = await mapCampaignPosition(accountId, campaignId, positionId)
    setBusy(false)
    setNotice(message)
    if (!message) void reload()
  }

  async function unlink(accountId: string, campaignId: string, positionId: string) {
    if (example) return
    setBusy(true)
    const message = await unmapCampaignPosition(accountId, campaignId, positionId)
    setBusy(false)
    setNotice(message)
    if (!message) void reload()
  }

  const selection = report?.selection
  const placementRows = example
    ? [
      { platform: 'instagram', position: 'instagram_stories', spend: 120, currency: 'USD', leads: 4 },
      { platform: 'facebook', position: 'feed', spend: 80, currency: 'USD', leads: 2 },
    ]
    : (placements ?? [])
  const spendText = selection ? formatMoneyBag(selection.money.byCurrency) : '—'
  const spendNote = selection?.money.usesRate
    ? 'השער הוא רק לתצוגה, לא המרה רשמית'
    : 'הסכום מוצג במטבע של חשבון המודעות'

  return (
    <div className="space-y-4">
      {example && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
          <p className="font-black">{EXAMPLE_NOTE}</p>
          <p className="text-sm mt-1">המספרים במסך הזה מומצאים, כדי להראות איך הניתוח נראה. הם לא מגיעים ממטא ולא מה-CRM.</p>
        </div>
      )}

      <div className="card py-4">
        <p className="text-xs text-slate-500">{METRIC_COPY.spend.label} · {rangeLabel}</p>
        <p className="text-3xl sm:text-4xl font-black text-slate-900 mt-1">{loading ? '…' : spendText}</p>
        {selection && selection.money.usesRate && selection.money.ils != null && data?.usdToIls && (
          <p className="text-sm text-slate-600 mt-1">כ־{formatMoney(selection.money.ils, 'ILS')} לפי שער {data.usdToIls} ₪ לדולר</p>
        )}
        <p className="text-xs text-slate-400 mt-1">{spendNote}</p>
        {data?.historyNote && <p className="text-sm text-amber-800 mt-2">{data.historyNote}</p>}
        {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {CARDS.map(card => {
          const figure = selection ? formatCost(selection[card.cost], data?.usdToIls ?? null) : { primary: loading ? '…' : '—', note: '' }
          const count = selection ? selection.counts[card.count] : 0
          return (
            <div key={card.cost} className="card py-3 px-3">
              <div className="text-[11px] text-slate-500">{METRIC_COPY[card.costKey].label}</div>
              <div className="text-xl font-black text-slate-900 mt-1">{figure.primary}</div>
              <div className="text-xs text-slate-500 mt-1">{count} {METRIC_COPY[card.countKey].label}</div>
            </div>
          )
        })}
      </div>

      {report && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-800">לפי משרה</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">ההוצאה לפי שיוך הקמפיין עכשיו, גם לימים שלפני השיוך. הלידים הם מועמדים של המשרה בטווח.</p>
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-right px-3 py-2 font-semibold text-slate-600 min-w-36">משרה</th>
                  <th className="text-right px-2 py-2 font-semibold text-slate-600">הוצאה</th>
                  <th className="text-right px-2 py-2 font-semibold text-slate-600">לידים</th>
                  <th className="text-right px-2 py-2 font-semibold text-slate-600">עלות לליד</th>
                  <th className="text-right px-2 py-2 font-semibold text-slate-600">רלוונטיים</th>
                  <th className="text-right px-2 py-2 font-semibold text-slate-600">עלות לרלוונטי</th>
                  <th className="text-right px-2 py-2 font-semibold text-slate-600">ראיונות</th>
                  <th className="text-right px-2 py-2 font-semibold text-slate-600">עלות לראיון</th>
                  <th className="text-right px-2 py-2 font-semibold text-slate-600">השמות</th>
                  <th className="text-right px-2 py-2 font-semibold text-slate-600">עלות להשמה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.jobs.map(job => (
                  <JobRow key={job.id} job={job} rate={data?.usdToIls ?? null} active={focusJob === job.id} onFocus={() => setFocusJob(focusJob === job.id ? 'all' : job.id)} />
                ))}
                <JobRow job={report.unattributed} rate={data?.usdToIls ?? null} muted active={focusJob === 'unattributed'} onFocus={() => setFocusJob(focusJob === 'unattributed' ? 'all' : 'unattributed')} />
              </tbody>
            </table>
          </div>
          <div className="md:hidden divide-y divide-slate-100">
            {report.jobs.map(job => (
              <JobCard key={job.id} job={job} rate={data?.usdToIls ?? null} active={focusJob === job.id} onFocus={() => setFocusJob(focusJob === job.id ? 'all' : job.id)} />
            ))}
            <JobCard job={report.unattributed} rate={data?.usdToIls ?? null} muted active={focusJob === 'unattributed'} onFocus={() => setFocusJob(focusJob === 'unattributed' ? 'all' : 'unattributed')} />
          </div>
          <div className="px-4 py-3 border-t border-slate-100 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-500">פירוט</span>
              {(['day', 'week', 'month'] as TrendGrain[]).map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setGrain(current => current === item ? null : item)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${grain === item ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
                >
                  {item === 'day' ? 'יומי' : item === 'week' ? 'שבועי' : 'חודשי'}
                </button>
              ))}
              {focusJob !== 'all' && (
                <button type="button" onClick={() => setFocusJob('all')} className="text-[11px] font-semibold text-slate-500">כל המשרות</button>
              )}
            </div>
            {grain && trend.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="text-right font-medium py-1">תקופה</th>
                      <th className="text-right font-medium py-1">הוצאה</th>
                      <th className="text-right font-medium py-1">לידים</th>
                      <th className="text-right font-medium py-1">עלות לליד</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map(point => (
                      <tr key={point.key} className="border-t border-slate-100 text-slate-700">
                        <td className="py-1 whitespace-nowrap">{point.label}</td>
                        <td className="py-1 whitespace-nowrap">{formatMoneyBag(point.spend.byCurrency)}</td>
                        <td className="py-1">{point.leads}</td>
                        <td className="py-1 whitespace-nowrap">{formatCost(point.costPerLead, data?.usdToIls ?? null).primary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-slate-400 leading-relaxed">ללא שיוך נספר בסכום הכולל. בסינון משרה הוא נשאר בשורה שלו.</p>
          </div>
        </div>
      )}

      <details className="card">
        <summary className="cursor-pointer text-sm font-bold text-slate-800">שער, מיקומים וקמפיינים</summary>
        <div className="mt-3 space-y-4">
          {data?.lastSync ? (
            <p className="text-xs text-slate-500">{data.lastSync.ok ? 'סנכרון אחרון' : 'סנכרון אחרון נכשל'}: {syncLabel(data.lastSync.finishedAt)} {data.lastSync.message && !example ? `· ${data.lastSync.message}` : ''}</p>
          ) : (
            <p className="text-xs text-slate-500">{example ? 'בדוגמה אין סנכרון אמיתי' : 'עדיין אין סנכרון. אחרי ההתקנה הוא רץ לבד.'}</p>
          )}
          {selection && selection.counts.placementsWithheld > 0 && (
            <p className="text-[11px] text-amber-800 leading-relaxed">
              {selection.counts.placementsWithheld} השמות שויכו ידנית לחודש שלא נכנס במלואו לטווח. הן לא נכנסות לעלות להשמה. בחרו את החודש המלא כדי לכלול אותן.
            </p>
          )}
      {placementRows.length > 0 && (
        <div className="card">
          <h3 className="text-base font-bold text-slate-800">איפה המודעה רצה</h3>
          <p className="text-xs text-slate-500 mt-0.5">הוצאה ולידים לפי מקום במטא, בטווח שנבחר. התאריך הוא לפי שעון חשבון המודעות.</p>
          <div className="mt-3 space-y-2">
            {placementRows.slice(0, 6).map(row => (
              <div key={`${row.platform}-${row.position}-${row.currency}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-slate-800">{placementLabel(row.platform, row.position)}</span>
                <span className="text-slate-600 whitespace-nowrap">
                  {formatMoney(row.spend, row.currency)} · {row.leads} לידים
                  {row.leads > 0 ? ` · ${formatMoney(row.spend / row.leads, row.currency)} לליד` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-800">שער דולר</h3>
            <p className="text-xs text-slate-500">רק לתצוגה. בלי שער, דולר ושקל נשארים בנפרד ולא מתחברים לסכום אחד.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-600">1 דולר =</label>
            <input
              value={example ? '3.7' : rateText}
              onChange={event => setRateText(event.target.value)}
              disabled={locked}
              readOnly={locked}
              inputMode="decimal"
              className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              placeholder="3.70"
            />
            <span className="text-xs text-slate-600">שקל</span>
            {canEdit && <button type="button" onClick={() => void saveRate()} disabled={example || busy} className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40">שמור</button>}
          </div>
        </div>
        {notice && <p className="text-xs text-slate-600">{notice}</p>}
        <div className="text-[11px] text-slate-500 leading-relaxed">
          <p>היום בלוח הוא לפי שעון ישראל. חשבון NONA רשום במטא על שעון לוס אנג׳לס, אז כל שעת הוצאה מתורגמת לישראל. מטא לא נותנת לבקש יום ישראלי ישירות, וביום החלפת שעון קיץ ייתכן פער של שעה.</p>
          {data && data.accounts.length > 0 && (
            <p className="mt-1">
              חשבונות: {data.accounts.filter(account => account.enabled).map(account => `${account.name} · ${currencyLabel(account.currency)} · ${zoneLabel(account.timezone)}`).join(' · ') || 'אין חשבון פעיל'}
            </p>
          )}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <button type="button" onClick={() => setMapOpen(open => !open)} className="w-full px-5 py-4 text-right">
          <span className="text-base font-bold text-slate-800">קמפיינים באוויר</span>
          <span className="block text-xs text-slate-500 mt-0.5">
            רק מה שרץ עכשיו. חיפוש מוצא גם קמפיינים ישנים.
            {data?.lastSync?.finishedAt ? ` ${updatedAgo(data.lastSync.finishedAt)}.` : ''}
          </span>
        </button>
        {mapOpen && data && (
          <div className="border-t border-slate-100">
            <div className="px-5 py-3">
              <input
                value={mapQuery}
                onChange={event => setMapQuery(event.target.value)}
                placeholder="חיפוש קמפיין, גם אם לא באוויר"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="divide-y divide-slate-100">
            {visibleCampaigns(data.campaigns, mapQuery).length === 0 && (
              <p className="px-5 py-4 text-sm text-slate-500">{mapQuery.trim() ? 'אין קמפיין בשם הזה' : 'אין קמפיין באוויר עכשיו. חפשו כדי למצוא קמפיין ישן.'}</p>
            )}
            {visibleCampaigns(data.campaigns, mapQuery).map(campaign => {
              const live = campaignIsLive(campaign.status, campaign.delivering)
              const stats = funnel.find(row => row.accountId === campaign.accountId && row.campaignId === campaign.campaignId)
              const todayMoney = spendBag(data.todaySpend ?? [], campaign.accountId, campaign.campaignId)
              const accountName = data.accounts.find(account => account.accountId === campaign.accountId)?.name || ''
              const mapped = data.maps.filter(row => row.accountId === campaign.accountId && row.campaignId === campaign.campaignId)
              const suggestions = suggestCampaignPositions(campaign.campaignName, jobs)
                .filter(item => !mapped.some(row => row.positionId === item.positionId))
              const key = `${campaign.accountId}:${campaign.campaignId}`
              return (
                <div key={key} className="px-5 py-4 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-800">{campaign.campaignName}</p>
                      <p className="text-[11px] text-slate-400">{accountName}{live ? '' : ' · לא באוויר'}</p>
                    </div>
                    {live && <CampaignFigures stats={stats} todayText={formatMoneyBag(todayMoney)} rate={data.usdToIls} />}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {mapped.length === 0 && <span className="text-xs text-amber-700">לא משויך</span>}
                    {mapped.map(row => canEdit ? (
                      <button
                        key={row.positionId}
                        type="button"
                        disabled={example || busy}
                        onClick={() => void unlink(campaign.accountId, campaign.campaignId, row.positionId)}
                        className="text-xs rounded-full bg-slate-100 px-2 py-1 text-slate-700 disabled:opacity-60"
                      >
                        {jobs.find(job => job.id === row.positionId)?.positionTitle || row.positionId} · הסר
                      </button>
                    ) : (
                      <span key={row.positionId} className="text-xs rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                        {jobs.find(job => job.id === row.positionId)?.positionTitle || row.positionId}
                      </span>
                    ))}
                  </div>
                  {canEdit && suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map(item => {
                        const job = jobs.find(position => position.id === item.positionId)
                        if (!job) return null
                        return (
                          <button
                            key={item.positionId}
                            type="button"
                            disabled={example || busy}
                            onClick={() => void link(campaign.accountId, campaign.campaignId, item.positionId)}
                            className="text-xs rounded-full bg-blue-50 text-blue-800 px-2 py-1 disabled:opacity-60"
                            title={item.reason}
                          >
                            הצעה: {job.positionTitle} · {job.companyName}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {canEdit && <div className="flex gap-2">
                    <select
                      value={addJob[key] || ''}
                      onChange={event => setAddJob(prev => ({ ...prev, [key]: event.target.value }))}
                      className="text-xs rounded-lg border border-slate-200 px-2 py-1.5 bg-white flex-1"
                    >
                      <option value="">שייך למשרה…</option>
                      {jobs.map(job => (
                        <option key={job.id} value={job.id}>{job.positionTitle} · {job.companyName}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={example || busy || !addJob[key]}
                      onClick={() => void link(campaign.accountId, campaign.campaignId, addJob[key])}
                      className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
                    >
                      שייך
                    </button>
                  </div>}
                </div>
              )
            })}
            {example && <p className="px-5 py-3 text-xs text-amber-800">בדוגמה אי אפשר לשמור שיוך.</p>}
            </div>
          </div>
        )}
      </div>
        </div>
      </details>
    </div>
  )
}

function spendBag(rows: SpendSlice[], accountId: string, campaignId: string) {
  const mine = rows.filter(row => row.accountId === accountId && row.campaignId === campaignId)
  const byCurrency = new Map<string, number>()
  for (const row of mine) byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.spend)
  return [...byCurrency.entries()].map(([currency, amount]) => ({ currency, amount }))
}

function CampaignFigures({ stats, todayText, rate }: { stats?: CampaignFunnelRow; todayText: string; rate: number | null }) {
  const metaCost = stats ? formatCost(costOf(stats.money, stats.metaLeads), rate).primary : '—'
  return (
    <div className="text-[11px] text-slate-600 leading-relaxed text-left">
      <div>היום {todayText} · בטווח {stats ? formatMoneyBag(stats.money.byCurrency) : '—'}</div>
      <div>לידים במטא {stats?.metaLeads || 0} · עלות לליד {metaCost}</div>
      {stats && stats.crmLeads > 0 && (
        <>
          <div>ב-CRM {stats.crmLeads} · רלוונטי {stats.relevant} · נשלח {stats.sent} · ראיון {stats.interviews} · השמה {stats.placements} · לא רלוונטי {stats.notRelevant}</div>
          <div>עלות לרלוונטי {formatCost(stats.costPerRelevant, rate).primary} · לראיון {formatCost(stats.costPerInterview, rate).primary} · להשמה {formatCost(stats.costPerPlacement, rate).primary}</div>
        </>
      )}
    </div>
  )
}

function costText(job: ScopeMetrics, key: 'costPerLead' | 'costPerRelevant' | 'costPerInterview' | 'costPerPlacement', rate: number | null): string {
  return formatCost(job[key], rate).primary
}

function JobCells({ job, rate }: { job: ScopeMetrics; rate: number | null }) {
  return (
    <>
      <td className="px-2 py-2 text-slate-700 whitespace-nowrap">{formatMoneyBag(job.money.byCurrency)}</td>
      <td className="px-2 py-2 text-slate-800">{job.counts.leads}</td>
      <td className="px-2 py-2 text-slate-700 whitespace-nowrap">{costText(job, 'costPerLead', rate)}</td>
      <td className="px-2 py-2 text-slate-800">{job.counts.relevant}</td>
      <td className="px-2 py-2 text-slate-700 whitespace-nowrap">{costText(job, 'costPerRelevant', rate)}</td>
      <td className="px-2 py-2 text-slate-800">{job.counts.interviews}</td>
      <td className="px-2 py-2 text-slate-700 whitespace-nowrap">{costText(job, 'costPerInterview', rate)}</td>
      <td className="px-2 py-2 text-slate-800">{job.counts.placements}</td>
      <td className="px-2 py-2 text-slate-700 whitespace-nowrap">{costText(job, 'costPerPlacement', rate)}</td>
    </>
  )
}

function JobRow({ job, rate, muted = false, active = false, onFocus }: { job: ScopeMetrics; rate: number | null; muted?: boolean; active?: boolean; onFocus: () => void }) {
  return (
    <tr className={muted ? 'bg-amber-50/70' : active ? 'bg-slate-50' : 'hover:bg-slate-50'}>
      <td className="px-3 py-2 font-medium text-slate-800">
        <button type="button" onClick={onFocus} className="text-right">{job.label}</button>
      </td>
      <JobCells job={job} rate={rate} />
    </tr>
  )
}

function JobCard({ job, rate, muted = false, active = false, onFocus }: { job: ScopeMetrics; rate: number | null; muted?: boolean; active?: boolean; onFocus: () => void }) {
  const pairs = [
    ['לידים', String(job.counts.leads), costText(job, 'costPerLead', rate)],
    ['רלוונטיים', String(job.counts.relevant), costText(job, 'costPerRelevant', rate)],
    ['ראיונות', String(job.counts.interviews), costText(job, 'costPerInterview', rate)],
    ['השמות', String(job.counts.placements), costText(job, 'costPerPlacement', rate)],
  ]
  return (
    <button type="button" onClick={onFocus} className={`w-full text-right px-4 py-3 ${muted ? 'bg-amber-50/70' : ''} ${active ? 'ring-1 ring-inset ring-slate-300' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="font-semibold text-slate-800">{job.label}</span>
        <span className="font-black text-slate-900 whitespace-nowrap">{formatMoneyBag(job.money.byCurrency)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        {pairs.map(([label, count, cost]) => (
          <div key={label} className="rounded-lg bg-white/80 border border-slate-100 px-2 py-1.5">
            <div className="text-[10px] text-slate-400">{label}</div>
            <div className="text-sm font-bold text-slate-800">{count} <span className="font-medium text-slate-500">· {cost}</span></div>
          </div>
        ))}
      </div>
    </button>
  )
}
