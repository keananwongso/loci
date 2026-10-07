import { afterEach, beforeEach, expect, it, vi } from 'vitest'
let saved: typeof import('./savedKeys'), ai: typeof import('./userKey'), voice: typeof import('./voiceKey')
beforeEach(async () => {
 vi.resetModules()
 vi.stubGlobal('window',{dispatchEvent:vi.fn(),localStorage:{removeItem:vi.fn()},sessionStorage:{removeItem:vi.fn()}})
 vi.stubGlobal('CustomEvent',class {constructor(public type:string){}})
 saved=await import('./savedKeys');ai=await import('./userKey');voice=await import('./voiceKey')
})
afterEach(()=>vi.unstubAllGlobals())
const metadata={signedIn:true,available:true,keys:{ai:{provider:'deepseek',model:'deepseek-flash',saved:true},voice:{provider:'fish',saved:true}}}
it('restores only server references after refresh, never raw saved keys',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(metadata)))
 await saved.refreshSavedKeys()
 expect(ai.loadUserKey()).toMatchObject({provider:'deepseek',key:'',saved:true})
 expect(ai.userKeyHeaders()).toEqual({'x-loci-saved-ai':'1'})
 expect(voice.voiceKeyHeaders()).toEqual({'x-loci-saved-voice':'1'})
})
it('does not replace deliberate page-only overrides during metadata refresh',async()=>{
 ai.saveUserKey({provider:'deepseek',key:'page-only'})
 voice.saveVoiceKey({provider:'elevenlabs',key:'page-voice',voiceId:'voice'})
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(metadata)))
 await saved.refreshSavedKeys()
 expect(ai.userKeyHeaders()['x-loci-key']).toBe('page-only')
 expect(voice.voiceKeyHeaders()['x-loci-voice-key']).toBe('page-voice')
})
it('replaces the client raw credential with metadata only after saving succeeds',async()=>{
 const send=vi.fn(async(_url:string,_init?:RequestInit)=>Response.json({kind:'ai',metadata:metadata.keys.ai}))
 vi.stubGlobal('fetch',send)
 await saved.rememberKey('ai',{provider:'deepseek',key:'new-private-key'})
 expect(JSON.parse(send.mock.calls[0][1]!.body as string)).toMatchObject({kind:'ai',credential:{key:'new-private-key'}})
 expect(ai.loadUserKey()?.key).toBe('');expect(ai.userKeyHeaders()).toEqual({'x-loci-saved-ai':'1'})
})
it('does not restore a removed key from an older in-flight metadata response',async()=>{
 let finish!: (response:Response)=>void
 vi.stubGlobal('fetch',vi.fn((_url,init)=>init?.method==='DELETE'?Promise.resolve(Response.json({ok:true})):new Promise<Response>(resolve=>{finish=resolve})))
 const pending=saved.refreshSavedKeys()
 await saved.forgetKey('ai')
 finish(Response.json(metadata));await pending
 expect(ai.loadUserKey()).toBeNull()
})
it('retains the active key when removal fails and clears references on anonymous restore',async()=>{
 ai.saveUserKey({provider:'deepseek',key:'',saved:true})
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'Try again'},{status:503})))
 await expect(saved.forgetKey('ai')).rejects.toThrow('Try again');expect(ai.loadUserKey()?.saved).toBe(true)
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({signedIn:false,available:true,keys:{}})))
 await saved.refreshSavedKeys();expect(ai.loadUserKey()).toBeNull()
})
