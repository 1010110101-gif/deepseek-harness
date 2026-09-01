/** Unit tests for PayPal IPN webhook handler and signature verification. */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as crypto from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createPayPalWebhookHandler } from '../src/handler.ts'
import type { PayPalWebhookHandlerConfig } from '../src/handler.ts'

describe('PayPal webhook handler', () => {
  const mockCert = 'test-paypal-cert'
  const mockSource = 'primary-paypal'

  let mockCtx: { credentials: unknown; webhookRuntime: unknown; logger: unknown }
  let mockRequest: { method: string; headers: unknown; complete: boolean; [Symbol.asyncIterator]: unknown }
  let mockResponse: { writeHead: unknown; end: unknown; setHeader: unknown }
  let handler: unknown

  beforeEach(() => {
    mockCtx = {
      credentials: {
        resolve: vi.fn().mockResolvedValue({ value: mockCert }),
      },
      webhookRuntime: {
        dispatch: vi.fn(),
      },
      logger: {
        warn: vi.fn(),
      },
    }

    mockRequest = {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': '0',
        headersDistinct: {},
      },
      complete: true,
      [Symbol.asyncIterator]: vi.fn(),
    }

    mockResponse = {
      writeHead: vi.fn(),
      end: vi.fn(),
      setHeader: vi.fn(),
    }

    const config: PayPalWebhookHandlerConfig = {
      source: mockSource,
      secretEnv: credentialRef('PAYPAL_SECRET'),
      maxBodyBytes: 65536,
    }

    handler = createPayPalWebhookHandler(mockCtx as unknown as Context, config)
  })

  it('rejects non-POST requests', async () => {
    mockRequest.method = 'GET'
    await handler(mockRequest, mockResponse)
    expect(mockResponse.writeHead).toHaveBeenCalledWith(405)
  })

  it('rejects missing Content-Type header', async () => {
    mockRequest.headers['content-type'] = undefined
    mockRequest[Symbol.asyncIterator] = async function* () {
      yield Buffer.from('')
    }
    await handler(mockRequest, mockResponse)
    expect(mockResponse.writeHead).toHaveBeenCalledWith(415)
  })

  it('rejects invalid signature', async () => {
    const formData = 'txn_type=web_accept&txn_id=12345&sig=invalidsig'
    mockRequest[Symbol.asyncIterator] = async function* () {
      yield Buffer.from(formData)
    }
    await handler(mockRequest, mockResponse)
    expect(mockResponse.writeHead).toHaveBeenCalledWith(401)
  })

  it('accepts valid IPN payload', async () => {
    // Construct a valid payload with proper signature
    const params = new URLSearchParams()
    params.append('txn_type', 'web_accept')
    params.append('txn_id', '12345')
    params.append('receiver_email', 'merchant@example.com')
    params.append('payer_email', 'buyer@example.com')

    // Sort for signature computation (PayPal requirement)
    const forSig = new URLSearchParams()
    const keys = Array.from(params.keys()).sort()
    for (const key of keys) {
      forSig.append(key, params.get(key) ?? '')
    }

    const signature = crypto
      .createHmac('sha256', mockCert)
      .update(forSig.toString())
      .digest('base64')

    params.append('sig', signature)
    const formData = params.toString()

    mockRequest[Symbol.asyncIterator] = async function* () {
      yield Buffer.from(formData)
    }

    await handler(mockRequest, mockResponse)

    expect(mockResponse.writeHead).toHaveBeenCalledWith(202)
    expect(mockCtx.webhookRuntime.dispatch).toHaveBeenCalled()
  })
})
