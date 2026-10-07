import { describe, it, expect, vi } from 'vitest'
import { decode } from '@msgpack/msgpack'
import { userVoiceFromHeaders, userVoiceSpeech } from './user-voice'

describe('user voice providers', () => {
 it('requires valid credentials and fixed provider IDs without echoing secrets', () => {
  expect(userVoiceFromHeaders(new Headers())).toBeNull()
  for (const headers of [ { 'x-loci-voice-key':'secret', 'x-loci-voice-provider':'https://evil.example' }, { 'x-loci-voice-key':'secret', 'x-loci-voice-provider':'elevenlabs', 'x-loci-voice-id':'../../secret' }, { 'x-loci-voice-key':'secret', 'x-loci-voice-provider':'elevenlabs' }, { 'x-loci-voice-key':'bad key', 'x-loci-voice-provider':'fish' } ]) expect(()=>userVoiceFromHeaders(new Headers(headers as Record<string, string>))).toThrow('Invalid voice settings.')
 })
 it('streams ElevenLabs mp3 at its fixed endpoint with the submitted voice and key', async () => {
  const send = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), { headers: {'Content-Type':'audio/mpeg'} }))
  const voice = userVoiceFromHeaders(new Headers({'x-loci-voice-key':'test-only-key','x-loci-voice-provider':'elevenlabs','x-loci-voice-id':'voice123'}))!
  await userVoiceSpeech('Hello', voice, undefined, send)
  expect(send.mock.calls[0][0]).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice123/stream?output_format=mp3_44100_128')
  expect(send.mock.calls[0][1]).toMatchObject({ redirect:'error', headers:{'xi-api-key':'test-only-key'}, body:JSON.stringify({text:'Hello',model_id:'eleven_flash_v2_5'}) })
 })
 it('sends Fish its own key without inheriting owner voice configuration', async () => {
  const send = vi.fn().mockResolvedValue(new Response(new Uint8Array([1])))
  await userVoiceSpeech('Hello', {provider:'fish',key:'test-only-key',model:'s2-pro',voiceId:'user-voice'}, undefined, send)
  expect(send.mock.calls[0][0]).toBe('https://api.fish.audio/v1/tts')
  expect(send.mock.calls[0][1].headers.Authorization).toBe('Bearer test-only-key')
  expect(decode(send.mock.calls[0][1].body)).toMatchObject({reference_id:'user-voice',text:'Hello'})
 })
 it('does not return provider error bodies that might contain secrets', async () => {
  const send = vi.fn().mockResolvedValue(new Response('secret echoed upstream', {status:401}))
  await expect(userVoiceSpeech('Hello',{provider:'elevenlabs',key:'secret',voiceId:'voice123',model:'eleven_flash_v2_5'},undefined,send)).rejects.toThrow('Voice provider request failed.')
 })
})
