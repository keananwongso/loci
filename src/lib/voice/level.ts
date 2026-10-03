'use client'
/**
 * Live loudness of the tutor's voice and the student's mic, 0..1, for the buddy to pulse with.
 * Read every animation frame; nothing here re-renders React.
 */

let ctx: AudioContext | null = null
let voice: { el: HTMLMediaElement; analyser: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null = null
let mic: { analyser: AnalyserNode; buf: Float32Array<ArrayBuffer>; stop: () => void } | null = null
/** Browser speech gives no audio to measure, so its loudness is faked while it talks. */
let synthSince = 0

export function audioContext() {
	ctx ??= new AudioContext()
	if (ctx.state === 'suspended') ctx.resume().catch(() => {})
	return ctx
}

function rms(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>) {
	analyser.getFloatTimeDomainData(buf)
	let s = 0
	for (const v of buf) s += v * v
	return Math.sqrt(s / buf.length)
}

/**
 * Route an audio element through an analyser so its loudness can be read. An element can only
 * be connected once, so Loci plays every sentence through the same element.
 */
export function measureVoice(el: HTMLMediaElement) {
	if (voice?.el === el) {
		audioContext()
		return
	}
	try {
		const ac = audioContext()
		const analyser = ac.createAnalyser()
		analyser.fftSize = 1024
		ac.createMediaElementSource(el).connect(analyser)
		analyser.connect(ac.destination)
		voice = { el, analyser, buf: new Float32Array(analyser.fftSize) }
	} catch (err) {
		console.warn('[loci] could not measure the voice', err)
	}
}

export function setSynthSpeaking(on: boolean) {
	synthSince = on ? performance.now() : 0
}

/** How loud the tutor is right now. */
export function voiceLevel(): number {
	if (voice && !voice.el.paused && !voice.el.ended) return Math.min(1, rms(voice.analyser, voice.buf) * 5)
	if (synthSince) {
		const t = (performance.now() - synthSince) / 1000
		return 0.35 + 0.25 * Math.max(0, Math.sin(t * 11) * Math.sin(t * 2.3 + 1))
	}
	return 0
}

let micStream: MediaStream | null = null
let micOpening: Promise<MediaStream | null> | null = null
let micActive = false
let closeTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Open the mic (or reuse it if it is still warm) and start metering its level. The stream stays
 * open for a short while after release, so the next press records from its very first word.
 */
export async function openMic(): Promise<MediaStream | null> {
	clearTimeout(closeTimer)
	micActive = true
	if (micStream?.active) return micStream
	micOpening ??= navigator.mediaDevices
		.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
		.then((stream) => {
			micStream = stream
			const ac = audioContext()
			const analyser = ac.createAnalyser()
			analyser.fftSize = 1024
			const source = ac.createMediaStreamSource(stream)
			source.connect(analyser)
			mic = {
				analyser,
				buf: new Float32Array(analyser.fftSize),
				stop: () => {
					source.disconnect()
					stream.getTracks().forEach((t) => t.stop())
				},
			}
			return stream
		})
		.catch((err) => {
			console.warn('[loci] microphone unavailable', err)
			return null
		})
		.finally(() => (micOpening = null))
	return micOpening
}

/** Stop metering now; release the mic itself after `ms` unless it is opened again. */
export function releaseMic(ms = 45000) {
	micActive = false
	clearTimeout(closeTimer)
	closeTimer = setTimeout(() => {
		mic?.stop()
		mic = null
		micStream = null
	}, ms)
}

/** Kept for the prompt bar's mic button. */
export async function startMic() {
	await openMic()
}
export function stopMic() {
	releaseMic()
}

/** How loud the student is while holding to talk. */
export function micLevel(): number {
	return mic && micActive ? Math.min(1, rms(mic.analyser, mic.buf) * 9) : 0
}
