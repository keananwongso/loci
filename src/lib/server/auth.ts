import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export function authConfigured() { return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) }
/** Magic links need production SMTP; Supabase's built-in sender only reaches project team members. */
export const emailSignInEnabled = () => process.env.LOCI_EMAIL_SIGNIN === 'on'
/** The OAuth client for Google's sign-in button; it is public and must also be listed in Supabase's Google provider. */
export const googleClientId = () => (authConfigured() && process.env.GOOGLE_CLIENT_ID) || null

/** All auth calls stay on the server, preserving the app's same-origin CSP. */
export async function authClient() {
	if (!authConfigured()) throw new Error('Accounts are not configured.')
	const jar = await cookies()
	return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
		cookieOptions: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' },
		cookies: { getAll: () => jar.getAll(), setAll: (values) => { for (const { name, value, options } of values) jar.set(name, value, options) } },
	})
}

export async function currentUser() {
	if (!authConfigured()) return null
	const { data, error } = await (await authClient()).auth.getUser()
	if (error) {
		// Missing/expired sessions are anonymous; infrastructure failures must not look like sign-out.
		if (error.name === 'AuthSessionMissingError' || error.status === 400 || error.status === 401 || error.status === 403) return null
		throw error
	}
	return data.user
}

export function accountDb() {
	if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Account database is not configured.')
	return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Use a configured canonical origin; never take checkout/callback URLs from client input. */
export function appOrigin(req: Request) {
	const configured = process.env.LOCI_APP_URL
	if (configured) return new URL(configured).origin
	if (process.env.NODE_ENV === 'production') throw new Error('LOCI_APP_URL is required for hosted accounts.')
	return new URL(req.url).origin
}
