'use client'
import dynamic from 'next/dynamic'

// The canvas, pdf.js and IndexedDB are browser-only.
const LociApp = dynamic(() => import('@/components/LociApp'), { ssr: false })

export default function Page() {
	return <LociApp />
}
