/** PayPal IPN HTTP adapter for the provider-neutral webhook runtime. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { createPayPalWebhookHandler, DEFAULT_VERIFY_TIMEOUT_MS, DEFAULT_VERIFY_URL } from './handler.ts'

export type * from './types.ts'

/** Cordis function-plugin name. */
export const name = 'webhook-paypal'
/** Host services required before the exact route can register. */
export const inject = ['webServer', 'webhookRuntime']

/** Required PayPal ingress configuration. */
export interface Config {
  /** Adapter instance name carried to rules. */
  readonly source: string
  /** Exact absolute route path. */
  readonly path: string
  /** Absolute `cmd=_notify-validate` endpoint; defaults to PayPal production. */
  readonly verifyUrl?: string
  /** Millisecond ceiling for one verify round trip; defaults to `DEFAULT_VERIFY_TIMEOUT_MS`. */
  readonly verifyTimeoutMs?: number
  /** Positive raw body ceiling in bytes. */
  readonly maxBodyBytes: number
}

export const Config: z<Config> = z.object({
  source: z.string().required(),
  path: z.string().required(),
  verifyUrl: z.string(),
  verifyTimeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  maxBodyBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
})

/** Validate route, source, and verification URL facts that Schemastery cannot express. */
function assertConfig(config: Config): void {
  if (config.source.trim() !== config.source || config.source === '') {
    throw new Error('webhook-paypal source must be a non-empty trimmed string')
  }
  if (!config.path.startsWith('/') || config.path === '/' || config.path.endsWith('/')
    || config.path.includes('?') || config.path.includes('#')) {
    throw new Error('webhook-paypal path must be an absolute non-root pathname without a trailing slash, query, or fragment')
  }
  if (config.verifyUrl !== undefined && !/^https?:\/\//i.test(config.verifyUrl)) {
    throw new Error('webhook-paypal verifyUrl must be an absolute http(s) URL')
  }
}

/** Register one exact PayPal IPN endpoint on the injected WebServer. */
export function apply(ctx: Context, config: Config): void {
  assertConfig(config)
  const route = {
    kind: 'exact' as const,
    path: config.path,
    handler: createPayPalWebhookHandler(ctx, {
      source: config.source,
      verifyUrl: config.verifyUrl ?? DEFAULT_VERIFY_URL,
      verifyTimeoutMs: config.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS,
      maxBodyBytes: config.maxBodyBytes,
    }),
  }
  ctx.effect(
    () => ctx.webServer.register(route),
    `webhook-paypal: ${config.path}`,
  )
}
