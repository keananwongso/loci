'use client'
/** Voice credentials are independent of model credentials and never persisted. */
export interface VoiceKey { provider: 'fish' | 'elevenlabs'; key: string; voiceId?: string; model?: string }
let current: VoiceKey | null = null
export const loadVoiceKey = (): VoiceKey | null => current ? { ...current } : null
export function saveVoiceKey(value: VoiceKey | null) {
 current = value ? { ...value } : null
 window.dispatchEvent(new CustomEvent('loci:voice-key'))
}
export function voiceKeyHeaders(): Record<string, string> {
 const value = loadVoiceKey()
 if (!value) return {}
 return { 'x-loci-voice-key': value.key, 'x-loci-voice-provider': value.provider, ...(value.voiceId ? { 'x-loci-voice-id': value.voiceId } : {}), ...(value.model ? { 'x-loci-voice-model': value.model } : {}) }
}
