import 'server-only'
/**
 * The demo pack's admin API: only on a development server (npm run dev) opened through localhost.
 * It edits the files in public/demo/, which you then commit; a deployed site has no admin at all.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DemoPackSchema, packLines, type DemoPack, type Take } from '@/lib/demo/pack'

export const DEMO_ROOT = join(process.cwd(), 'public', 'demo')

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

const isLocal = (host: string) => LOCAL_HOSTS.has(host.replace(/:\d+$/, ''))

/**
 * A 404 unless this is a dev server reached on this machine, from its own pages. The custom header
 * can't be sent cross-site without a CORS preflight, which this server never grants, so another
 * website open in the same browser can't write to the pack.
 */
export function adminRefusal(req: Request): Response | null {
	const origin = req.headers.get('origin')
	const local =
		isLocal(new URL(req.url).hostname) &&
		isLocal(req.headers.get('host') ?? '') &&
		(!origin || isLocal(new URL(origin).host)) &&
		req.headers.get('x-loci-admin') === '1'
	if (process.env.NODE_ENV === 'development' && local) return null
	return Response.json({ error: 'Not found.' }, { status: 404 })
}

/** A file name safe to write inside public/demo/. */
export function safeName(name: string): string | null {
	const clean = name
		.normalize('NFKD')
		.replace(/[^\w.-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^[-.]+/, '')
		.slice(-80)
	return /^[\w.-]+\.(pdf|png|jpe?g|webp)$/i.test(clean) ? clean : null
}

async function writeAtomic(path: string, data: string | Uint8Array) {
	const tmp = `${path}.${process.pid}.tmp`
	await writeFile(tmp, data)
	await rename(tmp, path)
}

export async function readPackRaw(): Promise<unknown> {
	return JSON.parse(await readFile(join(DEMO_ROOT, 'pack.json'), 'utf8'))
}

export async function readPack(): Promise<DemoPack> {
	return DemoPackSchema.parse(await readPackRaw())
}

export async function writePack(pack: DemoPack) {
	await writeAtomic(join(DEMO_ROOT, 'pack.json'), JSON.stringify(pack, null, 2) + '\n')
}

export async function listFiles(dir = ''): Promise<string[]> {
	const entries = await readdir(join(DEMO_ROOT, dir), { withFileTypes: true }).catch(() => [])
	return entries.filter((e) => e.isFile() && !e.name.endsWith('.tmp')).map((e) => (dir ? `${dir}/${e.name}` : e.name))
}

export async function writeDemoFile(relative: string, data: string | Uint8Array) {
	const path = join(DEMO_ROOT, relative)
	await mkdir(join(path, '..'), { recursive: true })
	await writeAtomic(path, data)
}

export async function removeDemoFile(relative: string) {
	await rm(join(DEMO_ROOT, relative), { force: true })
}

export async function readTake(relative: string): Promise<Take | null> {
	try {
		return JSON.parse(await readFile(join(DEMO_ROOT, relative), 'utf8')) as Take
	} catch {
		return null
	}
}

export async function readVoiceMap(): Promise<Record<string, string>> {
	try {
		return JSON.parse(await readFile(join(DEMO_ROOT, 'voice.json'), 'utf8'))
	} catch {
		return {}
	}
}

export async function writeVoiceMap(map: Record<string, string>) {
	const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
	await writeAtomic(join(DEMO_ROOT, 'voice.json'), JSON.stringify(sorted, null, 2) + '\n')
}

/** Clip file for a line in a given voice, so changing the voice re-renders everything. */
export function clipName(text: string, voice: string) {
	return `voice/${createHash('sha256').update(`${voice}\n${text}`).digest('hex').slice(0, 16)}.mp3`
}

/** Every line the demo can speak: the pack's own lines and everything its takes say. */
export async function demoLines(pack: DemoPack): Promise<string[]> {
	const lines = new Set(packLines(pack).map((l) => l.trim()))
	for (const step of pack.steps)
		for (const branch of step.branches) {
			if (!branch.take) continue
			const take = await readTake(branch.take)
			for (const e of take?.events ?? []) if (e.type === 'say' && e.text.trim()) lines.add(e.text.trim())
		}
	return [...lines]
}
