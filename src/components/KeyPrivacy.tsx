'use client'
import { useEffect } from 'react'
import { removeLegacyUserKey, saveUserKey } from '@/lib/storage/userKey'

import { saveVoiceKey } from '@/lib/storage/voiceKey'

/** Purge old saved keys on every page, including account and landing pages. */
export function KeyPrivacy() {
	useEffect(() => {
		removeLegacyUserKey()
		const clear = () => { saveUserKey(null); saveVoiceKey(null) }
		const purge = (event: StorageEvent) => { if (event.key === 'loci:user-key') removeLegacyUserKey() }
		window.addEventListener('pagehide', clear)
		window.addEventListener('storage', purge)
		return () => {
			window.removeEventListener('pagehide', clear)
			window.removeEventListener('storage', purge)
		}
	}, [])
	return null
}
