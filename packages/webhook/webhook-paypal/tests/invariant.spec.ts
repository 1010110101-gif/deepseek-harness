/** Unit tests for PayPal webhook adapter invariant companion. */

import { describe, it, expect, vi } from 'vitest'
import { name, inject, apply } from '../src/invariant.ts'

describe('webhook-paypal invariant companion', () => {
  it('exports correct plugin metadata', () => {
    expect(name).toBe('webhook-paypal-invariant')
    expect(inject).toEqual(['invariants'])
  })

  it('registers empty invariant with registry', async () => {
    const mockCtx = {
      invariants: {
        register: vi.fn().mockResolvedValue(() => {}),
      },
    }

    const disposer = await apply(mockCtx as unknown)

    expect(mockCtx.invariants.register).toHaveBeenCalledWith(
      '@deepseek-ai/dsh-webhook-paypal',
      expect.any(Function),
    )
    expect(typeof disposer).toBe('function')
  })
})
