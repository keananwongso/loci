import type { NextConfig } from 'next'

const dev = process.env.NODE_ENV === 'development'

/**
 * Same-origin only, apart from tldraw's CDN (license check, fallback assets). The main job is
 * connect-src/img-src: even if a script got injected, it couldn't send a visitor's own API key
 * (kept in localStorage) anywhere. Next's inline bootstrap scripts still need 'unsafe-inline'.
 */
const csp = [
	"default-src 'self'",
	`script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob: https://cdn.tldraw.com",
	"font-src 'self' data: https://cdn.tldraw.com",
	`connect-src 'self' data: blob: https://cdn.tldraw.com${dev ? ' ws:' : ''}`,
	"media-src 'self' data: blob:",
	"worker-src 'self' blob:",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
	...(dev ? [] : ['upgrade-insecure-requests']),
].join('; ')

const nextConfig: NextConfig = {
	// tldraw and pdf.js are browser-only; the canvas is loaded client-side.
	reactStrictMode: true,
	poweredByHeader: false,
	// Don't write AGENTS.md / CLAUDE.md into the repo on `next dev`.
	agentRules: false,
	devIndicators: false,
	async headers() {
		return [{
			source: '/(.*)',
			headers: [
				{ key: 'Content-Security-Policy', value: csp },
				{ key: 'X-Content-Type-Options', value: 'nosniff' },
				{ key: 'X-Frame-Options', value: 'DENY' },
				{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
				{ key: 'Permissions-Policy', value: 'camera=(), microphone=(self)' },
			],
		}]
	},
}

export default nextConfig
