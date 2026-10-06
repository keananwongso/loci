import { redirect } from 'next/navigation'
import Landing from '@/components/Landing'
import { authConfigured } from '@/lib/server/auth'
import { billingConfigured } from '@/lib/server/billing'
import { limitConfigFromEnv } from '@/lib/server/limits'

export default function Page() {
	if (!limitConfigFromEnv().enabled) redirect('/demo')
	return <Landing accounts={authConfigured()} billing={billingConfigured()} />
}
