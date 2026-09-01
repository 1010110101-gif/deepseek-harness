/** Unit tests for webhook-paypal configuration validation. */

import { describe, it, expect } from 'vitest'
import { assertPayPalConfig } from '../src/invariant.ts'

describe('PayPal webhook configuration', () => {
  it('accepts valid configuration', () => {
    const config = {
      source: 'primary-paypal',
      path: '/webhook/paypal',
      secretEnv: 'PAYPAL_CERT',
      maxBodyBytes: 65536,
    }
    expect(() => assertPayPalConfig(config)).not.toThrow()
  })

  it('rejects empty source', () => {
    const config = {
      source: '',
      path: '/webhook/paypal',
      secretEnv: 'PAYPAL_CERT',
      maxBodyBytes: 65536,
    }
    expect(() => assertPayPalConfig(config)).toThrow()
  })

  it('rejects non-absolute path', () => {
    const config = {
      source: 'primary-paypal',
      path: 'webhook/paypal',
      secretEnv: 'PAYPAL_CERT',
      maxBodyBytes: 65536,
    }
    expect(() => assertPayPalConfig(config)).toThrow()
  })

  it('rejects root path', () => {
    const config = {
      source: 'primary-paypal',
      path: '/',
      secretEnv: 'PAYPAL_CERT',
      maxBodyBytes: 65536,
    }
    expect(() => assertPayPalConfig(config)).toThrow()
  })

  it('rejects trailing slash in path', () => {
    const config = {
      source: 'primary-paypal',
      path: '/webhook/paypal/',
      secretEnv: 'PAYPAL_CERT',
      maxBodyBytes: 65536,
    }
    expect(() => assertPayPalConfig(config)).toThrow()
  })

  it('rejects invalid maxBodyBytes', () => {
    const config = {
      source: 'primary-paypal',
      path: '/webhook/paypal',
      secretEnv: 'PAYPAL_CERT',
      maxBodyBytes: 0,
    }
    expect(() => assertPayPalConfig(config)).toThrow()
  })
})
