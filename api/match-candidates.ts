import type { MatchCandidateInput, MatchHit, MatchJobInput } from '../src/utils/matchCandidates.js'
import { rankCandidates } from '../src/utils/matchCandidates.js'
import { CANDIDATE_STATUS_LABELS, type CandidateStatus } from '../src/types/index.js'
import { db } from './_db.js'
import { redactError } from './_provider.js'
import { toWhatsAppChatId } from '../src/utils/wa.js'

const PAGE = 500
const PAGE_CAP = 20000

function waUrl(phone: string): string {
  const chat = toWhatsAppChatId(phone)
  const digits = chat.endsWith('@c.us') ? chat.slice(0, -5) : ''
  return digits ? `https://wa.me/${digits}` : ''
}

async function loadJob(jobId: string): Promise<MatchJobInput | null> {
  const { data, error } = await db().from('positions').select('id, data').eq('id', jobId).maybeSingle()
  if (error) throw new Error(error.message)
  const row = data?.data as MatchJobInput | undefined
  if (!row) return null
  return { ...row, id: String(data?.id || row.id || jobId) }
}

async function loadCandidates(): Promise<MatchCandidateInput[]> {
  const out: MatchCandidateInput[] = []
  for (let from = 0; from < PAGE_CAP; from += PAGE) {
    const { data, error } = await db().from('candidates').select('id, data').range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    for (const row of rows) {
      const item = row.data as MatchCandidateInput | undefined
      if (!item) continue
      out.push({
        id: String(row.id || item.id || ''),
        name: item.name,
        phone: item.phone,
        city: item.city,
        status: item.status,
        positionType: item.positionType,
        source: item.source,
        notes: item.notes,
        noteHistory: item.noteHistory,
        interviewHistory: item.interviewHistory,
      })
    }
    if (rows.length < PAGE) break
  }
  return out.filter(item => item.id)
}

async function refineWithLlm(job: MatchJobInput, hits: MatchHit[]): Promise<string[] | null> {
  const key = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY
  if (!key || hits.length < 2) return null
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const payload = {
    job: {
      title: job.positionTitle || '',
      city: job.city || '',
      description: String(job.description || '').slice(0, 1200),
    },
    candidates: hits.slice(0, 30).map(hit => ({
      id: hit.id,
      city: hit.city,
      status: hit.status,
      reasons: hit.reasons,
      snippet: hit.snippet.slice(0, 280),
    })),
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Rank Hebrew recruitment candidates for a job. Reply with JSON {"ids": string[]} using only the given ids, best first, at most 20. Do not add people who are a weak fit.',
        },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`llm ${res.status}`)
  const body = await res.json() as { choices?: { message?: { content?: string } }[] }
  const content = body.choices?.[0]?.message?.content || ''
  const parsed = JSON.parse(content) as { ids?: unknown }
  if (!Array.isArray(parsed.ids)) return null
  return parsed.ids.map(id => String(id))
}

function applyOrder(hits: MatchHit[], ids: string[] | null): MatchHit[] {
  const top = hits.slice(0, 20)
  if (!ids?.length) return top
  const byId = new Map(hits.map(hit => [hit.id, hit]))
  const ordered: MatchHit[] = []
  for (const id of ids) {
    const hit = byId.get(id)
    if (hit && !ordered.some(item => item.id === hit.id)) ordered.push(hit)
    if (ordered.length >= 20) break
  }
  for (const hit of top) {
    if (ordered.length >= 20) break
    if (!ordered.some(item => item.id === hit.id)) ordered.push(hit)
  }
  return ordered
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  const jobId = String(req.body?.jobId || '').trim()
  if (!jobId) return res.status(400).json({ ok: false, error: 'חסר מזהה משרה' })

  try {
    const job = await loadJob(jobId)
    if (!job) return res.status(404).json({ ok: false, error: 'המשרה לא נמצאה' })
    const candidates = await loadCandidates()
    const ranked = rankCandidates(job, candidates, 30)
    let method: 'keywords' | 'keywords+llm' = 'keywords'
    let order: string[] | null = null
    if (process.env.OPENAI_API_KEY || process.env.LLM_API_KEY) {
      try {
        order = await refineWithLlm(job, ranked)
        if (order?.length) method = 'keywords+llm'
      } catch (err) {
        console.error('match llm', redactError(err))
      }
    }
    const matches = applyOrder(ranked, order).map(hit => ({
      ...hit,
      statusLabel: CANDIDATE_STATUS_LABELS[hit.status as CandidateStatus] || hit.status,
      waUrl: waUrl(hit.phone),
    }))
    return res.status(200).json({
      ok: true,
      scanned: candidates.length,
      method,
      job: { id: job.id, title: job.positionTitle || '', company: job.companyName || '', city: job.city || '' },
      matches,
    })
  } catch (err) {
    const detail = redactError(err)
    console.error('match-candidates', detail)
    return res.status(500).json({ ok: false, error: 'חיפוש המועמדים נכשל', detail })
  }
}
