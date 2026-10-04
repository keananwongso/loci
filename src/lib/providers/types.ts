import type { ToolDefinition } from '@/lib/actions/tools'
import type { ActionSession } from '@/lib/tutor/session'
import type { TutorEvent, TutorRequest } from '@/lib/tutor/types'

export interface TutorInput {
	system: string
	tools: ToolDefinition[]
	request: TutorRequest
	/** Text part of the current turn (board description + question). */
	turnText: string
	/** Called with each model call's token counts, for the hosted demo's spend estimate. */
	onUsage?: (usage: TokenUsage) => void
}

export interface TokenUsage {
	/** All prompt tokens, cached ones included. */
	input: number
	cachedInput: number
	output: number
}

/**
 * A model backend. Implementations translate the provider-neutral input into their API,
 * run the tool-call loop, and route every tool call through `session.handle`, which
 * validates it and streams it to the browser.
 */
export interface TutorModelProvider {
	readonly name: string
	readonly model: string
	isConfigured(): boolean
	/** Short hint shown in the UI when not configured. */
	setupHint: string
	run(input: TutorInput, session: ActionSession, emit: (e: TutorEvent) => void, signal: AbortSignal): Promise<void>
	/** Turn a thrown error into a message the student can act on. */
	describeError?(err: unknown): string
}
