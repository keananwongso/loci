'use client'
import { toBlob, getFontEmbedCSS } from 'html-to-image'
import type { TextItem } from '@/lib/tutor/types'
import { articleMath, type ArticleBlock } from './article'

/** Render only escaped source text and local KaTeX output, never the website's HTML. */
export async function articlePages(blocks: ArticleBlock[], macros: string, consume: (blob: Blob, height: number, items: TextItem[]) => Promise<void>) {
 const render = articleMath(macros), width = 1200
 const host = document.createElement('div')
 host.setAttribute('aria-hidden', 'true')
 host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;pointer-events:none;'
 const page = document.createElement('div')
 page.style.cssText = 'width:1200px;box-sizing:border-box;padding:80px;background:white;color:#242424;font:26px/1.5 sans-serif;overflow-wrap:anywhere;'
 host.append(page); document.body.append(host)
 let fontEmbedCSS: string | undefined
 const flush = async () => {
  if (!page.children.length) return
  await document.fonts.ready
  const rect = page.getBoundingClientRect(), height = Math.ceil(rect.height)
  const items: TextItem[] = Array.from(page.children).map<TextItem>(el => {
   const box = el.getBoundingClientRect()
   return { t: (el as HTMLElement).dataset.source || '', b: [(box.left - rect.left) / width, (box.top - rect.top) / height, box.width / width, box.height / height] }
  }).filter(item => item.t)
  fontEmbedCSS ??= await getFontEmbedCSS(page)
  const blob = await toBlob(page, { width, height, pixelRatio: 1, fontEmbedCSS })
  if (!blob) throw new Error('Could not render the textbook. Upload its PDF instead.')
  await consume(blob, height, items)
  page.replaceChildren()
 }
 try {
  for (const block of blocks) {
   const el = document.createElement(block.kind === 'heading' ? 'h2' : 'div')
   el.style.cssText = block.kind === 'heading' ? 'font:600 32px/1.35 sans-serif;margin:0 0 24px' : 'margin:0 0 24px'
   el.dataset.source = block.text
   if (block.kind === 'image') {
    if (!block.src?.startsWith('data:image/')) throw new Error('Could not load a textbook diagram.')
    const img = document.createElement('img'); img.src = block.src; img.alt = block.text
    img.style.cssText = 'display:block;max-width:100%;max-height:1000px;margin:auto'
    el.append(img); page.append(el); await img.decode()
   } else { el.innerHTML = render(block.text); page.append(el) }
   await document.fonts.ready
   if (page.offsetHeight > 1700 && page.children.length > 1) { el.remove(); await flush(); page.append(el) }
  }
  await flush()
 } finally { host.remove() }
}
