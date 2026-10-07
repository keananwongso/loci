import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({resolve:vi.fn(),transcribe:vi.fn(),usage:vi.fn(),stats:vi.fn()}))
vi.mock('./provider-keys',()=>({resolveVoiceKey:mocks.resolve}))
vi.mock('./usage',()=>({guardUsage:mocks.usage}))
vi.mock('./stats',()=>({countryOf:()=>undefined,recordStats:mocks.stats}))
vi.mock('./device',()=>({deviceFor:()=>({id:'device'})}))
vi.mock('@/lib/voice/fish',async()=>{
 const actual=await vi.importActual<typeof import('@/lib/voice/fish')>('@/lib/voice/fish')
 return {...actual,fishConfigFromEnv:()=>({apiKey:'owner-key',model:'s2-pro'}),fishTranscribe:mocks.transcribe}
})
import { POST } from '@/app/api/transcribe/route'
beforeEach(()=>{vi.clearAllMocks();mocks.transcribe.mockResolvedValue('test words');mocks.usage.mockResolvedValue({refused:Response.json({error:'allowance reached'},{status:429})})})
afterEach(()=>vi.restoreAllMocks())
const req=()=>new Request('https://loci.example/api/transcribe',{method:'POST',headers:{origin:'https://loci.example','Content-Type':'audio/wav'},body:new Uint8Array([1,2,3])})
it('uses the personal Fish key and bypasses exhausted hosted transcription quota',async()=>{
 mocks.resolve.mockResolvedValue({provider:'fish',key:'personal-key',model:'s2-pro'})
 expect((await POST(req())).status).toBe(200)
 expect(mocks.transcribe.mock.calls[0][1]).toMatchObject({apiKey:'personal-key'})
 expect(mocks.usage).not.toHaveBeenCalled();expect(mocks.stats).not.toHaveBeenCalled()
})
it('keeps hosted transcription limits for ElevenLabs and visitors',async()=>{
 for(const voice of [null,{provider:'elevenlabs',key:'personal-key',model:'model',voiceId:'voice'}]){
  mocks.resolve.mockResolvedValue(voice);expect((await POST(req())).status).toBe(429)
 }
 expect(mocks.transcribe).not.toHaveBeenCalled()
})
it('never falls back to the owner key when a personal Fish request fails',async()=>{
 mocks.resolve.mockResolvedValue({provider:'fish',key:'private-key',model:'s2-pro'})
 mocks.transcribe.mockRejectedValue(new Error('private-key upstream secret'))
 const res=await POST(req());expect(res.status).toBe(502);expect(await res.text()).not.toContain('private-key')
 expect(mocks.transcribe).toHaveBeenCalledOnce();expect(mocks.usage).not.toHaveBeenCalled()
})
