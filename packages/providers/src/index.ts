import type { ProviderOptions, StoreProvider } from './types.js'
import { AuchanProvider } from './auchan/index.js'
import { ContinenteProvider } from './continente/index.js'
import { PingoDoceProvider } from './pingo-doce/index.js'

export * from './types.js'
export { politeFetch, HttpStatusError } from './http.js'

const registry: Record<string, (opts?: ProviderOptions) => StoreProvider> = {
  auchan: (opts) => new AuchanProvider(opts),
  continente: (opts) => new ContinenteProvider(opts),
  'pingo-doce': (opts) => new PingoDoceProvider(opts),
}

export function getProvider(slug: string, opts?: ProviderOptions): StoreProvider {
  const factory = registry[slug]
  if (!factory) {
    throw new Error(`Unknown store provider: ${slug} (known: ${Object.keys(registry).join(', ')})`)
  }
  return factory(opts)
}

export function knownProviderSlugs(): string[] {
  return Object.keys(registry)
}
