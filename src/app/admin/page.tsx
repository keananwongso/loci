import { notFound } from 'next/navigation'
import { AdminApp } from './AdminApp'

export const metadata = { title: 'Loci · Demo admin' }

/** The demo pack editor. Exists only on a development server; a deployed site 404s. */
export default function AdminPage() {
	if (process.env.NODE_ENV !== 'development') notFound()
	return <AdminApp />
}
