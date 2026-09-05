import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { isWebhookContentType, readBoundedUtf8Body, webhookRespond, WebhookHttpError } from '../src/http.ts'

/** Minimal async-iterable request for byte-level branches Node fetch cannot construct. */
function request(options: {
  chunks?: Array<Buffer | string>
  contentLength?: string
  complete?: boolean
  error?: unknown
} = {}): IncomingMessage & { resume: ReturnType<typeof vi.fn> } {
  const resume = vi.fn()
  return {
    headers: {
      ...(options.contentLength === undefined ? {} : { 'content-length': options.contentLength }),
    },
    complete: options.complete ?? true,
    resume,
    async * [Symbol.asyncIterator]() {
      for (const chunk of options.chunks ?? []) yield chunk
      if (options.error !== undefined) throw options.error
    },
  } as unknown as IncomingMessage & { resume: ReturnType<typeof vi.fn> }
}

describe('bounded webhook body intake', () => {
  it('accepts an absent length and both Buffer and string chunks', async () => {
    await expect(readBoundedUtf8Body(request({ chunks: [Buffer.from('{'), '}'] }), 2)).resolves.toBe('{}')
  })

  it('rejects malformed, unsafe, and oversized declared lengths', async () => {
    await expect(readBoundedUtf8Body(request({ contentLength: '01' }), 10)).rejects.toMatchObject({ status: 400 })
    await expect(readBoundedUtf8Body(request({ contentLength: '999999999999999999999' }), Number.MAX_SAFE_INTEGER))
      .rejects.toMatchObject({ status: 413 })
    const oversized = request({ contentLength: '3' })
    await expect(readBoundedUtf8Body(oversized, 2)).rejects.toMatchObject({ status: 413 })
    expect(oversized.resume).toHaveBeenCalledOnce()
  })

  it('rejects a chunked body at the first byte beyond the cap', async () => {
    const streamed = request({ chunks: [Buffer.from('ab'), Buffer.from('c')] })
    await expect(readBoundedUtf8Body(streamed, 2)).rejects.toMatchObject({ status: 413 })
    expect(streamed.resume).toHaveBeenCalledOnce()
  })

  it('normalizes stream failure and incomplete EOF as an aborted body', async () => {
    await expect(readBoundedUtf8Body(request({ error: new Error('socket') }), 10))
      .rejects.toMatchObject({ status: 400, message: 'request body was aborted' })
    await expect(readBoundedUtf8Body(request({ complete: false }), 10))
      .rejects.toMatchObject({ status: 400, message: 'request body was aborted' })
  })

  it('rejects invalid UTF-8 after a complete bounded read', async () => {
    await expect(readBoundedUtf8Body(request({ chunks: [Buffer.from([0xff])] }), 1))
      .rejects.toMatchObject({ status: 400, message: 'request body is not valid UTF-8' })
  })
})

describe('webhook content type matching', () => {
  it('rejects an absent header and a foreign media type', () => {
    expect(isWebhookContentType(undefined, 'application/json')).toBe(false)
    expect(isWebhookContentType('text/plain', 'application/json')).toBe(false)
  })

  it('accepts the bare media type case-insensitively', () => {
    expect(isWebhookContentType('application/json', 'application/json')).toBe(true)
    expect(isWebhookContentType('Application/JSON', 'application/json')).toBe(true)
    expect(isWebhookContentType('application/x-www-form-urlencoded', 'application/x-www-form-urlencoded')).toBe(true)
  })

  it('accepts at most one UTF-8 charset parameter', () => {
    expect(isWebhookContentType('application/json; charset=utf-8', 'application/json')).toBe(true)
    expect(isWebhookContentType('application/json; charset="utf-8"', 'application/json')).toBe(true)
    expect(isWebhookContentType('application/json; Charset=UTF-8', 'application/json')).toBe(true)
  })

  it('rejects extra parameters and non-UTF-8 charsets', () => {
    expect(isWebhookContentType('application/json; charset=latin1', 'application/json')).toBe(false)
    expect(isWebhookContentType('application/json; charset=utf-8; boundary=x', 'application/json')).toBe(false)
    expect(isWebhookContentType('application/json; foo=bar', 'application/json')).toBe(false)
  })
})

describe('webhook plain-text responses', () => {
  /** Minimal ServerResponse mock recording the exact writeHead/end calls. */
  function response(): ServerResponse & { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } {
    return { writeHead: vi.fn(), end: vi.fn() } as unknown as ServerResponse & {
      writeHead: ReturnType<typeof vi.fn>
      end: ReturnType<typeof vi.fn>
    }
  }

  it('sends a bare status without a message', () => {
    const res = response()
    webhookRespond(res, 202)
    expect(res.writeHead).toHaveBeenCalledWith(202)
    expect(res.end).toHaveBeenCalledWith()
  })

  it('sends safe error text as plain text exactly once', () => {
    const res = response()
    webhookRespond(res, 415, 'content type must be application/json')
    expect(res.writeHead).toHaveBeenCalledWith(415, { 'content-type': 'text/plain; charset=utf-8' })
    expect(res.end).toHaveBeenCalledWith('content type must be application/json')
  })

  it('carries an HTTP status usable as the adapter refusal contract', () => {
    const error = new WebhookHttpError(503, 'webhook ingress is unavailable')
    expect(error.status).toBe(503)
    expect(error.name).toBe('WebhookHttpError')
  })
})
