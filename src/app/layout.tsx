import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/inter'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import 'katex/dist/katex.min.css'
import 'tldraw/tldraw.css'
import './globals.css'

export const metadata: Metadata = {
	title: 'Loci',
	description: 'A local-first spatial AI tutor that teaches by drawing beside your course material.',
}

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	)
}
