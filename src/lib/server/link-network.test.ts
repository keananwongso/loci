import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
const net = vi.hoisted(() => ({ dns: vi.fn(), calls: [] as { url: URL; options: any }[], replies: [] as { status?: number; location?: string; type?: string; text?: string; length?: number }[] }))
vi.mock('node:dns/promises', () => ({ lookup: net.dns }))
vi.mock('node:https', () => ({ request: (url: URL, options: any, callback: (res: any) => void) => {
 net.calls.push({ url, options })
 const req = new EventEmitter() as EventEmitter & { end: () => void }
 req.end = () => queueMicrotask(() => {
  const data = net.replies.shift() || { text: 'Readable public source text '.repeat(10), type: 'text/plain' }
  const res = Object.assign(new EventEmitter(), { statusCode: data.status || 200, headers: { location: data.location, 'content-type': data.type || 'text/plain', 'content-length': data.length }, destroy: vi.fn() })
  callback(res); res.emit('data', Buffer.from(data.text || '')); res.emit('end')
 })
 return req
} }))
import { importLink } from './link-import'
beforeEach(() => { net.calls.length = 0; net.replies.length = 0; net.dns.mockReset().mockResolvedValue([{ address: '1.1.1.1', family: 4 }]) })
describe('link import network boundary', () => {
 it('pins the validated DNS address into the request lookup', async () => {
  await importLink('https://public.example/notes', new AbortController().signal)
  const cb = vi.fn(); net.calls[0].options.lookup('public.example', {}, cb)
  expect(cb).toHaveBeenCalledWith(null, '1.1.1.1', 4)
  expect(net.dns).toHaveBeenCalledTimes(1)
 })
 it('refuses hosts resolving to a private IP before opening a socket', async () => {
  net.dns.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
  await expect(importLink('https://internal.example/notes', new AbortController().signal)).rejects.toThrow(/Private/)
  expect(net.calls).toHaveLength(0)
 })
 it('checks each redirected hostname and blocks a public-to-private redirect', async () => {
  net.replies.push({ status: 302, location: 'https://internal.example/secret' })
  net.dns.mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }]).mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }])
  await expect(importLink('https://public.example/notes', new AbortController().signal)).rejects.toThrow(/Private/)
  expect(net.calls).toHaveLength(1)
 })
 it('bounds downloads before accepting oversized bodies', async () => {
  net.replies.push({ length: 11 * 1024 * 1024 })
  await expect(importLink('https://public.example/notes', new AbortController().signal)).rejects.toThrow(/10 MB/)
 })
})
