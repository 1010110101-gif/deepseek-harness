import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as PayPalInvariant from '../src/invariant.ts'

describe('PayPal webhook invariant companion', () => {
  it('registers its explained empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(PayPalInvariant)).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
