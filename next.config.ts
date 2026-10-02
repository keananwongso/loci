import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
	// tldraw and pdf.js are browser-only; the canvas is loaded client-side.
	reactStrictMode: true,
	poweredByHeader: false,
}

export default nextConfig
