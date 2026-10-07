'use client'
import type { Editor } from '@/lib/whiteboard'
import { createShapeId } from '@/lib/whiteboard'
import { MATERIAL, type MaterialShape } from '@/lib/canvas/shape-types'
import { ingestFiles, PAGE_WIDTH } from '@/lib/canvas/ingest'
import { putBlob, randomKey } from '@/lib/storage/blobs'
import type { MaterialRole } from './roles'
import { articlePages } from './article-pages'
import type { ArticleBlock } from './article'
import type { TextItem } from '@/lib/tutor/types'

/** Render an article as text pages so existing highlights and source citations work unchanged. */
export async function ingestArticle(editor: Editor, title: string, text: string, role: MaterialRole, provenance: { url?: string; fetchedAt?: string } = {}) {
 const width = 1200, padding = 80, lineHeight = 38, font = '26px sans-serif'
 const measure = document.createElement('canvas').getContext('2d')!; measure.font = font
 const lines: string[] = []
 for (const paragraph of text.split('\n')) {
  let line = ''
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
   if (line && measure.measureText(`${line} ${word}`).width > width - padding * 2) { lines.push(line); line = word }
   else line = line ? `${line} ${word}` : word
  }
  lines.push(line)
 }
 const pageCount = Math.ceil(lines.length / 32), doc = randomKey('article')
 const existing = editor.getCurrentPageShapes().map(s => editor.getShapePageBounds(s)).filter(b => b !== undefined)
 const x = existing.length ? Math.max(...existing.map(b => b!.maxX)) + 200 : 0
 let y = 0; const ids: string[] = []
 for (let n = 0; n < pageCount; n++) {
  const part = lines.slice(n * 32, (n + 1) * 32), height = padding * 2 + part.length * lineHeight
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.font = font; ctx.fillStyle = '#242424'
  const textItems: TextItem[] = []
  part.forEach((line, i) => { const top = padding + i * lineHeight; ctx.fillText(line, padding, top + 28); if (line) textItems.push({ t: line, b: [padding / width, top / height, ctx.measureText(line).width / width, lineHeight / height] }) })
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not render the article.')), 'image/png'))
  const blobKey = randomKey('article-page'); await putBlob(blobKey, blob)
  const id = createShapeId(), h = height * PAGE_WIDTH / width
  editor.createShape<MaterialShape>({ id, type: MATERIAL, x, y, meta: { role, doc, ...provenance }, props: { w: PAGE_WIDTH, h, blobKey, kind: 'image', name: title.slice(0, 300), page: n + 1, pageCount, pixelW: width, pixelH: height, textItems } })
  ids.push(id); y += h + 56
 }
 if (ids.length) { editor.select(ids[0]); editor.zoomToBounds(editor.getShapePageBounds(ids[0])!, { inset: 100 }) }
 return ids
}
async function ingestTextbook(editor: Editor, title: string, blocks: ArticleBlock[], macros: string, role: MaterialRole, provenance: { url: string; fetchedAt: string }) {
 const doc = randomKey('article'), ids: string[] = []
 const bounds = editor.getCurrentPageShapes().map(s => editor.getShapePageBounds(s)).filter(b => b !== undefined)
 const x = bounds.length ? Math.max(...bounds.map(b => b!.maxX)) + 200 : 0
 let y = 0
 try {
  await articlePages(blocks, macros, async (blob, height, textItems) => {
   const blobKey = randomKey('article-page'); await putBlob(blobKey, blob)
   const id = createShapeId(), h = height * PAGE_WIDTH / 1200
   editor.createShape<MaterialShape>({ id, type: MATERIAL, x, y, meta: { role, doc, ...provenance }, props: { w: PAGE_WIDTH, h, blobKey, kind: 'image', name: title.slice(0, 300), page: ids.length + 1, pageCount: 1, pixelW: 1200, pixelH: height, textItems } })
   ids.push(id); y += h + 56
  })
 } catch (error) { editor.deleteShapes(ids); throw error }
 editor.updateShapes(ids.map(id => ({ id, type: MATERIAL, props: { pageCount: ids.length } })))
 if (ids.length) { editor.select(ids[0]); editor.zoomToBounds(editor.getShapePageBounds(ids[0])!, { inset: 100 }) }
 return ids
}
export async function ingestLink(editor: Editor, url: string, role: MaterialRole, signal: AbortSignal, progress: (text: string | null) => void) {
 progress('Opening your link…')
 try {
  const res = await fetch('/api/materials/link', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Could not import the link.')
  if (signal.aborted) return []
  if (data.kind === 'pdf') {
   const bytes = Uint8Array.from(atob(data.data), c => c.charCodeAt(0))
   const ids = await ingestFiles(editor, [new File([bytes], data.name, { type: 'application/pdf' })], progress, { role })
   editor.updateShapes(ids.map(id => { const shape = editor.getShape(id)!; return { id, type: MATERIAL, meta: { ...shape.meta, url: data.url, fetchedAt: data.fetchedAt } } }))
   if (!ids.length) throw new Error('The linked PDF could not be imported. Download it and upload it instead.')
   return ids
  }
  if (data.blocks) return await ingestTextbook(editor, data.title, data.blocks, data.macros || '', role, { url: data.url, fetchedAt: data.fetchedAt })
  return await ingestArticle(editor, data.title, data.text, role, { url: data.url, fetchedAt: data.fetchedAt })
 } finally { progress(null) }
}
