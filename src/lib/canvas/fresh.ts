/**
 * Tracks objects the tutor just created so their components animate in exactly once
 * (and not again when they scroll back into view or the board reloads).
 */
const fresh = new Map<string, number>()
const TTL = 2500

export function markFresh(key: string) {
	fresh.set(key, Date.now())
}

/** True if `key` was created in the last few seconds. */
export function consumeFresh(key: string): boolean {
	const at = fresh.get(key)
	if (at === undefined) return false
	if (Date.now() - at > TTL) {
		fresh.delete(key)
		return false
	}
	return true
}
