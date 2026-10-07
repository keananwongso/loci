import { afterEach, describe, expect, it, vi } from 'vitest'
import { pauseSpeech, resetSpeechTransport, speechClock, speechTimeout, waitForSpeechResume, bindSpeechControls, stepSpeech, getSpeechTransport } from './transport'

afterEach(()=>{resetSpeechTransport();vi.restoreAllMocks();vi.useRealTimers()})
describe('speech transport',()=>{
 it('holds pacing and timeout budgets while paused',async()=>{
  vi.useFakeTimers(); let now=0; vi.spyOn(performance,'now').mockImplementation(()=>now)
  const start=speechClock(); const finished=vi.fn()
  const pending=speechTimeout(new Promise<string>(()=>{}),100,'expired').then(finished)
  now=50;await vi.advanceTimersByTimeAsync(50);pauseSpeech(true)
  now=5050;await vi.advanceTimersByTimeAsync(5000)
  expect(speechClock()-start).toBe(50);expect(finished).not.toHaveBeenCalled()
  pauseSpeech(false);now=5100;await vi.advanceTimersByTimeAsync(50);await pending
  expect(finished).toHaveBeenCalledWith('expired')
 })
 it('releases a paused turn on cancellation',async()=>{
  pauseSpeech(true);const controller=new AbortController();const finished=vi.fn()
  const pending=waitForSpeechResume(controller.signal).then(finished)
  await Promise.resolve();expect(finished).not.toHaveBeenCalled()
  controller.abort();await pending;expect(finished).toHaveBeenCalledOnce()
 })
 it('routes pause and navigation and clears controls on reset',()=>{
  const pause=vi.fn(),step=vi.fn();bindSpeechControls({pause,step})
  pauseSpeech(true);stepSpeech(-1);expect(pause).toHaveBeenCalledWith(true);expect(step).toHaveBeenCalledWith(-1)
  resetSpeechTransport();stepSpeech(1);expect(step).toHaveBeenCalledTimes(1);expect(getSpeechTransport().paused).toBe(false)
 })
})
