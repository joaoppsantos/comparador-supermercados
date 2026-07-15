import { describe, expect, it } from 'vitest'
import { extractQuantity, normalizeName, stripAccents } from '../src/normalize.js'

describe('stripAccents', () => {
  it('removes Portuguese diacritics', () => {
    expect(stripAccents('Laticínios e Ovos — Pêra Rocha à Média')).toBe(
      'Laticinios e Ovos — Pera Rocha a Media',
    )
  })
})

describe('extractQuantity', () => {
  it('parses simple quantities into base units', () => {
    expect(extractQuantity('Leite UHT Meio Gordo 1L')).toMatchObject({ value: 1, unit: 'l' })
    expect(extractQuantity('Queijo Flamengo Fatiado 200g')).toMatchObject({
      value: 0.2,
      unit: 'kg',
    })
    expect(extractQuantity('Arroz Agulha 1kg')).toMatchObject({ value: 1, unit: 'kg' })
    expect(extractQuantity('Ovos Classe M 12 un')).toMatchObject({ value: 12, unit: 'un' })
    expect(extractQuantity('Azeite Virgem Extra 75cl')).toMatchObject({ value: 0.75, unit: 'l' })
  })

  it('parses multipacks, including comma decimals', () => {
    expect(extractQuantity('Iogurte Grego Ligeiro 4x110g')).toMatchObject({
      value: 0.44,
      unit: 'kg',
    })
    expect(extractQuantity('Cerveja Mini 6x0,25L')).toMatchObject({ value: 1.5, unit: 'l' })
    expect(extractQuantity('Sumo 3 x 200 ml')).toMatchObject({ value: 0.6, unit: 'l' })
  })

  it('returns null when there is no quantity', () => {
    expect(extractQuantity('Leite UHT Meio Gordo Continente')).toBeNull()
  })
})

describe('normalizeName', () => {
  it('strips brand, quantity, accents and connectors, and sorts tokens', () => {
    expect(normalizeName('Leite UHT Meio Gordo Continente 1L', 'Continente')).toBe(
      'gordo leite meio uht',
    )
  })

  it('is insensitive to word order (cross-store name variations)', () => {
    expect(normalizeName('Leite UHT Meio Gordo 1L', null)).toBe(
      normalizeName('Leite Meio Gordo UHT 1L', null),
    )
  })

  it('keeps format words that distinguish variants', () => {
    expect(normalizeName('Cerveja Lata 33cl', null)).not.toBe(
      normalizeName('Cerveja Garrafa 33cl', null),
    )
  })
})
