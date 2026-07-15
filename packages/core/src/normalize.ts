export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export interface ParsedQuantity {
  value: number
  unit: 'kg' | 'l' | 'un'
  /** The substring that was matched, so callers can strip it from the name. */
  raw: string
}

// "4x110g" / "6 x 0,25L" — multipacks first so the single-quantity regex
// doesn't grab only the per-item part.
const MULTI_RE = /(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|gr?|lt?|cl|ml|un(?:id)?)\b/i
const SINGLE_RE = /(\d+(?:[.,]\d+)?)\s*(kg|gr?|lt?|cl|ml|un(?:id)?)\b/i

function toBaseUnit(value: number, rawUnit: string): { value: number; unit: 'kg' | 'l' | 'un' } | null {
  switch (rawUnit.toLowerCase()) {
    case 'kg':
      return { value, unit: 'kg' }
    case 'g':
    case 'gr':
      return { value: value / 1000, unit: 'kg' }
    case 'l':
    case 'lt':
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

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/** "Iogurte Grego 4x110g" → { value: 0.44, unit: 'kg', raw: '4x110g' } */
export function extractQuantity(name: string): ParsedQuantity | null {
  const multi = name.match(MULTI_RE)
  if (multi && multi[1] !== undefined && multi[2] !== undefined && multi[3] !== undefined) {
    const each = Number.parseFloat(multi[2].replace(',', '.'))
    const base = toBaseUnit(each, multi[3])
    if (base) {
      return { value: round6(base.value * Number(multi[1])), unit: base.unit, raw: multi[0] }
    }
  }
  const single = name.match(SINGLE_RE)
  if (single && single[1] !== undefined && single[2] !== undefined) {
    const base = toBaseUnit(Number.parseFloat(single[1].replace(',', '.')), single[2])
    if (base) return { value: round6(base.value), unit: base.unit, raw: single[0] }
  }
  return null
}

// Connectors only — format words ("garrafa", "lata") are kept because they
// distinguish real product variants.
const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'para', 'o', 'a', 'os', 'as'])

/**
 * Normalizes a product name for matching: strips the quantity and the brand,
 * lowercases, removes accents and connector words, then sorts the remaining
 * tokens so word order differences between stores don't break exact matches.
 */
export function normalizeName(rawName: string, brand?: string | null): string {
  let s = rawName
  const qty = extractQuantity(s)
  if (qty) s = s.replace(qty.raw, ' ')
  s = stripAccents(s.toLowerCase())
  const brandTokens = new Set(
    brand ? stripAccents(brand.toLowerCase()).split(/\s+/).filter(Boolean) : [],
  )
  const tokens = s
    .split(/[^a-z0-9%]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t) && !brandTokens.has(t))
  return [...new Set(tokens)].sort().join(' ')
}
