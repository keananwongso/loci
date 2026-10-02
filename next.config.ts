import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
	// tldraw and pdf.js are browser-only; the canvas is loaded client-side.
	reactStrictMode: true,
	poweredByHeader: false,
	// Don't write AGENTS.md / CLAUDE.md into the repo on `next dev`.
	agentRules: false,
	devIndicators: false,
}

export default nextConfig
