import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Context with only the services direct apply reads. */
function harness(): { ctx: Context; register: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } {
  const ctx = new Context()
  contexts.push(ctx)
  const remove = vi.fn()
  const register = vi.fn(() => remove)
  ctx.provide('webServer', { register } as never)
  ctx.provide('webhookRuntime', {} as never)
  return { ctx, register, remove }
}

const valid = {
  source: 'primary',
  path: '/paypal',
  maxBodyBytes: 1024,
} satisfies Config

describe('PayPal webhook plugin config', () => {
  it('registers one exact route and removes it with the plugin fiber', async () => {
    const test = harness()
    apply(test.ctx, valid)
    expect(test.register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'exact', path: '/paypal' }))
    await test.ctx.fiber.dispose()
    expect(test.remove).toHaveBeenCalledOnce()
  })

  it('accepts an explicit verification endpoint and timeout alongside the defaults', () => {
    const explicit = harness()
    apply(explicit.ctx, {
      ...valid,
      verifyUrl: 'https://ipnpb.sandbox.paypal.com/cgi-bin/webscr',
      verifyTimeoutMs: 5_000,
    })
    expect(explicit.register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'exact', path: '/paypal' }))
  })

  it.each([
    [{ ...valid, source: '' }, /source/],
    [{ ...valid, source: ' primary' }, /source/],
    [{ ...valid, path: 'paypal' }, /path/],
    [{ ...valid, path: '/' }, /path/],
    [{ ...valid, path: '/paypal/' }, /path/],
    [{ ...valid, path: '/paypal?q=1' }, /path/],
    [{ ...valid, path: '/paypal#x' }, /path/],
    [{ ...valid, verifyUrl: 'ftp://example.com' }, /verifyUrl/],
  ] as const)('rejects invalid config %# before route registration', (config, message) => {
    const test = harness()
    expect(() => { apply(test.ctx, config) }).toThrow(message)
    expect(test.register).not.toHaveBeenCalled()
  })
})
