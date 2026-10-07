'use client'
import { useSyncExternalStore } from 'react'
import { getSpeechTransport, subscribeSpeechTransport, pauseSpeech, stepSpeech } from '@/lib/voice/transport'
import { PauseIcon, PlayIcon, SkipIcon } from './icons'

export function SpeechControls() {
 const state = useSyncExternalStore(subscribeSpeechTransport, getSpeechTransport, getSpeechTransport)
 if (!state.count) return null
 return <div className="loci-speech-controls" onPointerDown={event=>event.stopPropagation()}>
  <button onClick={()=>stepSpeech(-1)} disabled={!state.active || state.index===0} aria-label="Previous sentence" title="Previous sentence"><SkipIcon /></button>
  <button onClick={()=>pauseSpeech()} aria-label={state.paused ? 'Resume explanation' : 'Pause explanation'}>{state.paused ? <PlayIcon /> : <PauseIcon />}</button>
  <button onClick={()=>stepSpeech(1)} disabled={!state.active} aria-label="Next sentence" title="Next sentence"><SkipIcon forward /></button>
  <span>{state.paused ? 'Paused' : 'Speaking'} · {state.index+1}</span>
 </div>
}
