import type { TLDefaultColorStyle } from '@/lib/whiteboard'
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

/** The canvas palette colour, for native shapes (text, arrows, geo). */
export const TL_COLOR: Record<InkColor, TLDefaultColorStyle> = {
	ink: 'black',
	blue: 'blue',
	red: 'red',
	green: 'green',
	orange: 'orange',
	violet: 'violet',
	grey: 'grey',
}

/** Keep source text and student ink readable underneath tutor marks. */
export const HIGHLIGHT_FILL: Record<HighlightColor, string> = {
	yellow: 'rgba(255, 214, 10, 0.24)',
	green: 'rgba(52, 211, 120, 0.20)',
	blue: 'rgba(80, 160, 255, 0.20)',
	pink: 'rgba(255, 99, 170, 0.20)',
}

export const HIGHLIGHT_STROKE: Record<HighlightColor, string> = {
	yellow: 'rgba(224, 138, 0, 0.65)',
	green: 'rgba(22, 163, 74, 0.65)',
	blue: 'rgba(36, 87, 230, 0.65)',
	pink: 'rgba(219, 39, 119, 0.65)',
}

export function inkHex(color: string | undefined, fallback: InkColor = 'ink'): string {
	return INK[(color as InkColor) in INK ? (color as InkColor) : fallback]
}
