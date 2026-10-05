// Runs the Next.js CLI with its anonymous usage telemetry turned off.
// Loci sends nothing anywhere except to the model provider you configure.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
if (['dev', 'build'].includes(process.argv[2])) await import('./ocr-assets.mjs')
const bin = require.resolve('next/dist/bin/next')
const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], {
	stdio: 'inherit',
	env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
})
child.on('exit', (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 0)))
