import type { ToolDefinition } from '@/lib/actions/tools'
import type { ActionSession } from '@/lib/tutor/session'
import type { TutorEvent, TutorRequest } from '@/lib/tutor/types'

export interface TutorInput {
	system: string
	tools: ToolDefinition[]
	request: TutorRequest
	/** Text part of the current turn (board description + question). */
	turnText: string
}

/**
 * A model backend. Implementations translate the provider-neutral input into their API,
 * run the tool-call loop, and route every tool call through `session.handle`, which
 * validates it and streams it to the browser. Adding Ollama or OpenAI means writing one
 * more of these; nothing else in the app changes.
 */
export interface TutorModelProvider {
	readonly name: string
	readonly model: string
	isConfigured(): boolean
	/** Short hint shown in the UI when not configured. */
	setupHint: string
	run(input: TutorInput, session: ActionSession, emit: (e: TutorEvent) => void, signal: AbortSignal): Promise<void>
}
