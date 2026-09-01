/** Runtime invariant checks for webhook-paypal configuration. */

import type { Config } from './index.ts'

/**
 * Check that PayPal IPN configuration is valid.
 * @param config - validated configuration object
 * @throws if configuration violates invariants
 */
export function assertPayPalConfig(config: Config): void {
  if (!config.source || config.source.trim() !== config.source) {
    throw new Error('webhook-paypal source must be non-empty and trimmed')
  }
  if (!config.path || !config.path.startsWith('/')) {
    throw new Error('webhook-paypal path must be absolute')
  }
  if (config.path === '/') {
    throw new Error('webhook-paypal path must not be root')
  }
  if (config.path.endsWith('/')) {
    throw new Error('webhook-paypal path must not have trailing slash')
  }
  if (config.maxBodyBytes <= 0 || !Number.isSafeInteger(config.maxBodyBytes)) {
    throw new Error('webhook-paypal maxBodyBytes must be a positive safe integer')
  }
}
