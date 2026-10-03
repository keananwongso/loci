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

function audioContext() {
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

let micWanted = false

export async function startMic() {
	micWanted = true
	if (mic) return
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
		// Released before the browser handed over the mic.
		if (!micWanted || mic) {
			stream.getTracks().forEach((t) => t.stop())
			return
		}
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
	} catch {
		mic = null
	}
}

export function stopMic() {
	micWanted = false
	mic?.stop()
	mic = null
}

/** How loud the student is while holding to talk. */
export function micLevel(): number {
	return mic ? Math.min(1, rms(mic.analyser, mic.buf) * 9) : 0
}
