'use client'
import { useEffect } from 'react'
import { removeLegacyUserKey, saveUserKey } from '@/lib/storage/userKey'

import { clearSavedKeyStatus, refreshSavedKeys } from '@/lib/storage/savedKeys'
import { saveVoiceKey } from '@/lib/storage/voiceKey'

/** Purge old saved keys on every page, including account and landing pages. */
export function KeyPrivacy() {
	useEffect(() => {
		removeLegacyUserKey()
		const clear = () => { saveUserKey(null); saveVoiceKey(null); clearSavedKeyStatus() }
		void refreshSavedKeys()
		const restore = (event: PageTransitionEvent) => { if (event.persisted) void refreshSavedKeys() }
		const purge = (event: StorageEvent) => { if (event.key === 'loci:user-key') removeLegacyUserKey() }
		window.addEventListener('pagehide', clear)
		window.addEventListener('pageshow', restore)
		window.addEventListener('storage', purge)
		return () => {
			window.removeEventListener('pagehide', clear)
			window.removeEventListener('pageshow', restore)
			window.removeEventListener('storage', purge)
		}
	}, [])
	return null
}
