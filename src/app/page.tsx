import { redirect } from 'next/navigation'
import Landing from '@/components/Landing'
import { authConfigured, currentUser } from '@/lib/server/auth'
import { billingConfigured } from '@/lib/server/billing'
import { limitConfigFromEnv } from '@/lib/server/limits'

export default async function Page() {
	const signedIn = authConfigured() && Boolean(await currentUser().catch(() => null))
	if (!limitConfigFromEnv().enabled) redirect('/demo')
	return <Landing accounts={authConfigured()} billing={billingConfigured()} signedIn={signedIn} />
}
