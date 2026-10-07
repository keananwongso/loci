'use client'
export interface SpeechTransport { paused: boolean; active: boolean; index: number; count: number; text: string }
let state: SpeechTransport = {paused:false,active:false,index:0,count:0,text:''}
const listeners = new Set<()=>void>()
let pauseStarted = 0, pausedTime = 0
let controls: { pause: (paused:boolean)=>void; step:(direction:number)=>void } | null = null
export const getSpeechTransport = () => state
export const subscribeSpeechTransport = (listener:()=>void) => {listeners.add(listener);return ()=>{listeners.delete(listener)}}
export const speechClock = () => performance.now() - pausedTime - (state.paused ? performance.now()-pauseStarted : 0)
export function updateSpeechTransport(patch: Partial<SpeechTransport>) {state={...state,...patch}; for(const listener of listeners) listener()}
export function bindSpeechControls(value: typeof controls) {controls=value}
export function pauseSpeech(paused = !state.paused) {
 if (paused === state.paused) return
 if (paused) pauseStarted=performance.now(); else pausedTime+=performance.now()-pauseStarted
 updateSpeechTransport({paused})
 if(typeof document !== 'undefined') document.documentElement.toggleAttribute('data-loci-speech-paused',paused)
 controls?.pause(paused)
}
export const stepSpeech = (direction:number) => controls?.step(direction)
export function resetSpeechTransport() {pauseSpeech(false); controls=null; updateSpeechTransport({active:false,index:0,count:0,text:''})}
export function waitForSpeechResume(signal?:AbortSignal): Promise<void> {
 if(!state.paused || signal?.aborted) return Promise.resolve()
 return new Promise(resolve=>{
  const done=()=>{unsubscribe();signal?.removeEventListener('abort',done);resolve()}
  const unsubscribe=subscribeSpeechTransport(()=>{if(!state.paused)done()})
  signal?.addEventListener('abort',done,{once:true})
 })
}
/** Playback and writing deadlines exclude time deliberately paused by the student. */
export function speechTimeout<T>(promise:Promise<T>,ms:number,fallback:T):Promise<T> {
 const start=speechClock()
 return new Promise((resolve,reject)=>{
  const timer=setInterval(()=>{if(speechClock()-start>=ms){clearInterval(timer);resolve(fallback)}},50)
  promise.then(value=>{clearInterval(timer);resolve(value)},error=>{clearInterval(timer);reject(error)})
 })
}
