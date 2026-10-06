import 'server-only'
import type { User } from '@supabase/supabase-js'
import { accountDb, authConfigured, currentUser } from './auth'
import { billingConfigured, readSubscription, subscriptionActive } from './billing'
import { refuseCrossOrigin } from './request'

export const BUCKET = 'loci-files'
export const FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'application/json'] as const
const MB = 1024 * 1024
const count = (value: string | undefined, fallback: number) => (/^\d+$/.test(value ?? '') ? Number(value) : fallback)

export interface Plan { pro: boolean; boards: number; bytes: number }

/** Free accounts get a taste of saved boards; Loci Pro gets room to study. */
export function planLimits(pro: boolean): Plan {
	return pro
		? { pro, boards: count(process.env.LOCI_PRO_BOARDS, 1000), bytes: count(process.env.LOCI_PRO_STORAGE_MB, 2048) * MB }
		: { pro, boards: count(process.env.LOCI_FREE_BOARDS, 3), bytes: count(process.env.LOCI_FREE_STORAGE_MB, 25) * MB }
}

export async function planFor(user: User): Promise<Plan> {
	const subscription = billingConfigured() ? await readSubscription(user.id) : null
	return planLimits(subscriptionActive(subscription))
}

export async function storageUsed(userId: string): Promise<number> {
	const { data, error } = await accountDb().rpc('loci_storage_used', { p_user: userId })
	if (error) throw error
	return Number(data ?? 0)
}

/** Each user's files live under their own id; the path never comes from the client. */
export const filePath = (userId: string, key: string) => `${userId}/${key}`

/** The signed-in user for an account route, or the response to send instead. */
export async function accountUser(req: Request, { mutating }: { mutating: boolean }): Promise<User | Response> {
	if (mutating) {
		const refused = refuseCrossOrigin(req)
		if (refused) return refused
	}
	if (!authConfigured()) return Response.json({ error: 'Accounts are not available yet.' }, { status: 503 })
	const user = await currentUser()
	return user ?? Response.json({ error: 'Sign in to save boards to your account.' }, { status: 401 })
}

export const noStore = { 'Cache-Control': 'no-store' }
