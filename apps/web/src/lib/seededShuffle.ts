/**
 * Deterministic shuffle (mulberry32 + Fisher–Yates). Server components must
 * render identically across passes, so randomness always comes from a seed
 * in the URL — never Math.random().
 */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** Stable default seed: changes daily, identical within a day. */
export function dailySeed(): number {
  const d = new Date()
  return d.getFullYear() * 10_000 + (d.getMonth() + 1) * 100 + d.getDate()
}
