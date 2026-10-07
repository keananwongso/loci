import { afterEach, expect, it, vi } from 'vitest'
import { playSpeech, stopAllSpeech, type PreparedSpeech } from './player'
import { pauseSpeech, stepSpeech } from './transport'
const voice=vi.hoisted(()=>({spoken:[] as string[],done:null as null|(()=>void)}))
vi.mock('./speech',()=>({canSpeak:()=>true,speak:(text:string,done:()=>void,start:()=>void)=>{voice.spoken.push(text);voice.done=done;start()},stopSpeaking:vi.fn()}))
vi.mock('./level',()=>({measureVoice:vi.fn(),setSynthSpeaking:vi.fn()}))
const prepared=(spoken:string):PreparedSpeech=>({spoken,audio:Promise.resolve(null),recording:Promise.resolve(null),controller:new AbortController()})
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
afterEach(()=>{stopAllSpeech();vi.unstubAllGlobals();voice.spoken=[];voice.done=null})
it('pauses browser speech and revisits previous sentences without another synthesis request',async()=>{
 const pause=vi.fn(),resume=vi.fn();vi.stubGlobal('speechSynthesis',{pause,resume})
 const first=playSpeech(prepared('First sentence'));await first.started;voice.done?.();await first.done
 const second=playSpeech(prepared('Second sentence'));await second.started
 pauseSpeech(true);expect(pause).toHaveBeenCalledOnce();pauseSpeech(false);expect(resume).toHaveBeenCalledOnce()
 stepSpeech(-1);await flush();expect(voice.spoken.at(-1)).toBe('First sentence')
 voice.done?.();await flush();expect(voice.spoken.at(-1)).toBe('Second sentence')
 stepSpeech(1);await second.done
 expect(voice.spoken).toEqual(['First sentence','Second sentence','First sentence','Second sentence'])
})
