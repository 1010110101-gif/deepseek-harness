/** Unit tests for PayPal IPN handler verification, parsing, and dispatch. */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPayPalWebhookHandler, notifyValidateBody } from '../src/handler.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => { resolve() }))))
})

/** One fake context for dispatch and warning observation. */
function fakeContext(): { ctx: Context; dispatch: ReturnType<typeof vi.fn>; warnings: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn()
  const warnings = vi.fn()
  return {
    ctx: {
      webhookRuntime: { dispatch },
      logger: { warn: warnings },
    } as unknown as Context,
    dispatch,
    warnings,
  }
}

/** Fake PayPal verification endpoint recording round-trip requests. */
async function startVerifier(
  reply: string,
  status = 200,
  replyDelayMs = 0,
): Promise<{ url: string; bodies: string[]; contentTypes: string[] }> {
  const bodies: string[] = []
  const contentTypes: string[] = []
  const server = createServer((request, response) => {
    contentTypes.push(request.headers['content-type'] ?? '')
    let body = ''
    request.on('data', (chunk: Buffer) => { body += String(chunk) })
    request.on('end', () => {
      bodies.push(body)
      const replyTo = (): void => {
        // The client may have aborted on its own timeout; never write to a dead socket.
        if (response.destroyed) return
        response.writeHead(status, { 'content-type': 'text/plain' })
        response.end(reply)
      }
      if (replyDelayMs === 0) replyTo()
      else setTimeout(replyTo, replyDelayMs)
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return { url: `http://127.0.0.1:${String(port)}`, bodies, contentTypes }
}

/** Start a real Node server around the package-owned route handler. */
async function serve(ctx: Context, verifyUrl: string, maxBodyBytes = 65536, verifyTimeoutMs = 10_000): Promise<string> {
  const handler = createPayPalWebhookHandler(ctx, { source: 'primary', verifyUrl, verifyTimeoutMs, maxBodyBytes })
  const server = createServer((request, response) => { void handler(request, response) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return `http://127.0.0.1:${String(port)}`
}

/** One PayPal IPN-shaped form-encoded message (charset field included). */
const IPN_BODY = [
  'txn_type=web_accept',
  'payment_status=Completed',
  'txn_id=TEST123',
  'receiver_email=merchant%40example.com',
  'payer_email=buyer%40example.com',
  'mc_gross=19.99',
  'mc_currency=USD',
  'charset=windows-1252',
].join('&')

/** Send one form-encoded request to the adapter. */
async function post(
  base: string,
  body: string,
  options: { contentType?: string; method?: string } = {},
): Promise<Response> {
  return await fetch(base, {
    method: options.method ?? 'POST',
    headers: { 'content-type': options.contentType ?? 'application/x-www-form-urlencoded' },
    ...(options.method === 'GET' ? {} : { body }),
  })
}

describe('PayPal webhook HTTP handler', () => {
  it('verifies via the notify-validate round trip, projects, dispatches, and acks 200', async () => {
    const fake = fakeContext()
    const verifier = await startVerifier('VERIFIED\n')
    const base = await serve(fake.ctx, verifier.url)
    const response = await post(base, IPN_BODY)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(verifier.bodies).toEqual([notifyValidateBody(IPN_BODY)])
    expect(verifier.contentTypes[0]).toBe('application/x-www-form-urlencoded')
    expect(fake.dispatch).toHaveBeenCalledOnce()
    const dispatched: unknown = fake.dispatch.mock.calls[0]?.[0]
    expect(dispatched).toMatchObject({
      kind: 'paypal',
      source: 'primary',
      deliveryId: 'TEST123',
      event: {
        name: 'web_accept',
        payload: {
          txn_type: 'web_accept',
          payment_status: 'Completed',
          txn_id: 'TEST123',
          receiver_email: 'merchant@example.com',
          mc_gross: '19.99',
          charset: 'windows-1252',
        },
      },
    })
    expect(typeof (dispatched as { receivedAt?: unknown }).receivedAt).toBe('number')
  })

  it('accepts a form content type with a UTF-8 charset parameter', async () => {
    const fake = fakeContext()
    const verifier = await startVerifier('VERIFIED')
    const base = await serve(fake.ctx, verifier.url)
    const response = await post(base, IPN_BODY, { contentType: 'application/x-www-form-urlencoded; charset=utf-8' })
    expect(response.status).toBe(200)
    expect(fake.dispatch).toHaveBeenCalledOnce()
  })

  it('rejects an INVALID verification reply with 401 before dispatch', async () => {
    const fake = fakeContext()
    const verifier = await startVerifier('INVALID')
    const base = await serve(fake.ctx, verifier.url)
    const response = await post(base, IPN_BODY)
    expect(response.status).toBe(401)
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('answers 503 when the verification endpoint fails so PayPal retries', async () => {
    const fake = fakeContext()
    const verifier = await startVerifier('', 500)
    const base = await serve(fake.ctx, verifier.url)
    const response = await post(base, IPN_BODY)
    expect(response.status).toBe(503)
    expect(fake.dispatch).not.toHaveBeenCalled()
    expect(fake.warnings).toHaveBeenCalledTimes(1)
  })

  it('answers 503 when the verification round trip exceeds the timeout so PayPal retries', async () => {
    const fake = fakeContext()
    const verifier = await startVerifier('VERIFIED', 200, 5_000)
    const base = await serve(fake.ctx, verifier.url, 65536, 100)
    const response = await post(base, IPN_BODY)
    expect(response.status).toBe(503)
    expect(fake.dispatch).not.toHaveBeenCalled()
    expect(fake.warnings).toHaveBeenCalledTimes(1)
  }, 10_000)

  it.each([
    ['method', { method: 'GET' }, 405],
    ['media type', { contentType: 'text/plain' }, 415],
    ['charset parameter', { contentType: 'application/x-www-form-urlencoded; charset=windows-1252' }, 415],
    ['extra parameters', { contentType: 'application/x-www-form-urlencoded; charset=utf-8; boundary=x' }, 415],
  ] as const)('rejects an invalid %s before verification or dispatch', async (_label, options, status) => {
    const fake = fakeContext()
    const verifier = await startVerifier('VERIFIED')
    const base = await serve(fake.ctx, verifier.url)
    const response = await post(base, IPN_BODY, options)
    expect(response.status).toBe(status)
    if (status === 405) expect(response.headers.get('allow')).toBe('POST')
    expect(verifier.bodies).toHaveLength(0)
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('rejects a missing Content-Type before body processing', async () => {
    const fake = fakeContext()
    const handler = createPayPalWebhookHandler(fake.ctx, {
      source: 'primary',
      verifyUrl: 'http://127.0.0.1:9',
      verifyTimeoutMs: 10_000,
      maxBodyBytes: 1024,
    })
    const request = { method: 'POST', headers: {} } as unknown as IncomingMessage
    const writeHead = vi.fn()
    const response = { setHeader: vi.fn(), writeHead, end: vi.fn() } as unknown as ServerResponse
    await handler(request, response)
    expect(writeHead).toHaveBeenCalledWith(415, expect.any(Object))
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('falls back to unknown names for an IPN without txn_type or txn_id', async () => {
    const fake = fakeContext()
    const verifier = await startVerifier('VERIFIED')
    const base = await serve(fake.ctx, verifier.url)
    const response = await post(base, 'payment_status=Completed&receiver_email=merchant%40example.com')
    expect(response.status).toBe(200)
    const dispatched: unknown = fake.dispatch.mock.calls[0]?.[0]
    expect(dispatched).toMatchObject({
      event: { name: 'unknown' },
    })
    expect(String((dispatched as { deliveryId?: unknown }).deliveryId)).toMatch(/^ipn-\d+$/)
  })

  it('rejects a declared body over the configured cap', async () => {
    const fake = fakeContext()
    const verifier = await startVerifier('VERIFIED')
    const base = await serve(fake.ctx, verifier.url, 2)
    const response = await post(base, 'a=1')
    expect(response.status).toBe(413)
    expect(fake.dispatch).not.toHaveBeenCalled()
  })

  it('answers 503 when the webhook runtime is unavailable', async () => {
    const fake = fakeContext()
    fake.dispatch.mockImplementation(() => { throw new Error('closing') })
    const verifier = await startVerifier('VERIFIED')
    const base = await serve(fake.ctx, verifier.url)
    expect((await post(base, IPN_BODY)).status).toBe(503)
    expect(fake.warnings).toHaveBeenCalledTimes(1)
  })

  it('builds the notify-validate round-trip body exactly', () => {
    expect(notifyValidateBody('a=1')).toBe('a=1&cmd=_notify-validate')
    expect(notifyValidateBody('a=1&')).toBe('a=1&cmd=_notify-validate')
    expect(notifyValidateBody('')).toBe('cmd=_notify-validate')
  })
})
