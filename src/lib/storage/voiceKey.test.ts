import { afterEach, it, expect, vi } from 'vitest'
import { loadVoiceKey, saveVoiceKey, voiceKeyHeaders } from './voiceKey'
afterEach(()=>vi.unstubAllGlobals())
it('keeps voice credentials independent in memory and forgets them on module reload', async ()=>{
 const storage = {setItem:vi.fn()}
 vi.stubGlobal('window',{localStorage:storage,sessionStorage:storage,dispatchEvent:vi.fn()})
 vi.stubGlobal('CustomEvent',class {constructor(public type:string){}})
 saveVoiceKey({provider:'fish',key:'test-only-key',voiceId:'voice123'})
 expect(voiceKeyHeaders()).toEqual({'x-loci-voice-key':'test-only-key','x-loci-voice-provider':'fish','x-loci-voice-id':'voice123'})
 expect(storage.setItem).not.toHaveBeenCalled()
 vi.resetModules()
 expect((await import('./voiceKey')).loadVoiceKey()).toBeNull()
 saveVoiceKey(null)
 expect(loadVoiceKey()).toBeNull()
 expect(voiceKeyHeaders()).toEqual({})
})
