/** What the student pointed at when they asked. */
export type AckKind = 'part' | 'graph' | 'object' | 'none'

/** The tutor's short "let me look" lines. Fixed, so the demo pre-renders them with its voice. */
export const ACK_PHRASES: Record<AckKind, string[]> = {
	part: ['Okay, looking at this.', 'Let me look at that part.', 'Got it, this bit here.'],
	graph: ['Let me look at your graph.', 'Okay, looking at the graph.', 'Got it, the graph.'],
	object: ['Okay, let me look.', 'Got it. Let me see.', 'Alright, looking at this.'],
	none: ['Hmm, one sec.', 'Okay, let me think.', 'Sure, let me see.'],
}
