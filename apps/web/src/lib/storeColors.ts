/**
 * Fixed categorical slot per store (color follows the entity, never rank or
 * insertion order). Values are defined as CSS custom properties in
 * globals.css for both light and dark mode.
 */
const STORE_SLOTS: Record<string, number> = {
  continente: 1,
  'pingo-doce': 2,
  auchan: 3,
  lidl: 4,
  'el-corte-ingles': 5,
}

export function storeColorVar(slug: string): string {
  const slot = STORE_SLOTS[slug]
  return slot ? `var(--series-${slot})` : 'var(--text-muted)'
}
