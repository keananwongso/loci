// Generates public/samples/directional-derivatives.pdf: short, synthetic calculus notes used
// by "Try sample notes". Written for this repo; not taken from any course.
//
//   npm run sample            (needs a Chromium: `npx playwright install chromium`,
//                              or set CHROMIUM_PATH to an existing Chrome/Chromium binary)
import { chromium } from 'playwright-core'
import katex from 'katex'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const katexCss = pathToFileURL(join(root, 'node_modules/katex/dist/katex.min.css')).href
const interCss = pathToFileURL(join(root, 'node_modules/@fontsource-variable/inter/index.css')).href
const serifCss = pathToFileURL(join(root, 'node_modules/@fontsource/instrument-serif/400.css')).href

const m = (tex, display = false) => katex.renderToString(tex, { displayMode: display, output: 'html' })

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${katexCss}"><link rel="stylesheet" href="${interCss}"><link rel="stylesheet" href="${serifCss}">
<style>
  @page { size: Letter; margin: 0 }
  body { margin: 0; font-family: 'Inter Variable', sans-serif; color: #1d2433; }
  .page { width: 8.5in; height: 11in; padding: 0.8in 0.9in; box-sizing: border-box; position: relative; }
  .kicker { font-size: 10.5pt; letter-spacing: .08em; text-transform: uppercase; color: #6b7487; }
  h1 { font-family: 'Instrument Serif', serif; font-weight: 400; font-size: 32pt; margin: 6pt 0 14pt; letter-spacing: -0.01em; }
  h2 { font-size: 12.5pt; margin: 20pt 0 6pt; color: #24345a; }
  p, li { font-size: 11pt; line-height: 1.6; margin: 4pt 0; }
  .key { margin: 14pt 0; padding: 14pt 18pt; border: 1.2pt solid #24345a; border-radius: 6pt; background: #f6f8fc; }
  .key .label { font-size: 9.5pt; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #24345a; }
  .formula { font-family: 'Times New Roman', 'DejaVu Serif', serif; font-style: italic; font-size: 22pt; text-align: center; margin: 8pt 0 4pt; }
  .formula span.up { font-style: normal; }
  .where { text-align: center; font-size: 10.5pt; color: #4a5468; }
  .ex { margin-top: 8pt; padding-left: 12pt; border-left: 2.5pt solid #c9d3e6; }
  .footer { position: absolute; bottom: 0.55in; left: 0.9in; right: 0.9in; font-size: 9pt; color: #9aa2b1; display: flex; justify-content: space-between; }
  .katex { font-size: 1.08em; }
</style></head><body>
<section class="page">
  <div class="kicker">Multivariable Calculus · Notes 7</div>
  <h1>Directional Derivatives and the Gradient</h1>

  <h2>1. Rates of change in any direction</h2>
  <p>The partial derivatives ${m('f_x')} and ${m('f_y')} measure how fast ${m('f(x,y)')} changes when we move parallel to the
  ${m('x')}- or ${m('y')}-axis. To measure the rate of change in an arbitrary direction we use a <b>unit vector</b>
  ${m('u = \\langle a, b \\rangle')} with ${m('|u| = 1')}.</p>

  <h2>2. Definition</h2>
  <p>The directional derivative of ${m('f')} at ${m('(x_0, y_0)')} in the direction of ${m('u')} is</p>
  ${m('D_u f(x_0,y_0) = \\lim_{h \\to 0} \\frac{f(x_0 + ha,\\; y_0 + hb) - f(x_0, y_0)}{h}', true)}
  <p>provided the limit exists.</p>

  <div class="key">
    <div class="label">Theorem</div>
    <p>If ${m('f')} is differentiable, then for every unit vector ${m('u')}:</p>
    <div class="formula">D<sub>u</sub>f = ∇f · u</div>
    <div class="where">where ∇f = ⟨f<sub>x</sub>, f<sub>y</sub>⟩ is the gradient of f.</div>
  </div>

  <h2>3. Example</h2>
  <div class="ex">
    <p>Let ${m('f(x,y) = x^2 y + y^3')}. Find the rate of change of ${m('f')} at ${m('(1, 2)')} in the direction of ${m('v = \\langle 3, 4 \\rangle')}.</p>
    <p>Normalize first: ${m('|v| = 5')}, so ${m('u = \\langle \\tfrac{3}{5}, \\tfrac{4}{5} \\rangle')}.</p>
    <p>Gradient: ${m('\\nabla f = \\langle 2xy,\\; x^2 + 3y^2 \\rangle')}, so ${m('\\nabla f(1,2) = \\langle 4, 13 \\rangle')}.</p>
    <p>Then ${m('D_u f(1,2) = 4 \\cdot \\tfrac{3}{5} + 13 \\cdot \\tfrac{4}{5} = \\tfrac{64}{5}')}.</p>
  </div>

  <h2>4. Remarks</h2>
  <ul>
    <li>Always use a unit vector. Using ${m('v')} instead of ${m('u')} would scale the answer by ${m('|v|')}.</li>
    <li>${m('D_u f')} is largest when ${m('u')} points in the direction of ${m('\\nabla f')}, and the maximum value is ${m('|\\nabla f|')}.</li>
    <li>The gradient is perpendicular to the level curve ${m('f(x,y) = c')} through the point.</li>
  </ul>
  <div class="footer"><span>Synthetic example notes for Loci</span><span>1</span></div>
</section>
</body></html>`

const outDir = join(root, 'public/samples')
mkdirSync(outDir, { recursive: true })
const htmlPath = join(outDir, '.sample.html')
writeFileSync(htmlPath, html)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage()
await page.goto(pathToFileURL(htmlPath).href)
await page.evaluate(() => document.fonts.ready)
await page.pdf({ path: join(outDir, 'directional-derivatives.pdf'), format: 'Letter', printBackground: true })
await browser.close()
const { unlinkSync } = await import('node:fs')
unlinkSync(htmlPath)
console.log('Wrote public/samples/directional-derivatives.pdf')
