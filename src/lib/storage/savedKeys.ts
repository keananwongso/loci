'use client'
import { useEffect, useState } from 'react'
import { loadUserKey, saveUserKey, type UserKey } from './userKey'
import { loadVoiceKey, saveVoiceKey, type VoiceKey } from './voiceKey'
export type KeyKind = 'ai' | 'voice'
type SavedAI = Omit<UserKey, 'key'> & { saved: true }
type SavedVoice = Omit<VoiceKey, 'key'> & { saved: true }
export interface SavedKeyStatus { signedIn: boolean; available: boolean; keys: { ai?: SavedAI; voice?: SavedVoice }; error?: string }
let status: SavedKeyStatus = { signedIn: false, available: false, keys: {} }
let refreshEpoch = 0
const announce = () => window.dispatchEvent(new CustomEvent('loci:saved-key-status'))
export function clearSavedKeyStatus() { refreshEpoch++; status = { signedIn: false, available: false, keys: {} }; announce() }
export async function refreshSavedKeys() {
 const epoch = ++refreshEpoch
 try {
  const response = await fetch('/api/keys', { cache: 'no-store' })
  if (!response.ok) throw new Error('Could not load saved keys. Try again.')
  const next = await response.json() as SavedKeyStatus
  if (epoch !== refreshEpoch) return
  status = next
  const ai = loadUserKey(), voice = loadVoiceKey()
  // Never replace a deliberate page-only override with a saved account key.
  if (!ai || ai.saved) saveUserKey(next.keys.ai ? { ...next.keys.ai, key: '' } : null)
  if (!voice || voice.saved) saveVoiceKey(next.keys.voice ? { ...next.keys.voice, key: '' } : null)
 } catch { if (epoch === refreshEpoch) status = { ...status, error: 'Could not load saved keys. Try again.' } }
 if (epoch === refreshEpoch) announce()
}
export function useSavedKeyStatus() {
 const [value, setValue] = useState(status)
 useEffect(() => { const sync = () => setValue(status); window.addEventListener('loci:saved-key-status', sync); void refreshSavedKeys(); return () => window.removeEventListener('loci:saved-key-status', sync) }, [])
 return value
}
export async function rememberKey(kind: KeyKind, credential: UserKey | VoiceKey) {
 const { saved: _saved, ...input } = credential
 const response = await fetch('/api/keys', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, credential: input }) })
 const body = await response.json()
 if (!response.ok) throw new Error(body.error || 'Could not save your key.')
 refreshEpoch++
 status = { ...status, keys: { ...status.keys, [kind]: body.metadata } }
 if (kind === 'ai') saveUserKey({ ...body.metadata, key: '' })
 else saveVoiceKey({ ...body.metadata, key: '' })
 announce()
}
export async function forgetKey(kind: KeyKind) {
 const response = await fetch('/api/keys', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) })
 if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'Could not remove your key.') }
 refreshEpoch++
 const keys = { ...status.keys }; delete keys[kind]; status = { ...status, keys }
 if (kind === 'ai') saveUserKey(null); else saveVoiceKey(null)
 announce()
}
