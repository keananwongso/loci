import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import '@fontsource-variable/inter'
import 'katex/dist/katex.min.css'
import 'tldraw/tldraw.css'
import './globals.css'

export const metadata: Metadata = {
	title: 'Loci',
	description: 'A spatial canvas for learning any course: Loci explains by drawing, writing and talking right beside your own notes.',
}

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body>
				{children}
				{/* Cookie-free page views for a Vercel deployment; local and self-hosted builds load nothing. */}
				{process.env.VERCEL === '1' && <Analytics />}
			</body>
		</html>
	)
}
