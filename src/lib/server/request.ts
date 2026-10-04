import 'server-only'

/** Reject cross-site browser requests before consuming the public demo's quota. */
export function refuseCrossOrigin(req: Request): Response | null {
	const origin = req.headers.get('origin')
	if (origin && origin !== new URL(req.url).origin)
		return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 })
	return null
}

/** Enforce a byte limit even when Content-Length is missing or inaccurate. */
export async function readLimitedBody(req: Request, maxBytes: number): Promise<Uint8Array | Response> {
	if (Number(req.headers.get('content-length')) > maxBytes)
		return Response.json({ error: 'Request too large.' }, { status: 413 })
	if (!req.body) return new Uint8Array()
	const reader = req.body.getReader()
	const chunks: Uint8Array[] = []
	let size = 0
	try {
		for (;;) {
			const { value, done } = await reader.read()
			if (done) break
			size += value.byteLength
			if (size > maxBytes) {
				await reader.cancel()
				return Response.json({ error: 'Request too large.' }, { status: 413 })
			}
			chunks.push(value)
		}
	} catch {
		return Response.json({ error: 'Invalid request body.' }, { status: 400 })
	} finally {
		reader.releaseLock()
	}
	const body = new Uint8Array(size)
	let offset = 0
	for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
	return body
}

export async function readLimitedJson(req: Request, maxBytes: number): Promise<{ value: unknown } | Response> {
	const body = await readLimitedBody(req, maxBytes)
	if (body instanceof Response) return body
	try { return { value: JSON.parse(new TextDecoder().decode(body)) } }
	catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }) }
}
