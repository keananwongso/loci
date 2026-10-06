import { z } from 'zod'
import { refuseCrossOrigin, readLimitedJson } from '@/lib/server/request'
import { importLink } from '@/lib/server/link-import'
import { deviceFor, ipHashFor } from '@/lib/server/device'
import { limitConfigFromEnv, takeUsage } from '@/lib/server/limits'
export const runtime = 'nodejs'
export const maxDuration = 30
export async function POST(req: Request) {
 const refused = refuseCrossOrigin(req); if (refused) return refused
 const body = await readLimitedJson(req, 4096); if (body instanceof Response) return body
 const parsed = z.object({ url: z.string().url().max(2000) }).safeParse(body.value)
 if (!parsed.success) return Response.json({ error: 'Enter a public article or PDF URL.' }, { status: 400 })
 try {
  const limits = limitConfigFromEnv()
  if (limits.enabled) {
   const allowed = await takeUsage('link-import', { perDevice: 20, perIp: 60, global: 500 }, deviceFor(req).id, ipHashFor(req))
   if (!allowed.ok) return Response.json({ error: 'The link import allowance is used up today. Upload the file instead.' }, { status: 429 })
  }
  const result = await importLink(parsed.data.url, AbortSignal.any([req.signal, AbortSignal.timeout(20000)]))
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
 } catch (err) {
  return Response.json({ error: err instanceof Error && !['AbortError', 'TimeoutError'].includes(err.name) ? err.message : 'The link took too long to open. Download the PDF and upload it instead.' }, { status: 400 })
 }
}
