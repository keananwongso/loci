'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

interface Account {
	configured: boolean; google: boolean; emailSignIn: boolean; billing: boolean; user: { id: string; email?: string } | null; pro: boolean; allowance: number; daily: number; speech: number
	subscription: { status: string; periodEnd: number; cancelling: boolean } | null
	quota: { remaining: number; limit: number } | null
}
interface GoogleId {
	initialize(config: { client_id: string; nonce: string; callback: (response: { credential: string }) => void; ux_mode: 'popup'; context: 'signin'; use_fedcm_for_button: boolean; itp_support: boolean }): void
	renderButton(parent: HTMLElement, options: { theme: 'outline'; size: 'large'; shape: 'pill'; text: 'continue_with'; width: number }): void
}
declare global { interface Window { google?: { accounts: { id: GoogleId } } } }

let gsi: Promise<GoogleId> | undefined
const loadGoogle = () => gsi ??= new Promise<GoogleId>((resolve, reject) => {
	const script = document.createElement('script')
	script.src = 'https://accounts.google.com/gsi/client'
	script.async = true
	script.onload = () => window.google ? resolve(window.google.accounts.id) : reject(new Error('Google sign-in did not load.'))
	script.onerror = () => { gsi = undefined; reject(new Error('Google sign-in did not load. Check your connection or ad blocker.')) }
	document.head.appendChild(script)
})

/** Google's own button: the popup names this site, and the token is verified on the server. */
function GoogleButton({ onSignedIn, onError }: { onSignedIn: () => Promise<unknown>; onError: (message: string) => void }) {
	const ref = useRef<HTMLDivElement>(null)
	const [attempt, setAttempt] = useState(0)
	useEffect(() => {
		let cancelled = false
		Promise.all([loadGoogle(), fetch('/api/auth/google', { cache: 'no-store' }).then(async (res) => {
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Google sign-in is not available.')
			return data as { clientId: string; nonce: string }
		})]).then(([google, { clientId, nonce }]) => {
			if (cancelled || !ref.current) return
			google.initialize({ client_id: clientId, nonce, ux_mode: 'popup', context: 'signin', use_fedcm_for_button: true, itp_support: true, callback: async ({ credential }) => {
				try {
					const res = await fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) })
					const data = await res.json()
					if (!res.ok) throw new Error(data.error || 'Google sign-in failed. Try again.')
					await onSignedIn()
				} catch (err) {
					onError(err instanceof Error ? err.message : 'Google sign-in failed. Try again.')
					// Each nonce is single-use, so a retry needs a fresh button.
					setAttempt((n) => n + 1)
				}
			} })
			ref.current.replaceChildren()
			google.renderButton(ref.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: Math.min(360, ref.current.clientWidth || 360) })
		}).catch((err) => { if (!cancelled) onError(err.message) })
		return () => { cancelled = true }
	}, [attempt, onSignedIn, onError])
	return <div ref={ref} className="loci-account__google" />
}

