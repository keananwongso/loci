import type { NextConfig } from 'next'

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
				{ key: 'X-Content-Type-Options', value: 'nosniff' },
				{ key: 'X-Frame-Options', value: 'DENY' },
				{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
				{ key: 'Permissions-Policy', value: 'camera=(), microphone=(self)' },
			],
		}]
	},
}

export default nextConfig
