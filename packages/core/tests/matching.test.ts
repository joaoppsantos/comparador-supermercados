import { describe, expect, it } from 'vitest'
import type { RawOffer } from '@comparador/providers'
import { inferQuantity } from '../src/matching.js'

function offer(overrides: Partial<RawOffer>): RawOffer {
  return {
    externalId: 'x',
    ean: null,
    rawName: 'Produto Teste',
    brand: null,
    quantity: null,
    priceCents: 499,
    unitPrice: null,
    promo: null,
    categoryPath: [],
    url: 'https://example.com/p.html',
    imageUrl: null,
    available: true,
    capturedAt: new Date(),
    ...overrides,
  }
}

describe('inferQuantity', () => {
  it('prefers the store-stated quantity over everything else', () => {
    expect(
      inferQuantity(
        offer({ rawName: 'Leite 1L', quantity: { value: 0.75, unit: 'l' } }),
      ),
    ).toEqual({ value: 0.75, unit: 'l' })
  })

  it('falls back to the quantity parsed from the name', () => {
    expect(
      inferQuantity(offer({ rawName: 'Leite 1L', unitPrice: { cents: 200, per: 'kg' } })),
    ).toEqual({ value: 1, unit: 'l' })
  })

  it('infers package size from the unit price (price ÷ €-per-unit)', () => {
    expect(inferQuantity(offer({ unitPrice: { cents: 1000, per: 'kg' } }))).toEqual({
      value: 0.499,
      unit: 'kg',
    })
  })

  it('uses the promo price when present (unit price follows the selling price)', () => {
    expect(
      inferQuantity(
        offer({
          priceCents: 599,
          promo: { type: 'discount', priceCents: 499, description: '' },
          unitPrice: { cents: 1000, per: 'kg' },
        }),
      ),
    ).toEqual({ value: 0.499, unit: 'kg' })
  })

  it('returns null when there is nothing to infer from', () => {
    expect(inferQuantity(offer({}))).toBeNull()
  })
})
