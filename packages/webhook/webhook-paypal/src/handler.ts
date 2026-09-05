/** PayPal IPN HTTP verification, parsing, and fire-and-forget dispatch. */

import type { Context } from '@deepseek-ai/cordis'
import {
  isWebhookContentType,
  readBoundedUtf8Body,
  WebhookDeliveryId,
  WebhookHttpError,
  webhookRespond,
  WebhookSourceId,
  type VerifiedWebhookDelivery,
} from '@deepseek-ai/dsh-webhook'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PayPalIpnPayload } from './types.ts'

/** PayPal production `cmd=_notify-validate` endpoint; the sandbox overrides it in config. */
export const DEFAULT_VERIFY_URL = 'https://ipnpb.paypal.com/cgi-bin/webscr'

/** Default ceiling for one notify-validate round trip, in milliseconds. */
export const DEFAULT_VERIFY_TIMEOUT_MS = 10_000

/** Handler values validated once at plugin load. */
export interface PayPalWebhookHandlerConfig {
  readonly source: string
  /** Absolute URL that answers the `cmd=_notify-validate` round trip. */
  readonly verifyUrl: string
  /** Millisecond ceiling for one notify-validate round trip. */
  readonly verifyTimeoutMs: number
  readonly maxBodyBytes: number
}

/**
 * Build the `cmd=_notify-validate` round-trip body: the exact received IPN
 * message with the validation command appended (PayPal requirement).
 */
export function notifyValidateBody(body: string): string {
  if (body === '') return 'cmd=_notify-validate'
  return `${body}${body.endsWith('&') ? '' : '&'}cmd=_notify-validate`
}

/**
 * POST the raw IPN body back to PayPal for `cmd=_notify-validate` verification.
 * A non-200 reply or a round trip beyond `verifyTimeoutMs` is a verification
 * failure the caller answers 5xx for, so PayPal keeps retrying the notification.
 * @param body - exact form-encoded IPN message received.
 * @param verifyUrl - PayPal verification endpoint.
 * @param verifyTimeoutMs - abort ceiling for the round trip.
 * @returns the trimmed verification reply (expected `VERIFIED` or `INVALID`).
 */
async function verifyIpn(body: string, verifyUrl: string, verifyTimeoutMs: number): Promise<string> {
  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: notifyValidateBody(body),
    signal: AbortSignal.timeout(verifyTimeoutMs),
  })
  if (!response.ok) throw new Error('PayPal IPN verification endpoint returned an error')
  return (await response.text()).trim()
}

/** Parse form-encoded IPN data into a string-only object, exactly as received. */
function parsePayload(body: string): PayPalIpnPayload {
  const params = new URLSearchParams(body)
  const obj: Record<string, string> = {}
  for (const [key, value] of params.entries()) obj[key] = value
  return obj
}

/**
 * Create one exact-route PayPal IPN handler.
 * @param ctx - adapter context carrying the webhook runtime.
 * @param config - validated source, verification endpoint, and body ceiling.
 * @returns an HTTP handler that verifies via PayPal's notify-validate round trip
 *   and answers `200` after in-memory dispatch, never rule settlement.
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
      if (!isWebhookContentType(request.headers['content-type'], 'application/x-www-form-urlencoded')) {
        throw new WebhookHttpError(415, 'content type must be application/x-www-form-urlencoded')
      }
      const body = await readBoundedUtf8Body(request, config.maxBodyBytes)
      const verification = await verifyIpn(body, config.verifyUrl, config.verifyTimeoutMs)
      if (verification !== 'VERIFIED') {
        throw new WebhookHttpError(401, 'PayPal IPN verification did not return VERIFIED')
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
      // PayPal IPN treats exactly HTTP 200 as the delivery ack; any other
      // status makes PayPal re-send the notification (escalating, days long).
      webhookRespond(response, 200)
    } catch (error: unknown) {
      if (error instanceof WebhookHttpError) {
        webhookRespond(response, error.status, error.message)
        return
      }
      ctx.logger.warn('webhook-paypal: request failed')
      webhookRespond(response, 503, 'webhook ingress is unavailable')
    }
  }
}
