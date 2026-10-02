import type { TLDefaultColorStyle } from 'tldraw'
import type { HighlightColor, InkColor } from '@/lib/actions/schema'

/** Hex values for ink colours used by Loci's custom shapes (graphs, equations). */
export const INK: Record<InkColor, string> = {
	ink: '#1c2230',
	blue: '#2457e6',
	red: '#d9342b',
	green: '#178a4c',
	orange: '#e0670f',
	violet: '#7445e0',
	grey: '#7b8494',
}

/** The closest tldraw palette colour, for native shapes (text, arrows, geo). */
export const TL_COLOR: Record<InkColor, TLDefaultColorStyle> = {
	ink: 'black',
	blue: 'blue',
	red: 'red',
	green: 'green',
	orange: 'orange',
	violet: 'violet',
	grey: 'grey',
}

export const HIGHLIGHT_FILL: Record<HighlightColor, string> = {
	yellow: 'rgba(255, 214, 10, 0.42)',
	green: 'rgba(52, 211, 120, 0.32)',
	blue: 'rgba(80, 160, 255, 0.30)',
	pink: 'rgba(255, 99, 170, 0.30)',
}

export const HIGHLIGHT_STROKE: Record<HighlightColor, string> = {
	yellow: '#e08a00',
	green: '#16a34a',
	blue: '#2457e6',
	pink: '#db2777',
}

export function inkHex(color: string | undefined, fallback: InkColor = 'ink'): string {
	return INK[(color as InkColor) in INK ? (color as InkColor) : fallback]
}
