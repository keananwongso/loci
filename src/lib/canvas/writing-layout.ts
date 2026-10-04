export interface WritingLine {
	x: number
	y: number
	w: number
	h: number
	clipTop?: number
	clipBottom?: number
}

/** Preserve finished rows while revealing only the current row, in shape-relative fractions. */
export function lineClip(line: WritingLine, progress: number) {
	const top = (line.clipTop ?? line.y) * 100
	const bottom = (line.clipBottom ?? line.y + line.h) * 100
	const cursor = (line.x + line.w * progress) * 100
	return `polygon(-2% -20%, 102% -20%, 102% ${top}%, ${cursor}% ${top}%, ${cursor}% ${bottom}%, -2% ${bottom}%)`
}
