'use client'
import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'

// The canvas, pdf.js and IndexedDB are browser-only.
const LociApp = dynamic(() => import('@/components/LociApp'), { ssr: false })

/** A board saved to the signed-in account. */
export default function Page() {
	const { id } = useParams<{ id: string }>()
	return <LociApp key={id} boardId={id} />
}
