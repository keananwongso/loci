import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { statsAuthorized } from '@/lib/server/stats-auth'
import { costOf, getStats, lastDays, pricesFromEnv, sumDays, type DayStats, type Prices } from '@/lib/server/stats'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Loci · Stats', robots: { index: false, follow: false } }

/** Hosted demo usage and estimated spend. Password-protected by src/proxy.ts and checked again here. */
export default async function StatsPage() {
	if (!statsAuthorized((await headers()).get('authorization'))) notFound()

	const days = await getStats().read(lastDays(30))
	const prices = pricesFromEnv()
	const periods = [
		{ label: 'Today (UTC)', days: days.slice(0, 1) },
		{ label: 'Last 7 days', days: days.slice(0, 7) },
		{ label: 'Last 30 days', days },
	]

	return (
		<div className="stats">
			<style>{CSS}</style>
			<main>
				<h1>Loci stats</h1>
				<p className="muted">Hosted demo usage on your keys. Visitors are distinct browsers that opened the board; askers sent at least one question.</p>

				<div className="cards">
					{periods.map((p) => {
						const total = sumDays(p.days)
						const cost = costOf(total, prices)
						return (
							<section key={p.label} className="card">
								<h2>{p.label}</h2>
								<dl>
									<Stat label="Visitors" value={total.visitors} />
									<Stat label="Askers" value={total.askers} />
									<Stat label="Questions" value={total.questions} />
									<Stat label="Hit a limit" value={total.refused} />
									<Stat label="Est. spend" value={total2(cost)} strong />
								</dl>
							</section>
						)
					})}
				</div>
				<p className="muted small">Visitors and askers over several days add up each day&apos;s count, so a person who comes back on two days counts twice.</p>

				<h2>By day</h2>
				<div className="table">
					<table>
						<thead>
							<tr>
								<th>Day</th>
								<th>Visitors</th>
								<th>Askers</th>
								<th>Questions</th>
								<th>Limited</th>
								<th>Tokens in / cached / out</th>
								<th>Speech chars</th>
								<th>Transcriptions</th>
								<th>Model</th>
								<th>Voice</th>
							</tr>
						</thead>
						<tbody>
							{days.map((d) => (
								<Row key={d.day} d={d} prices={prices} />
							))}
						</tbody>
					</table>
				</div>

				<h2>How spend is estimated</h2>
				<ul className="muted small">
					<li>
						Model:{' '}
						{prices.input === undefined || prices.output === undefined
							? 'not priced yet. Set LOCI_PRICE_INPUT and LOCI_PRICE_OUTPUT (USD per million tokens, optionally LOCI_PRICE_CACHED_INPUT) to see dollars.'
							: `$${prices.input} in, $${prices.cachedInput} cached in, $${prices.output} out per million tokens.`}
					</li>
					<li>
						Voice: ${prices.speech} per million characters of speech
						{prices.transcription === undefined ? '; transcriptions are not priced (set LOCI_PRICE_TRANSCRIBE, USD each).' : `, $${prices.transcription} per transcription.`}
					</li>
					<li>These are estimates from token counts. Your provider&apos;s billing page is the source of truth.</li>
				</ul>
			</main>
		</div>
	)
}

function Stat({ label, value, strong }: { label: string; value: number | string; strong?: boolean }) {
	return (
		<div className={strong ? 'strong' : undefined}>
			<dt>{label}</dt>
			<dd>{typeof value === 'number' ? value.toLocaleString('en-US') : value}</dd>
		</div>
	)
}

function Row({ d, prices }: { d: DayStats; prices: Prices }) {
	const cost = costOf(d, prices)
	const n = (v: number) => v.toLocaleString('en-US')
	return (
		<tr>
			<td>{d.day}</td>
			<td>{n(d.visitors)}</td>
			<td>{n(d.askers)}</td>
			<td>{n(d.questions)}</td>
			<td>{n(d.refused)}</td>
			<td>
				{n(d.inputTokens)} / {n(d.cachedTokens)} / {n(d.outputTokens)}
			</td>
			<td>{n(d.speechChars)}</td>
			<td>{n(d.transcriptions)}</td>
			<td>{cost.model === undefined ? '–' : usd(cost.model)}</td>
			<td>{usd(cost.voice)}</td>
		</tr>
	)
}

const usd = (v: number) => (v > 0 && v < 0.01 ? '<$0.01' : `$${v.toFixed(2)}`)
const total2 = (c: { model?: number; voice: number }) => (c.model === undefined ? `${usd(c.voice)} + model` : usd(c.model + c.voice))

const CSS = `
.stats { --bg: #fafaf9; --fg: #1c1917; --muted: #78716c; --card: #fff; --line: #e7e5e4;
	position: fixed; inset: 0; overflow: auto; background: var(--bg); color: var(--fg); font-family: 'Inter Variable', system-ui, sans-serif; }
@media (prefers-color-scheme: dark) { .stats { --bg: #0c0a09; --fg: #f5f5f4; --muted: #a8a29e; --card: #1c1917; --line: #292524; } }
.stats main { max-width: 1100px; margin: 0 auto; padding: 32px 16px 64px; }
.stats h1 { font-size: 24px; margin: 0 0 4px; }
.stats h2 { font-size: 15px; margin: 28px 0 10px; }
.stats .muted { color: var(--muted); }
.stats .small { font-size: 13px; }
.stats .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 20px; }
.stats .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 4px 16px 12px; }
.stats .card h2 { margin: 12px 0 8px; color: var(--muted); font-weight: 500; }
.stats dl { margin: 0; display: grid; gap: 6px; }
.stats dl > div { display: flex; justify-content: space-between; font-size: 14px; }
.stats dt { color: var(--muted); }
.stats dd { margin: 0; font-variant-numeric: tabular-nums; }
.stats .strong { border-top: 1px solid var(--line); padding-top: 6px; font-weight: 600; }
.stats .table { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; background: var(--card); }
.stats table { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }
.stats th, .stats td { padding: 8px 12px; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--line); }
.stats th:first-child, .stats td:first-child { text-align: left; }
.stats th { color: var(--muted); font-weight: 500; }
.stats tr:last-child td { border-bottom: 0; }
`
