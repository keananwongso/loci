import type { NextConfig } from 'next'

const dev = process.env.NODE_ENV === 'development'
// Account boards load their files from signed storage URLs, and upload to them directly.
const storage = process.env.SUPABASE_URL ? ` ${new URL(process.env.SUPABASE_URL).origin}/storage/v1/object/` : ''

/**
 * Same-origin canvas resources; account storage is allowed separately. The main job is
 * connect-src/img-src: even if a script got injected, it couldn't send a visitor's own API key
 * (kept in localStorage) anywhere. Next's inline bootstrap scripts still need 'unsafe-inline'.
 */
const policy = (google = false) => [
	"default-src 'self'",
	`script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}${google ? ` ${GSI}client` : ''}`,
	`style-src 'self' 'unsafe-inline'${google ? ` ${GSI}style` : ''}`,
	`img-src 'self' data: blob:${storage}`,
	"font-src 'self' data:",
	`connect-src 'self' data: blob:${storage}${dev ? ' ws:' : ''}${google ? ` ${GSI}` : ''}`,
	...(google ? [`frame-src ${GSI}`] : []),
	`media-src 'self' data: blob:${storage}`,
	"worker-src 'self' blob:",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
	...(dev ? [] : ['upgrade-insecure-requests']),
].join('; ')
/** Google's sign-in button. Allowed only on the account page; the canvas, where API keys live, stays same-origin. */
// Links into /account must use full navigation: client routing retains the previous document's CSP.
const GSI = 'https://accounts.google.com/gsi/'

const nextConfig: NextConfig = {
	// The whiteboard and pdf.js are browser-only; the canvas is loaded client-side.
	reactStrictMode: true,
	poweredByHeader: false,
	// Don't write AGENTS.md / CLAUDE.md into the repo on `next dev`.
	agentRules: false,
	devIndicators: false,
	async headers() {
		return [{
			source: '/(.*)',
			headers: [
				{ key: 'Content-Security-Policy', value: policy() },
				{ key: 'X-Content-Type-Options', value: 'nosniff' },
				{ key: 'X-Frame-Options', value: 'DENY' },
				{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
				{ key: 'Permissions-Policy', value: 'camera=(), microphone=(self)' },
			],
		}, {
			// Later entries override the same header for matching paths.
			source: '/account',
			headers: [{ key: 'Content-Security-Policy', value: policy(true) }],
		}]
	},
}

export default nextConfig
