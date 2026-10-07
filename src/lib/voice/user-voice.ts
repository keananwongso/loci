import 'server-only'
import { FishError, fishSpeech } from './fish'
export interface UserVoice { provider: 'fish' | 'elevenlabs'; key: string; voiceId?: string; model: string }
export function userVoiceFromHeaders(headers: Headers): UserVoice | null {
 const key = headers.get('x-loci-voice-key'), provider = headers.get('x-loci-voice-provider')
 const voiceId = headers.get('x-loci-voice-id') || undefined, model = headers.get('x-loci-voice-model') || undefined
 if (key === null && provider === null && !voiceId && !model) return null
 if (!key || key.length > 4096 || !/^[\x21-\x7e]+$/.test(key) || !['fish', 'elevenlabs'].includes(provider || '') || (voiceId && !/^[A-Za-z0-9_-]{1,120}$/.test(voiceId)) || (model && !/^[A-Za-z0-9_.-]{1,120}$/.test(model)) || (provider === 'elevenlabs' && !voiceId)) throw new Error('Invalid voice settings.')
 return { provider: provider as UserVoice['provider'], key, voiceId, model: model || (provider === 'fish' ? 's2-pro' : 'eleven_flash_v2_5') }
}
export async function userVoiceSpeech(text: string, voice: UserVoice, signal?: AbortSignal, send: typeof fetch = fetch) {
 if (voice.provider === 'fish') return fishSpeech(text, { apiKey: voice.key, model: voice.model, voiceId: voice.voiceId, fetch: send }, signal)
 const res = await send(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voiceId!)}/stream?output_format=mp3_44100_128`, {
  method: 'POST', redirect: 'error', signal,
  headers: { 'xi-api-key': voice.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
  body: JSON.stringify({ text, model_id: voice.model }),
 })
 if (!res.ok || !res.body) throw new FishError(res.status || 502, 'Voice provider request failed.')
 return res.body
}
export function safeVoiceError(status: number) {
 if (status === 401 || status === 403) return 'The voice provider rejected your key or voice access. Check your credentials.'
 if (status === 402 || status === 429) return 'Your voice provider balance, quota or rate limit was reached.'
 if (status === 400 || status === 404 || status === 422) return 'The voice provider rejected these settings. Check the voice and model IDs.'
 return 'Your voice provider could not generate audio. Please try again.'
}