export default function AccountPage() {
	const [account, setAccount] = useState<Account | null>(null)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState('')
	const [notice, setNotice] = useState('')
	const [email, setEmail] = useState('')
	const load = async (refresh = false) => {
		const response = await fetch('/api/account', { method: refresh ? 'POST' : 'GET', cache: 'no-store' })
		const data = await response.json()
		if (!response.ok) throw new Error(data.error || 'Could not load your account.')
		setAccount(data)
		return data as Account
	}
	useEffect(() => {
		const params = new URL(window.location.href).searchParams
		if (params.has('error')) setError('That sign-in link expired or could not be verified. Request another link.')
		if (params.get('checkout') === 'cancelled') setNotice('Checkout cancelled. You have not started a subscription.')
		load(params.get('checkout') === 'success').then((data) => {
			if (params.get('checkout') === 'success') setNotice(data.pro ? 'Your subscription is ready. Open your boards to start learning.' : 'Your payment is still being confirmed. Refresh your account in a moment.')
		}).catch((err) => setError(err.message))
	}, [])
	const act = async (path: string, body?: object) => {
		setPending(true); setError(''); setNotice('')
		try {
			const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
			const data = await res.json()
			if (!res.ok) throw new Error(data.error || 'Please try again.')
			if (data.url) { window.location.assign(data.url); return }
			if (data.sent) setNotice('Check your email for a sign-in link. Open it in this browser.')
			else await load()
		} catch (err) { setError(err instanceof Error ? err.message : 'Please try again.') }
		finally { setPending(false) }
	}
	const signedIn = useCallback(() => { setError(''); return load() }, [])
	return <main className="loci-account">
		<nav><Link className="loci-brand" href="/">Loci</Link><Link href={account?.user ? '/home' : '/demo'}>{account?.user ? 'Your boards →' : 'Open workspace →'}</Link></nav>
		<section className="loci-account__card">
			<p className="loci-landing__eyebrow">Your Loci account</p>
			<h1>{account?.user ? 'Keep learning.' : 'Make room for understanding.'}</h1>
			{error && <p role="alert" className="loci-account__error">{error}</p>}
			{notice && <p role="status" className="loci-account__notice">{notice}</p>}
			{!account && !error && <p>Opening your account…</p>}
			{account && !account.configured && <><p>Accounts are not available on this copy of Loci. Your boards still save in this browser.</p><Link className="loci-primary" href="/demo">Open workspace →</Link></>}
			{account?.configured && !account.user && <>
				<p>Sign in to subscribe. Your notes and boards stay in this browser.</p>
				{account.google && <GoogleButton onSignedIn={signedIn} onError={setError} />}
				{account.emailSignIn && <>
					<div className="loci-account__divider">or use your email</div>
					<form onSubmit={(e) => { e.preventDefault(); void act('/api/auth/login', { method: 'email', email }) }}>
						<label htmlFor="account-email">Email address</label><input id="account-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} placeholder="you@example.com" required />
						<button className="loci-primary" disabled={pending || !email.trim()}>{pending ? 'One moment…' : 'Send sign-in link'}</button>
					</form>
				</>}
			</>}
			{account?.user && <>
				<p className="loci-account__email">{account.user.email}</p>
				{account.pro ? <div className="loci-account__plan"><span className="loci-account__badge">Loci Pro</span><h2>{account.quota?.remaining} questions left</h2><p>Of {account.quota?.limit} this billing month. Up to {account.daily} questions per day.</p><p>{account.subscription?.cancelling ? 'Access ends' : 'Renews'} {account.subscription && new Date(account.subscription.periodEnd * 1000).toLocaleDateString()}.</p><button className="loci-secondary" disabled={pending} onClick={() => act('/api/billing/portal')}>Manage subscription</button></div> : account.billing ? <div className="loci-account__plan"><span className="loci-account__badge">Loci Pro</span><h2>US$8 <small>/ month</small></h2><p>{account.allowance} questions per billing month, with natural voice and explanation replay. Cancel any time.</p><p className="loci-account__fine">Up to {account.daily} questions a day. Includes {account.speech.toLocaleString()} voice characters per month; browser voice remains available after that.</p><button className="loci-primary" disabled={pending} onClick={() => act('/api/billing/checkout')}>{pending ? 'Opening checkout…' : 'Subscribe for US$8/month'}</button>{account.subscription && account.subscription.status !== 'none' && <button className="loci-secondary" disabled={pending} onClick={() => act('/api/billing/portal')}>Manage billing</button>}</div> : <p>Subscriptions are coming soon. You can keep using the free demo.</p>}
				<div className="loci-account__actions"><button disabled={pending} onClick={() => { setPending(true); load(true).catch((err) => setError(err.message)).finally(() => setPending(false)) }}>Refresh account</button><button disabled={pending} onClick={() => act('/api/auth/logout')}>Sign out</button></div>
			</>}
			<p className="loci-account__fine">Boards, uploads and replays save on this device. Signing in does not sync them across devices.</p>
		</section>
	</main>
}
