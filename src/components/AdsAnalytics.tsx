import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Candidate, SavedPosition } from '../types'
import { exampleBundle, EXAMPLE_NOTE, examplePositions } from '../utils/metaAds/example'
import { suggestCampaignPositions } from '../utils/metaAds/matchCampaign'
import { campaignsFromMaps, computeAdsMetrics, metricLeads, type ScopeMetrics } from '../utils/metaAds/metrics'
import { formatCost, formatMoney, formatMoneyBag } from '../utils/metaAds/money'
import { METRIC_COPY } from '../utils/metaAds/stages'
import {
  loadAdsBundle,
  mapCampaignPosition,
  saveUsdToIls,
  unmapCampaignPosition,
  type AdsBundle,
} from '../utils/metaAdsStore'
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

const CARDS: { count: keyof ScopeMetrics['counts']; cost: 'costPerLead' | 'costPerRelevant' | 'costPerInterview' | 'costPerPlacement' | 'costPerDropout'; countKey: keyof typeof METRIC_COPY; costKey: keyof typeof METRIC_COPY }[] = [
  { count: 'leads', cost: 'costPerLead', countKey: 'leads', costKey: 'costPerLead' },
  { count: 'relevant', cost: 'costPerRelevant', countKey: 'relevant', costKey: 'costPerRelevant' },
  { count: 'interviews', cost: 'costPerInterview', countKey: 'interviews', costKey: 'costPerInterview' },
  { count: 'placements', cost: 'costPerPlacement', countKey: 'placements', costKey: 'costPerPlacement' },
  { count: 'dropouts', cost: 'costPerDropout', countKey: 'dropouts', costKey: 'costPerDropout' },
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
  const [bundle, setBundle] = useState<AdsBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!example)
  const [rateText, setRateText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
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

      <div className="card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">{METRIC_COPY.spend.hint} · {rangeLabel}</p>
            <p className="text-3xl font-black text-slate-800 mt-1">{loading ? '…' : spendText}</p>
            {selection && selection.money.usesRate && selection.money.ils != null && data?.usdToIls && (
              <p className="text-sm text-slate-600 mt-1">כ־{formatMoney(selection.money.ils, 'ILS')} לפי שער {data.usdToIls} ₪ לדולר</p>
            )}
            <p className="text-sm text-slate-500 mt-1">{spendNote}</p>
          </div>
          <div className="text-xs text-slate-500 leading-relaxed max-w-sm">
            {data?.lastSync ? (
              <p>{data.lastSync.ok ? 'סנכרון אחרון' : 'סנכרון אחרון נכשל'}: {syncLabel(data.lastSync.finishedAt)} {data.lastSync.message && !example ? `· ${data.lastSync.message}` : ''}</p>
            ) : (
              <p>{example ? 'בדוגמה אין סנכרון אמיתי' : 'עדיין אין סנכרון. אחרי ההתקנה הוא רץ לבד כל שעה.'}</p>
            )}
          </div>
        </div>
        {error && <p className="text-sm text-red-700 mt-3">{error}</p>}
        {selection && selection.counts.placementsWithheld > 0 && (
          <p className="text-[11px] text-amber-800 mt-3 leading-relaxed">
            {selection.counts.placementsWithheld} השמות שויכו ידנית לחודש שלא נכנס במלואו לטווח. הן לא נכנסות לעלות להשמה. בחרו את החודש המלא כדי לכלול אותן.
          </p>
        )}
      </div>

      {selection && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {CARDS.map(card => {
            const figure = formatCost(selection[card.cost], data?.usdToIls ?? null)
            return (
              <div key={card.cost} className="card py-3 px-4">
                <div className="text-xs text-slate-500">{METRIC_COPY[card.costKey].label}</div>
                <div className="text-xl font-black text-slate-800 mt-1">{figure.primary}</div>
                <div className="text-[11px] text-slate-400 mt-1">{METRIC_COPY[card.costKey].hint}</div>
                {figure.note !== 'שקלים' && figure.note !== 'אין עדיין מספר לחלק בו' && (
                  <div className="text-[11px] text-slate-500 mt-1">{figure.note}</div>
                )}
                <div className="text-xs text-slate-600 mt-2">
                  {selection.counts[card.count]} {METRIC_COPY[card.countKey].label}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {report && (
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-base font-bold text-slate-800">לפי משרה</h3>
            <p className="text-xs text-slate-500 mt-0.5">קמפיין שמשויך לכמה משרות — ההוצאה מתחלקת שווה בשווה. ליד עם כמה משרות נספר בכל משרה, ובסיכום הכולל פעם אחת.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-right px-3 py-3 font-semibold text-slate-600 min-w-36">משרה</th>
                  <th className="text-right px-3 py-3 font-semibold text-slate-600">הוצאה</th>
                  <th className="text-right px-3 py-3 font-semibold text-slate-600" title={METRIC_COPY.costPerLead.hint}>עלות לליד</th>
                  <th className="text-right px-3 py-3 font-semibold text-slate-600" title={METRIC_COPY.costPerRelevant.hint}>עלות לרלוונטי</th>
                  <th className="text-right px-3 py-3 font-semibold text-slate-600" title={METRIC_COPY.costPerInterview.hint}>עלות לראיון</th>
                  <th className="text-right px-3 py-3 font-semibold text-slate-600" title={METRIC_COPY.costPerPlacement.hint}>עלות להשמה</th>
                  <th className="text-right px-3 py-3 font-semibold text-slate-600" title={METRIC_COPY.costPerDropout.hint}>עלות לנפל</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.jobs.map(job => <JobRow key={job.id} job={job} rate={data?.usdToIls ?? null} />)}
                <JobRow job={report.unattributed} rate={data?.usdToIls ?? null} muted />
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-[11px] text-slate-500 leading-relaxed border-t border-slate-100">
            לא משויך: קמפיין בלי משרה, או ליד בלי משרה ובלי מקור הגעה שתואם לקמפיין אחד שכבר משויך. המערכת לא מנחשת.
          </p>
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
              disabled={example}
              inputMode="decimal"
              className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              placeholder="3.70"
            />
            <span className="text-xs text-slate-600">שקל</span>
            <button type="button" onClick={() => void saveRate()} disabled={example || busy} className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40">שמור</button>
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
          <span className="text-base font-bold text-slate-800">שיוך קמפיינים למשרות</span>
          <span className="block text-xs text-slate-500 mt-0.5">הצעה לפי השם, ואפשר לשייך או להסיר ידנית. בלי אישור ידני שום קמפיין לא מתחבר למשרה.</span>
        </button>
        {mapOpen && data && (
          <div className="border-t border-slate-100 divide-y divide-slate-100">
            {data.campaigns.length === 0 && <p className="px-5 py-4 text-sm text-slate-500">עדיין אין קמפיינים. הם יופיעו אחרי הסנכרון הראשון.</p>}
            {data.campaigns.map(campaign => {
              const mapped = data.maps.filter(row => row.accountId === campaign.accountId && row.campaignId === campaign.campaignId)
              const suggestions = suggestCampaignPositions(campaign.campaignName, jobs)
                .filter(item => !mapped.some(row => row.positionId === item.positionId))
              const key = `${campaign.accountId}:${campaign.campaignId}`
              return (
                <div key={key} className="px-5 py-4 space-y-2">
                  <div>
                    <p className="font-semibold text-slate-800">{campaign.campaignName}</p>
                    <p className="text-[11px] text-slate-400">{currencyLabel(campaign.currency)} · {campaign.accountId}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {mapped.length === 0 && <span className="text-xs text-amber-700">לא משויך</span>}
                    {mapped.map(row => (
                      <button
                        key={row.positionId}
                        type="button"
                        disabled={example || busy}
                        onClick={() => void unlink(campaign.accountId, campaign.campaignId, row.positionId)}
                        className="text-xs rounded-full bg-slate-100 px-2 py-1 text-slate-700 disabled:opacity-60"
                      >
                        {jobs.find(job => job.id === row.positionId)?.positionTitle || row.positionId} · הסר
                      </button>
                    ))}
                  </div>
                  {suggestions.length > 0 && (
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
                  <div className="flex gap-2">
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
                  </div>
                </div>
              )
            })}
            {example && <p className="px-5 py-3 text-xs text-amber-800">בדוגמה אי אפשר לשמור שיוך.</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function JobRow({ job, rate, muted = false }: { job: ScopeMetrics; rate: number | null; muted?: boolean }) {
  const cells = [job.costPerLead, job.costPerRelevant, job.costPerInterview, job.costPerPlacement, job.costPerDropout]
  const counts = [job.counts.leads, job.counts.relevant, job.counts.interviews, job.counts.placements, job.counts.dropouts]
  return (
    <tr className={muted ? 'bg-amber-50/60' : 'hover:bg-slate-50'}>
      <td className="px-3 py-3 font-medium text-slate-800">{job.label}</td>
      <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{formatMoneyBag(job.money.byCurrency)}</td>
      {cells.map((figure, index) => (
        <td key={index} className="px-3 py-3 text-slate-700 whitespace-nowrap">
          <div>{formatCost(figure, rate).primary}</div>
          <div className="text-[10px] text-slate-400">{counts[index]}</div>
        </td>
      ))}
    </tr>
  )
}
