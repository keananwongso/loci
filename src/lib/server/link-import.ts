import 'server-only'
import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import { loadBuffer } from 'cheerio'

const MAX_BYTES = 10 * 1024 * 1024
export function publicAddress(address: string): boolean {
 try { return ipaddr.process(address).range() === 'unicast' } catch { return false }
}
export function publicUrl(value: string): URL {
 const url = new URL(value)
 if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && url.port !== '80' && url.port !== '443')) throw new Error('Use a public HTTP or HTTPS article or PDF link.')
 const host = url.hostname.replace(/^\[|\]$/g, '')
 if (isIP(host) && !publicAddress(host)) throw new Error('Private and internal URLs cannot be imported.')
 url.hash = ''
 return url
}
async function resolveHost(host: string, signal: AbortSignal) {
 if (isIP(host)) return [{ address: host, family: isIP(host) }]
 const aborted = new Promise<never>((_, reject) => {
  if (signal.aborted) reject(signal.reason)
  else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
 })
 return Promise.race([lookup(host, { all: true }), aborted])
}
/** Pin the checked DNS result to the socket so it cannot be rebound between validation and fetch. */
async function fetchOnce(url: URL, signal: AbortSignal) {
 const host = url.hostname.replace(/^\[|\]$/g, '')
 const addresses = await resolveHost(host, signal)
 if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new Error('Private and internal URLs cannot be imported.')
 const pinned = addresses[0]
 return new Promise<{ status: number; location?: string; type: string; bytes: Buffer }>((resolve, reject) => {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  const req = send(url, {
   hostname: host, signal, family: pinned.family,
   lookup: (_host, _options, cb) => cb(null, pinned.address, pinned.family),
   headers: { 'User-Agent': 'Loci-SourceImporter/1.0', Accept: 'text/html,application/pdf,text/plain', 'Accept-Encoding': 'identity' },
  }, res => {
   const status = res.statusCode || 500
   if ([301, 302, 303, 307, 308].includes(status)) { res.destroy(); resolve({ status, location: res.headers.location, type: '', bytes: Buffer.alloc(0) }); return }
   if (status < 200 || status >= 300) { res.destroy(); reject(new Error(status === 401 || status === 403 ? 'This page needs access or blocks imports. Upload an exported PDF or paste its text instead.' : 'Could not download this link. Check that it opens publicly.')); return }
   if (Number(res.headers['content-length']) > MAX_BYTES) { res.destroy(); reject(new Error('Linked files must be under 10 MB. Download the PDF and upload it instead.')); return }
   let size = 0; const chunks: Buffer[] = []
   res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_BYTES) res.destroy(new Error('Linked files must be under 10 MB.')); else chunks.push(chunk) })
   res.on('error', reject)
   res.on('end', () => resolve({ status, type: String(res.headers['content-type'] || '').split(';')[0].toLowerCase(), bytes: Buffer.concat(chunks) }))
  })
  req.on('error', reject); req.end()
 })
}
export function articleText(bytes: Buffer) {
 const $ = loadBuffer(bytes)
 const title = $('h1').first().text().trim() || $('title').text().trim() || 'Linked article'
 $('script,style,noscript,iframe,svg,nav,footer,header,form,button,aside').remove()
 let root = $('article').first()
 if (!root.length) root = $('main').first()
 if (!root.length) root = $('body')
 root.find('br').replaceWith('\n')
 root.find('p,h1,h2,h3,h4,h5,h6,li,tr,pre,blockquote,section').each((_, el) => { $(el).append('\n\n') })
 const text = root.text().replace(/[\t ]+/g, ' ').replace(/\n[ ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
 if (text.length < 80) throw new Error('This page has too little readable text. Upload a PDF or paste its text instead.')
 if (text.length > 100000) throw new Error('This article is too long to import. Use a shorter section or upload a PDF.')
 return { title: title.slice(0, 300), text }
}
export async function importLink(value: string, signal: AbortSignal) {
 let url = publicUrl(value)
 for (let redirects = 0; redirects <= 4; redirects++) {
  const result = await fetchOnce(url, signal)
  if (result.location) { if (redirects === 4) throw new Error('This link redirects too many times.'); url = publicUrl(new URL(result.location, url).href); continue }
  const fetchedAt = new Date().toISOString()
  if (result.bytes.subarray(0, 5).toString() === '%PDF-') return { kind: 'pdf' as const, url: url.href, fetchedAt, data: result.bytes.toString('base64'), name: (decodeURIComponent(url.pathname.split('/').pop() || 'linked-notes.pdf')).slice(0, 280) }
  if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(result.type)) throw new Error('Use a public article or direct PDF URL. This file type is not supported.')
  const article = result.type === 'text/plain' ? { title: 'Linked text', text: result.bytes.toString('utf8').trim() } : articleText(result.bytes)
  if (article.text.length < 80 || article.text.length > 100000) throw new Error('Use a page with 80 to 100,000 characters of readable text.')
  return { kind: 'article' as const, url: url.href, fetchedAt, ...article }
 }
 throw new Error('Could not import this link.')
}
