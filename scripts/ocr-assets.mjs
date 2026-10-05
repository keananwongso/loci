// Copies tesseract.js's worker, wasm core and English data into public/ocr, so text recognition
// for images is served by this app (the content security policy allows nothing else).
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const pkg = (name) => path.dirname(require.resolve(`${name}/package.json`))
const out = path.join(import.meta.dirname, '..', 'public', 'ocr')

const files = [
	[path.join(pkg('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
	// tesseract.js picks one of these by the browser's SIMD support (LSTM engine only).
	...['', '-simd', '-relaxedsimd'].map((v) => [path.join(pkg('tesseract.js-core'), `tesseract-core${v}-lstm.wasm.js`), `tesseract-core${v}-lstm.wasm.js`]),
	[path.join(pkg('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
]

mkdirSync(out, { recursive: true })
for (const [from, name] of files) {
	const to = path.join(out, name)
	if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to)
}
