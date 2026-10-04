/**
 * The stats page's password check (HTTP Basic auth, any username). Used by both the proxy, which
 * makes the browser show its sign-in prompt, and the page itself, so the page never relies on the
 * proxy alone. Without LOCI_STATS_PASSWORD the page does not exist.
 */
export const STATS_REALM = 'Loci stats'

export function statsAuthorized(authorization: string | null, password = process.env.LOCI_STATS_PASSWORD): boolean {
	if (!password || !authorization?.startsWith('Basic ')) return false
	let given: string
	try {
		given = atob(authorization.slice(6)).split(':').slice(1).join(':')
	} catch {
		return false
	}
	// Constant-time comparison, so response timing reveals nothing about the password.
	let diff = given.length ^ password.length
	for (let i = 0; i < password.length; i++) diff |= password.charCodeAt(i) ^ given.charCodeAt(i % Math.max(1, given.length))
	return diff === 0
}
