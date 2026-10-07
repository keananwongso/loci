'use client'
import { useEffect, useState } from 'react'
import { loadVoiceKey, saveVoiceKey, type VoiceKey } from '@/lib/storage/voiceKey'
import { forgetKey, rememberKey, type SavedKeyStatus } from '@/lib/storage/savedKeys'
export function VoiceKeyForm({ onClose, account }: { onClose: () => void; account: SavedKeyStatus }) {
 const existing = loadVoiceKey()
 const [provider, setProvider] = useState<VoiceKey['provider']>(existing?.provider || 'fish')
 const [key, setKey] = useState(existing?.key || ''), [voiceId, setVoiceId] = useState(existing?.voiceId || ''), [model, setModel] = useState(existing?.model || '')
 const [remember, setRemember] = useState(Boolean(existing?.saved)), [dirty, setDirty] = useState(false)
 const [testing, setTesting] = useState(false), [saving, setSaving] = useState(false), [message, setMessage] = useState('')
 useEffect(() => {
  if (dirty) return
  const value = loadVoiceKey()
  if (value) { setProvider(value.provider); setVoiceId(value.voiceId || ''); setModel(value.model || ''); setRemember(Boolean(value.saved)) }
 }, [account, dirty])
 const saved = account.keys.voice
 const sameSavedProvider = saved?.provider === provider
 const canUse = Boolean(key.trim() || (remember && sameSavedProvider)) && (provider !== 'elevenlabs' || Boolean(voiceId.trim()))
 const canTestSaved = sameSavedProvider && voiceId.trim() === (saved?.voiceId || '') && model.trim() === (saved?.model || '')
 const edit = () => { setDirty(true); setMessage('') }
 const test = async () => {
  setTesting(true); setMessage('')
  try {
   const headers: Record<string,string> = { 'Content-Type': 'application/json' }
   if (!key.trim() && canTestSaved) headers['x-loci-saved-voice'] = '1'
   else Object.assign(headers, { 'x-loci-voice-provider': provider, 'x-loci-voice-key': key.trim(), ...(voiceId.trim() ? { 'x-loci-voice-id': voiceId.trim() } : {}), ...(model.trim() ? { 'x-loci-voice-model': model.trim() } : {}) })
   const response = await fetch('/api/speech', { method: 'POST', headers, body: JSON.stringify({ text: 'Your voice is ready for Loci.' }) })
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
 const submit = async () => {
  setSaving(true); setMessage('')
  try {
   const value = { provider, key:key.trim(), voiceId:voiceId.trim() || undefined, model:model.trim() || undefined }
   if (remember) await rememberKey('voice', value)
   else { if (saved) await forgetKey('voice'); saveVoiceKey(value) }
   setKey(''); onClose()
  } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update your key.') }
  finally { setSaving(false) }
 }
 const remove = async () => {
  setSaving(true); setMessage('')
  try { if (saved) await forgetKey('voice'); saveVoiceKey(null); setKey(''); onClose() }
  catch (error) { setMessage(error instanceof Error ? error.message : 'Could not remove your key.') }
  finally { setSaving(false) }
 }
 return <form className="loci-modal__card" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key !== 'Escape')e.stopPropagation()}} onSubmit={e=>{e.preventDefault(); if(canUse && !saving && !testing)void submit()}}>
  <h2>Use your own voice key</h2>
  <p className="loci-modal__lede">{provider === 'fish' ? 'Your Fish key covers spoken answers and microphone transcription.' : 'Your ElevenLabs key covers spoken answers. Microphone transcription uses Loci’s allowance.'} You pay your provider directly.</p>
  {saved && <p className="loci-key-saved" role="status">{saved.provider === 'fish' ? 'Fish Audio' : 'ElevenLabs'} key saved securely to your account.</p>}
  <label>Provider<select disabled={saving || testing} value={provider} onChange={e=>{edit();setProvider(e.target.value as VoiceKey['provider']);setKey('');setVoiceId('');setModel('')}}><option value="fish">Fish Audio</option><option value="elevenlabs">ElevenLabs</option></select></label>
  <label>API key<input type="password" disabled={saving || testing} value={key} onChange={e=>{edit();setKey(e.target.value)}} autoComplete="off" spellCheck={false} required={!remember || !sameSavedProvider} maxLength={4096} placeholder={sameSavedProvider ? 'Saved securely · paste to replace' : 'Paste your voice API key'} /></label>
  <label>Voice ID <span className="loci-modal__optional">{provider === 'fish' ? 'Optional: leave empty for the default voice' : 'Copy a voice ID from your ElevenLabs library'}</span><input disabled={saving || testing} value={voiceId} onChange={e=>{edit();setVoiceId(e.target.value)}} maxLength={120} pattern="[A-Za-z0-9_-]+" required={provider === 'elevenlabs'} spellCheck={false} /></label>
  <label>Model <span className="loci-modal__optional">Optional</span><input disabled={saving || testing} value={model} onChange={e=>{edit();setModel(e.target.value)}} maxLength={120} pattern="[A-Za-z0-9_.-]+" placeholder={provider === 'fish' ? 'Default: s2-pro' : 'Default: eleven_flash_v2_5'} spellCheck={false} /></label>
  {account.signedIn && account.available && <label className="loci-key-remember"><input type="checkbox" checked={remember} disabled={saving || testing} onChange={e=>{edit();setRemember(e.target.checked)}} /><span>Remember my key on this account</span></label>}
  <p className="loci-modal__fine">{remember ? 'Saved keys are encrypted in your account and used only on Loci’s server. They stay available after refresh and sign-in until you remove them. The browser never receives a saved key.' : 'Your key stays in this page’s memory and is forgotten on refresh, close or sign-out. Requests send it over HTTPS through Loci’s server to your provider.'} {!account.signedIn && <><a href="/account">Sign in</a> to remember keys.</>}</p>
  {(message || account.error) && <p role="status">{message || account.error}</p>}
  <div className="loci-modal__actions">{(existing || saved) && <button type="button" className="loci-secondary loci-secondary--sm" disabled={saving || testing} onClick={()=>void remove()}>Remove voice key</button>}<button type="button" className="loci-secondary loci-secondary--sm" disabled={saving || testing} onClick={onClose}>Cancel</button><button type="button" className="loci-secondary loci-secondary--sm" disabled={saving || testing || (!key.trim() && !canTestSaved) || (provider === 'elevenlabs' && !voiceId.trim())} onClick={()=>void test()}>{testing ? 'Testing…' : 'Test voice'}</button><button type="submit" className="loci-primary loci-primary--sm" disabled={saving || testing || !canUse}>{saving ? 'Saving…' : remember ? 'Save voice key' : 'Use voice key'}</button></div>
 </form>
}
