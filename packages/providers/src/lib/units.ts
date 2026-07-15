// Small shared helpers for adapters (not a provider — adapters must not
// import each other, but may share these utilities).

export type BaseUnit = 'kg' | 'l' | 'un'

/** "1 L" / "200 g" / "0,75 cl" → base units. Returns null for unknown units. */
export function toBaseQuantity(
  rawValue: string,
  rawUnit: string,
): { value: number; unit: BaseUnit } | null {
  const value = Number.parseFloat(rawValue.replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return null
  switch (rawUnit.toLowerCase()) {
    case 'kg':
      return { value, unit: 'kg' }
    case 'g':
    case 'gr':
      return { value: value / 1000, unit: 'kg' }
    case 'l':
    case 'lt':
    case 'ltr':
      return { value, unit: 'l' }
    case 'cl':
      return { value: value / 100, unit: 'l' }
    case 'ml':
      return { value: value / 1000, unit: 'l' }
    case 'un':
    case 'uni':
    case 'unid':
      return { value, unit: 'un' }
    default:
      return null
  }
}

/** "0,9 €/L" / "0.24 €/un" → { cents, per }. */
export function parseUnitPrice(text: string): { cents: number; per: BaseUnit } | null {
  const m = text.replace(/\s+/g, '').match(/(\d+(?:[.,]\d+)?)(?:€|&euro;)\/(\w+)/i)
  if (!m || m[1] === undefined || m[2] === undefined) return null
  const cents = Math.round(Number.parseFloat(m[1].replace(',', '.')) * 100)
  if (cents <= 0) return null
  const base = toBaseQuantity('1', m[2])
  if (!base) return null
  return { cents, per: base.unit }
}

/** SFCC price `content` attribute ("4.49") → cents. */
export function contentAttrToCents(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed * 100)
}

/** Strips zero-width characters that Pingo Doce embeds in category/product names. */
export function stripInvisible(s: string): string {
  return s.replace(/[\u200b-\u200d\ufeff]/g, '').trim()
}
