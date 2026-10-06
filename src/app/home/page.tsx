'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CloudError, createBoard, deleteBoard, listBoards, updateBoard, type CloudBoard, type CloudPlan } from '@/lib/storage/cloud'

interface Account { configured: boolean; user: { email?: string } | null; pro: boolean; quota: { remaining: number; limit: number } | null }

const MB = 1024 * 1024
const size = (bytes: number) => bytes >= 1024 * MB ? `${+(bytes / (1024 * MB)).toFixed(1)} GB` : bytes < MB ? `${Math.max(0, Math.round(bytes / 1024))} KB` : `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`
function edited(iso: string) {
	const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000)
	if (minutes < 1) return 'Edited just now'
	if (minutes < 60) return `Edited ${minutes} min ago`
	if (minutes < 60 * 24) return `Edited ${Math.round(minutes / 60)} h ago`
	return `Edited ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

/** Where a signed-in student lands: their boards, saved to the account. */
export default function HomePage() {
	const [account, setAccount] = useState<Account | null>(null)
	const [boards, setBoards] = useState<CloudBoard[] | null>(null)
	const [plan, setPlan] = useState<CloudPlan | null>(null)
	const [error, setError] = useState('')
	const [pending, setPending] = useState(false)
	const [renaming, setRenaming] = useState<string | null>(null)
	const [confirming, setConfirming] = useState<string | null>(null)

	const refresh = useCallback(() => listBoards().then((r) => { setBoards(r.boards); setPlan(r.plan) }), [])
	useEffect(() => {
		fetch('/api/account', { cache: 'no-store' }).then((r) => r.json()).then((data: Account) => {
			if (!data.user) { window.location.replace('/account'); return }
			setAccount(data)
			return refresh()
		}).catch((err) => setError(err instanceof Error ? err.message : 'Could not load your boards.'))
	}, [refresh])

	const run = async (action: () => Promise<unknown>) => {
		setPending(true); setError('')
		try { await action() } catch (err) { setError(err instanceof CloudError ? err.message : 'Something went wrong. Try again.') } finally { setPending(false) }
	}
	const newBoard = () => run(async () => {
		const board = await createBoard(`Board ${(boards?.length ?? 0) + 1}`)
		window.location.assign(`/board/${board.id}`)
	})
	const atLimit = Boolean(plan && boards && boards.length >= plan.boards)

	return <main className="loci-account loci-home">
		<nav><Link className="loci-brand" href="/home">Loci</Link><Link href="/account">{account?.pro ? 'Pro · Account' : 'Account'}</Link></nav>
		<header className="loci-home__header">
			<div>
				<h1>Your boards</h1>
				{plan && <p className="loci-home__plan">
					{plan.pro ? 'Loci Pro' : 'Free'} · {boards?.length ?? 0}{plan.pro ? '' : ` of ${plan.boards}`} boards · {size(plan.used)} of {size(plan.bytes)} used
					{account?.quota && ` · ${account.quota.remaining} questions left this month`}
				</p>}
			</div>
			<div className="loci-home__actions">
				{atLimit && !plan?.pro && <Link className="loci-secondary" href="/account">Upgrade for more boards</Link>}
				<button className="loci-primary" disabled={pending || !boards || atLimit} onClick={newBoard}>New board</button>
			</div>
		</header>
		{error && <p role="alert" className="loci-account__error">{error}</p>}
		{!boards && !error && <p>Opening your boards…</p>}
		{boards?.length === 0 && <section className="loci-home__empty">
			<h2>Start your first board.</h2>
			<p>Drop in your notes or a screenshot of a problem, then ask. Every explanation stays on the board, right where you asked it.</p>
			<button className="loci-primary" disabled={pending} onClick={newBoard}>New board</button>
		</section>}
		{boards && boards.length > 0 && <ul className="loci-home__boards">
			{boards.map((board) => <li key={board.id} className="loci-home__board">
				{renaming === board.id
					? <form onSubmit={(e) => {
						e.preventDefault()
						const name = new FormData(e.currentTarget).get('name')?.toString().trim()
						if (name) void run(async () => { await updateBoard(board.id, { name }); setRenaming(null); await refresh() })
					}}>
						<label className="loci-sr-only" htmlFor={`name-${board.id}`}>Board name</label>
						<input id={`name-${board.id}`} name="name" defaultValue={board.name} maxLength={80} autoFocus required />
						<button type="submit" disabled={pending}>Save</button><button type="button" onClick={() => setRenaming(null)}>Cancel</button>
					</form>
					: <Link href={`/board/${board.id}`} className="loci-home__open"><strong>{board.name}</strong><span>{edited(board.updated_at)}</span></Link>}
				{renaming !== board.id && <div className="loci-home__menu">
					{confirming === board.id
						? <><span>Delete for good?</span><button disabled={pending} onClick={() => run(async () => { await deleteBoard(board.id); setConfirming(null); await refresh() })}>Delete</button><button onClick={() => setConfirming(null)}>Keep</button></>
						: <><button onClick={() => setRenaming(board.id)}>Rename</button><button onClick={() => setConfirming(board.id)}>Delete</button></>}
				</div>}
			</li>)}
		</ul>}
		<p className="loci-account__fine">Boards save to your account and open on any device you sign in on. <Link href="/demo">Boards on this device</Link></p>
	</main>
}
