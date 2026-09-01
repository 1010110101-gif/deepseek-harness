/** PayPal IPN HTTP authentication, parsing, and fire-and-forget dispatch. */

import type { Context } from '@deepseek-ai/cordis'
import type { ServerResponse } from 'node:http'
import * as crypto from 'node:crypto'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import {
  WebhookDeliveryId,
  WebhookSourceId,
  type VerifiedWebhookDelivery,
} from '@deepseek-ai/dsh-webhook'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { readBoundedUtf8Body, WebhookHttpError } from './body.ts'
import type { PayPalIpnPayload } from './types.ts'

/** Handler values validated once at plugin load. */
export interface PayPalWebhookHandlerConfig {
  readonly source: string
  readonly secretEnv: CredentialRef
  readonly maxBodyBytes: number
}

/** Whether Content-Type is form-encoded with optional UTF-8 charset. */
function isFormEncodedContentType(value: string | undefined): boolean {
  if (value === undefined) return false
  const parts = value.split(';').map(part => part.trim())
  const [mediaType, parameter, ...extra] = parts
  if (mediaType?.toLowerCase() !== 'application/x-www-form-urlencoded') return false
  if (parameter === undefined) return true
  return extra.length === 0 && /^charset=(?:utf-8|"utf-8")$/i.test(parameter)
}

/** Send one empty or plain-text response exactly once. */
function respond(response: ServerResponse, status: number, message?: string): void {
  if (message === undefined) {
    response.writeHead(status)
    response.end()
    return
  }
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(message)
}

/**
 * Verify PayPal IPN signature using HMAC-SHA256.
 * PayPal includes a 'sig' parameter in the payload; we rebuild the query string
 * in the exact order received and verify the HMAC-SHA256 matches.
 * @param body - raw request body (form-encoded)
 * @param paypalCert - PayPal API signature certificate/secret
 * @returns true if signature is valid
 */
function verifyPayPalSignature(body: string, paypalCert: string): boolean {
  try {
    const params = new URLSearchParams(body)
    const expectedSig = params.get('sig')
    if (!expectedSig) return false

    // Remove the signature from the parameters before computing the hash
    params.delete('sig')

    // Sort parameters alphabetically (PayPal requirement)
    const sortedParams = new URLSearchParams()
    const keys = Array.from(params.keys()).sort()
    for (const key of keys) {
      sortedParams.append(key, params.get(key) ?? '')
    }

    // Compute HMAC-SHA256
    const computed = crypto
      .createHmac('sha256', paypalCert)
      .update(sortedParams.toString())
      .digest('base64')

    return expectedSig === computed
  } catch {
    return false
  }
}

/**
 * Parse form-encoded PayPal IPN data into a JSON object.
 * @param body - raw form-encoded request body
 * @returns parsed lossless JSON object
 */
function parsePayload(body: string): PayPalIpnPayload {
  try {
    const params = new URLSearchParams(body)
    const obj: Record<string, unknown> = {}
    for (const [key, value] of params.entries()) {
      obj[key] = value
    }
    const snapshot = snapshotJsonValue(obj)
    if (snapshot === undefined) throw new WebhookHttpError(400, 'PayPal IPN payload is not lossless JSON')
    return snapshot as PayPalIpnPayload
  } catch (error: unknown) {
    if (error instanceof WebhookHttpError) throw error
    throw new WebhookHttpError(400, 'request body is not valid form-encoded data')
  }
}

/**
 * Create one exact-route PayPal IPN handler.
 * @param ctx - adapter context carrying credentials and webhook runtime.
 * @param config - validated source, credential reference, and body ceiling.
 * @returns an HTTP handler that answers after in-memory dispatch, never rule settlement.
 */
export function createPayPalWebhookHandler(
  ctx: Context,
  config: PayPalWebhookHandlerConfig,
): WebRoute['handler'] {
  return async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.setHeader('allow', 'POST')
        throw new WebhookHttpError(405, 'method not allowed')
      }
      if (!isFormEncodedContentType(request.headers['content-type'])) {
        throw new WebhookHttpError(415, 'content type must be application/x-www-form-urlencoded')
      }
      const body = await readBoundedUtf8Body(request, config.maxBodyBytes)
      const credential = await ctx.credentials.resolve(config.secretEnv)
      if (credential === undefined || credential.value === '') {
        throw new WebhookHttpError(503, 'PayPal certificate/secret is unavailable')
      }
      if (!verifyPayPalSignature(body, credential.value)) {
        throw new WebhookHttpError(401, 'invalid PayPal signature')
      }
      const payload = parsePayload(body)
      const txnType = typeof payload.txn_type === 'string' ? payload.txn_type : 'unknown'
      const txnId = typeof payload.txn_id === 'string' ? payload.txn_id : `ipn-${Date.now()}`
      const delivery: VerifiedWebhookDelivery<'paypal'> = {
        kind: 'paypal',
        source: WebhookSourceId(config.source),
        deliveryId: WebhookDeliveryId(txnId),
        event: { name: txnType, payload },
        receivedAt: Date.now(),
      }
      try {
        ctx.webhookRuntime.dispatch(delivery)
      } catch {
        ctx.logger.warn('webhook-paypal: dispatch unavailable')
        throw new WebhookHttpError(503, 'webhook runtime is unavailable')
      }
      respond(response, 202)
    } catch (error: unknown) {
      if (error instanceof WebhookHttpError) {
        respond(response, error.status, error.message)
        return
      }
      ctx.logger.warn('webhook-paypal: request failed')
      respond(response, 503, 'webhook ingress is unavailable')
    }
  }
}
