'use client'
import { VoiceKeyForm } from './VoiceKeyForm'
import { useState } from 'react'
import { loadUserKey, saveUserKey, type UserKey } from '@/lib/storage/userKey'

const PROVIDERS: Array<{ id: UserKey['provider']; label: string; hint: string }> = [
	{ id: 'anthropic', label: 'Anthropic (Claude)', hint: 'Default model: claude-opus-5-5' },
	{ id: 'openrouter', label: 'OpenRouter', hint: 'Model required, e.g. anthropic/claude-opus-5-5' },
	{ id: 'deepseek', label: 'DeepSeek', hint: 'Default model: deepseek-flash' },
	{ id: 'gemini', label: 'Google Gemini', hint: 'Model required' },
	{ id: 'openai', label: 'OpenAI', hint: 'Model required' },
	{ id: 'groq', label: 'Groq', hint: 'Model required' },
]

export const REPO_URL = 'https://github.com/keananwongso/loci'

/** Lets a visitor use their own API key: unlimited questions, any supported provider. */
export function KeyDialog({ onClose, initialTab = 'ai' }: { onClose: () => void; initialTab?: 'ai' | 'voice' }) {
	const [tab, setTab] = useState(initialTab)
	const existing = loadUserKey()
	const [provider, setProvider] = useState<UserKey['provider']>(existing?.provider ?? 'anthropic')
	const [key, setKey] = useState(existing?.key ?? '')
	const [model, setModel] = useState(existing?.model ?? '')
	const hint = PROVIDERS.find((p) => p.id === provider)?.hint
	const modelRequired = provider !== 'anthropic' && provider !== 'deepseek'

	return (
		<div className="loci-modal" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
			<div className="loci-key-settings" role="dialog" aria-label="API key settings" aria-modal="true" onKeyDown={e => { if (e.key === 'Escape') onClose(); e.stopPropagation() }}>
    <nav aria-label="Key type"><button type="button" aria-pressed={tab === 'ai'} onClick={()=>setTab('ai')}>AI model</button><button type="button" aria-pressed={tab === 'voice'} onClick={()=>setTab('voice')}>Voice</button></nav>
    <div className="loci-key-settings__body">
    <div hidden={tab !== 'voice'}><VoiceKeyForm onClose={onClose} /></div>
    <div hidden={tab !== 'ai'}><form
				className="loci-modal__card"
				onPointerDown={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				onSubmit={(e) => {
					e.preventDefault()
					saveUserKey(key.trim() ? { provider, key: key.trim(), model: model.trim() || undefined } : null)
					onClose()
				}}
			>
				<h2>Use your own API key</h2>
				<p className="loci-modal__lede">Unlimited questions, with the model you choose. You pay your provider directly.</p>
				<label>
					Provider
					<select value={provider} onChange={(e) => setProvider(e.target.value as UserKey['provider'])}>
						{PROVIDERS.map((p) => (
							<option key={p.id} value={p.id}>
								{p.label}
							</option>
						))}
					</select>
				</label>
				<label>
					API key
					<input type="password" autoComplete="off" spellCheck={false} maxLength={4096} value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" required />
				</label>
				<label>
					Model <span className="loci-modal__optional">{hint}</span>
					<input value={model} onChange={(e) => setModel(e.target.value)} placeholder={modelRequired ? 'Enter a model ID' : 'Leave empty for the default'} maxLength={120} required={modelRequired} spellCheck={false} />
				</label>
				<p className="loci-modal__fine">
					Your key stays in memory while this page is open. Refreshing or closing the page forgets it.
					Each question sends it over HTTPS to Loci&rsquo;s server, which uses it to contact your provider.
					Loci does not save it to a database or browser storage. Only enter a key on a device you trust. You can also{' '}
					<a href={REPO_URL} target="_blank" rel="noreferrer">
						run Loci on your own computer
					</a>
					.
				</p>
				<div className="loci-modal__actions">
					{existing && (
						<button
							type="button"
							className="loci-secondary loci-secondary--sm"
							onClick={() => {
								saveUserKey(null)
								onClose()
							}}
						>
							Remove key
						</button>
					)}
					<button type="button" className="loci-secondary loci-secondary--sm" onClick={onClose}>
						Cancel
					</button>
					<button type="submit" className="loci-primary loci-primary--sm" disabled={!key.trim()}>
						Use key
					</button>
				</div>
			</form></div></div>
   </div>
		</div>
	)
}
