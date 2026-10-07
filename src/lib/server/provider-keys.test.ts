import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
const state = vi.hoisted(() => ({ user: 'user-a' as string | null, rows: new Map<string, {user_id:string;kind:string;ciphertext:string}>() }))
vi.mock('./auth', () => ({ authConfigured: () => true, currentUser: async () => state.user ? {id:state.user} : null, accountDb: () => ({ from: () => {
 const filters: Record<string,string> = {}; let removing = false
 const query = {
  select: () => query,
  eq: (key:string,value:string) => {filters[key]=value;return query},
  maybeSingle: async () => ({data:state.rows.get(`${filters.user_id}:${filters.kind}`) || null,error:null}),
  upsert: async (value:{user_id:string;kind:string;ciphertext:string}) => {state.rows.set(`${value.user_id}:${value.kind}`,value);return {error:null}},
  delete: () => {removing=true;return query},
  then: (resolve:(value:{error:null})=>unknown) => {if(removing)state.rows.delete(`${filters.user_id}:${filters.kind}`);return Promise.resolve({error:null}).then(resolve)},
 }; return query
} }) }))
import { GET, PUT, DELETE } from '@/app/api/keys/route'
import { resolveAIKey, resolveVoiceKey, readSavedKey } from './provider-keys'
beforeEach(() => { state.rows.clear(); state.user='user-a';vi.stubEnv('LOCI_KEY_ENCRYPTION_SECRET',randomBytes(32).toString('base64')) })
afterEach(() => vi.unstubAllEnvs())
const request = (method:string, body:unknown, origin='https://loci.example') => new Request('https://loci.example/api/keys',{method,headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)})
const ai = {provider:'deepseek',key:'test-private-key',model:'deepseek-flash'}
it('saves ciphertext and returns only metadata, including after reload', async () => {
 const saved=await PUT(request('PUT',{kind:'ai',credential:ai})); expect(saved.status).toBe(200)
 expect(await saved.text()).not.toContain(ai.key)
 expect(state.rows.get('user-a:ai')!.ciphertext).not.toContain(ai.key)
 const metadata=await GET();const text=await metadata.text();expect(text).not.toContain(ai.key);expect(JSON.parse(text)).toMatchObject({keys:{ai:{provider:'deepseek',saved:true}}})
 expect(metadata.headers.get('Cache-Control')).toContain('no-store')
 expect(await resolveAIKey(new Request('https://loci.example/api/tutor',{headers:{'x-loci-saved-ai':'1'}}))).toMatchObject(ai)
})
it('keeps each account isolated and refuses stale saved references instead of owner fallback', async () => {
 await PUT(request('PUT',{kind:'ai',credential:ai}));state.user='user-b'
 expect(await readSavedKey('user-b','ai')).toBeNull()
 expect(await (await GET()).json()).toMatchObject({keys:{}})
 await expect(resolveAIKey(new Request('https://loci.example/api/tutor',{headers:{'x-loci-saved-ai':'1'}}))).rejects.toThrow('removed')
 await DELETE(request('DELETE',{kind:'ai'}));expect(state.rows.has('user-a:ai')).toBe(true)
 state.user=null
 expect((await PUT(request('PUT',{kind:'ai',credential:ai}))).status).toBe(401)
 await expect(resolveAIKey(new Request('https://loci.example/api/tutor',{headers:{'x-loci-saved-ai':'1'}}))).rejects.toThrow('Sign in')
})
it('updates saved settings without returning a secret, and permanently removes the reference', async () => {
 await PUT(request('PUT',{kind:'voice',credential:{provider:'fish',key:'fish-test-key'}}))
 expect((await PUT(request('PUT',{kind:'voice',credential:{provider:'fish',key:'',model:'s2-pro',voiceId:'newvoice'}}))).status).toBe(200)
 expect(await resolveVoiceKey(new Request('https://loci.example/api/speech',{headers:{'x-loci-saved-voice':'1'}}))).toMatchObject({key:'fish-test-key',voiceId:'newvoice'})
 expect((await PUT(request('PUT',{kind:'voice',credential:{provider:'elevenlabs',key:'',voiceId:'voice'}}))).status).toBe(400)
 expect((await DELETE(request('DELETE',{kind:'voice'}))).status).toBe(200)
 expect(await readSavedKey('user-a','voice')).toBeNull()
})
it('rejects cross-origin writes, account-ID injection and malformed credentials', async () => {
 expect((await PUT(request('PUT',{kind:'ai',credential:ai},'https://evil.example'))).status).toBe(403)
 expect((await PUT(request('PUT',{kind:'ai',credential:ai,user_id:'user-b'}))).status).toBe(400)
 expect((await PUT(request('PUT',{kind:'ai',credential:{...ai,key:'bad key'}}))).status).toBe(400)
 expect(state.rows.size).toBe(0)
})
it('lets page-only keys override account keys and rejects incomplete overrides', async () => {
 await PUT(request('PUT',{kind:'ai',credential:ai}))
 expect(await resolveAIKey(new Request('https://loci.example/api/tutor',{headers:{'x-loci-saved-ai':'1','x-loci-key':'page-key','x-loci-provider':'deepseek'}}))).toMatchObject({key:'page-key'})
 await expect(resolveVoiceKey(new Request('https://loci.example/api/speech',{headers:{'x-loci-saved-voice':'1','x-loci-voice-key':'broken'}}))).rejects.toThrow('Invalid voice')
})
