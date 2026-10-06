import { redirect } from 'next/navigation'
import Landing from '@/components/Landing'
import { authConfigured, currentUser } from '@/lib/server/auth'
import { billingConfigured } from '@/lib/server/billing'
import { limitConfigFromEnv } from '@/lib/server/limits'

export default async function Page() {
	// Signed-in students go straight to their boards; the landing page is for everyone else.
	if (authConfigured() && (await currentUser().catch(() => null))) redirect('/home')
	if (!limitConfigFromEnv().enabled) redirect('/demo')
	return <Landing accounts={authConfigured()} billing={billingConfigured()} />
}
