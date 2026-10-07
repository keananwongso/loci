'use client'
import { useState } from 'react'
import { loadVoiceKey, saveVoiceKey, type VoiceKey } from '@/lib/storage/voiceKey'
export function VoiceKeyForm({ onClose }: { onClose: () => void }) {
 const existing = loadVoiceKey()
 const [provider, setProvider] = useState<VoiceKey['provider']>(existing?.provider || 'fish')
 const [key, setKey] = useState(existing?.key || ''), [voiceId, setVoiceId] = useState(existing?.voiceId || ''), [model, setModel] = useState(existing?.model || '')
 const [testing, setTesting] = useState(false), [message, setMessage] = useState('')
 const headers = () => ({ 'Content-Type': 'application/json', 'x-loci-voice-provider': provider, 'x-loci-voice-key': key.trim(), ...(voiceId.trim() ? { 'x-loci-voice-id': voiceId.trim() } : {}), ...(model.trim() ? { 'x-loci-voice-model': model.trim() } : {}) })
 const test = async () => {
  setTesting(true); setMessage('')
  try {
   const response = await fetch('/api/speech', { method: 'POST', headers: headers(), body: JSON.stringify({ text: 'Your voice is ready for Loci.' }) })
   if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'Voice test failed.') }
   const blob = await response.blob()
   if (!blob.size) throw new Error('The provider returned no audio.')
   const url = URL.createObjectURL(blob), audio = new Audio(url)
   const cleanup = () => URL.revokeObjectURL(url)
   audio.addEventListener('ended', cleanup, { once: true }); audio.addEventListener('error', cleanup, { once: true })
   try { await audio.play(); setMessage('Voice test succeeded.') } catch { cleanup(); setMessage('Audio generated successfully. Your browser blocked playback.') }
  } catch (error) { setMessage(error instanceof Error ? error.message : 'Voice test failed.') }
  finally { setTesting(false) }
 }
 return <form className="loci-modal__card" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()} onSubmit={e=>{ e.preventDefault(); saveVoiceKey({provider, key:key.trim(), voiceId:voiceId.trim() || undefined, model:model.trim() || undefined}); onClose() }}>
  <h2>Use your own voice key</h2>
  <p className="loci-modal__lede">Pay your voice provider directly. Spoken answers use your provider’s allowance instead of Loci’s.</p>
  <label>Provider<select value={provider} onChange={e=>{setProvider(e.target.value as VoiceKey['provider']);setKey('');setVoiceId('');setModel('');setMessage('')}}><option value="fish">Fish Audio</option><option value="elevenlabs">ElevenLabs</option></select></label>
  <label>API key<input type="password" value={key} onChange={e=>setKey(e.target.value)} autoComplete="off" spellCheck={false} required maxLength={4096} placeholder="Paste your voice API key" /></label>
  <label>Voice ID <span className="loci-modal__optional">{provider === 'fish' ? 'Optional: leave empty for the provider’s default voice' : 'Copy a voice ID from your ElevenLabs library'}</span><input value={voiceId} onChange={e=>setVoiceId(e.target.value)} maxLength={120} pattern="[A-Za-z0-9_-]+" required={provider === 'elevenlabs'} spellCheck={false} /></label>
  <label>Model <span className="loci-modal__optional">Optional</span><input value={model} onChange={e=>setModel(e.target.value)} maxLength={120} pattern="[A-Za-z0-9_.-]+" placeholder={provider === 'fish' ? 'Default: s2-pro' : 'Default: eleven_flash_v2_5'} spellCheck={false} /></label>
  <p className="loci-modal__fine">Your key stays in this page’s memory and is forgotten on refresh, close or sign-out. Requests send it over HTTPS through Loci’s server to your selected provider. Loci does not save it to browser storage or a database. This changes spoken answers only; microphone transcription keeps its existing allowance.</p>
  {message && <p role="status">{message}</p>}
  <div className="loci-modal__actions">{existing && <button type="button" className="loci-secondary loci-secondary--sm" onClick={()=>{saveVoiceKey(null);onClose()}}>Remove voice key</button>}<button type="button" className="loci-secondary loci-secondary--sm" onClick={onClose}>Cancel</button><button type="button" className="loci-secondary loci-secondary--sm" disabled={testing || !key.trim() || (provider === 'elevenlabs' && !voiceId.trim())} onClick={test}>{testing ? 'Testing…' : 'Test voice'}</button><button type="submit" className="loci-primary loci-primary--sm" disabled={testing || !key.trim()}>Use voice key</button></div>
 </form>
}
