'use client'
import { VoiceKeyForm } from './VoiceKeyForm'
import { useEffect, useState } from 'react'
import { loadUserKey, saveUserKey, type UserKey } from '@/lib/storage/userKey'
import { forgetKey, rememberKey, useSavedKeyStatus } from '@/lib/storage/savedKeys'

const PROVIDERS: Array<{ id: UserKey['provider']; label: string; hint: string }> = [
 { id: 'anthropic', label: 'Anthropic (Claude)', hint: 'Default: claude-opus-5-5' },
 { id: 'openrouter', label: 'OpenRouter', hint: 'Model required, e.g. anthropic/claude-opus-5-5' },
 { id: 'deepseek', label: 'DeepSeek', hint: 'Default: deepseek-flash' },
 { id: 'gemini', label: 'Google Gemini', hint: 'Model required' },
 { id: 'openai', label: 'OpenAI', hint: 'Model required' },
 { id: 'groq', label: 'Groq', hint: 'Model required' },
]
export const REPO_URL = 'https://github.com/keananwongso/loci'
export function KeyDialog({ onClose, initialTab = 'ai' }: { onClose: () => void; initialTab?: 'ai' | 'voice' }) {
 const [tab, setTab] = useState(initialTab)
 const account = useSavedKeyStatus()
 const existing = loadUserKey()
 const [provider, setProvider] = useState<UserKey['provider']>(existing?.provider ?? 'anthropic')
 const [key, setKey] = useState(existing?.key ?? ''), [model, setModel] = useState(existing?.model ?? '')
 const [remember, setRemember] = useState(Boolean(existing?.saved))
 const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [message, setMessage] = useState('')
 useEffect(() => {
  if (dirty) return
  const value = loadUserKey()
  if (value) { setProvider(value.provider); setModel(value.model || ''); setRemember(Boolean(value.saved)) }
 }, [account, dirty])
 const saved = account.keys.ai
 const sameSavedProvider = saved?.provider === provider
 const canUse = Boolean(key.trim() || (remember && sameSavedProvider))
 const modelRequired = provider !== 'anthropic' && provider !== 'deepseek'
 const edit = () => { setDirty(true); setMessage('') }
 const submit = async () => {
  setSaving(true); setMessage('')
  try {
   const value = { provider, key: key.trim(), model: model.trim() || undefined }
   if (remember) await rememberKey('ai', value)
   else { if (saved) await forgetKey('ai'); saveUserKey(value) }
   setKey(''); onClose()
  } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update your key.') }
  finally { setSaving(false) }
 }
 const remove = async () => {
  setSaving(true); setMessage('')
  try { if (saved) await forgetKey('ai'); saveUserKey(null); setKey(''); onClose() }
  catch (error) { setMessage(error instanceof Error ? error.message : 'Could not remove your key.') }
  finally { setSaving(false) }
 }
 return <div className="loci-modal" onPointerDown={e => !saving && e.target === e.currentTarget && onClose()}>
  <div className="loci-key-settings" role="dialog" aria-label="API key settings" aria-modal="true" onKeyDown={e => { if (e.key === 'Escape' && !saving) onClose(); e.stopPropagation() }}>
   <nav aria-label="Key type"><button type="button" aria-pressed={tab === 'ai'} onClick={() => setTab('ai')}>AI model</button><button type="button" aria-pressed={tab === 'voice'} onClick={() => setTab('voice')}>Voice</button></nav>
   <div className="loci-key-settings__body">
    <div hidden={tab !== 'voice'}><VoiceKeyForm onClose={onClose} account={account} /></div>
    <div hidden={tab !== 'ai'}><form className="loci-modal__card" onPointerDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key !== 'Escape') e.stopPropagation() }} onSubmit={e => { e.preventDefault(); if (canUse && !saving) void submit() }}>
     <h2>Use your own API key</h2>
     <p className="loci-modal__lede">Use the model you choose. You pay your provider directly.</p>
     {saved && <p className="loci-key-saved" role="status">{PROVIDERS.find(p => p.id === saved.provider)?.label} key saved securely to your account.</p>}
     <label>Provider<select value={provider} disabled={saving} onChange={e => { edit(); setProvider(e.target.value as UserKey['provider']); setKey(''); setModel('') }}>{PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
     <label>API key<input type="password" autoComplete="off" spellCheck={false} maxLength={4096} value={key} disabled={saving} onChange={e => { edit(); setKey(e.target.value) }} placeholder={sameSavedProvider ? 'Saved securely · paste to replace' : 'Paste your key'} required={!remember || !sameSavedProvider} /></label>
     <label>Model <span className="loci-modal__optional">{PROVIDERS.find(p => p.id === provider)?.hint}</span><input value={model} disabled={saving} onChange={e => { edit(); setModel(e.target.value) }} placeholder={modelRequired ? 'Enter a model ID' : 'Leave empty for the default'} maxLength={120} required={modelRequired} spellCheck={false} /></label>
     {account.signedIn && account.available && <label className="loci-key-remember"><input type="checkbox" checked={remember} disabled={saving} onChange={e => { edit(); setRemember(e.target.checked) }} /><span>Remember my key on this account</span></label>}
     <p className="loci-modal__fine">{remember ? 'Saved keys are encrypted in your account and used only on Loci’s server. They stay available after refresh and sign-in until you remove them. The browser never receives a saved key.' : 'This key stays in this page’s memory and is forgotten on refresh, close or sign-out. Requests send it over HTTPS through Loci’s server to your provider.'} {!account.signedIn && <><a href="/account">Sign in</a> to remember keys.</>}</p>
     {(message || account.error) && <p role="alert">{message || account.error}</p>}
     <div className="loci-modal__actions">
      {(existing || saved) && <button type="button" className="loci-secondary loci-secondary--sm" disabled={saving} onClick={() => void remove()}>Remove key</button>}
      <button type="button" className="loci-secondary loci-secondary--sm" disabled={saving} onClick={onClose}>Cancel</button>
      <button type="submit" className="loci-primary loci-primary--sm" disabled={saving || !canUse}>{saving ? 'Saving…' : remember ? 'Save key' : 'Use key'}</button>
     </div>
    </form></div>
   </div>
  </div>
 </div>
}
