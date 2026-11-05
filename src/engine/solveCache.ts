/**
 * A scoped cache for the per-VM passes of sizing. Comparing many designs against the same inventory
 * (the architecture comparison, the options matrix) repeats the same per-VM work for every design:
 * demand totals, the performance-data assessment and the per-VM limit checks. Inside withSolveCache
 * each of those runs once per distinct input and is then reused. Outside it nothing is cached, so a
 * single sizing call always reads the inventory fresh.
 *
 * Arrays and objects are identified by reference, so the cache is only valid while the inputs are not
 * mutated, which holds for one comparison run.
 */
let active: Map<string, unknown> | null = null
let ids = new WeakMap<object, number>()
let nextId = 1

/** Runs fn with a cache. Nested calls share the outer cache. */
export function withSolveCache<T>(fn: () => T): T {
  if (active) return fn()
  active = new Map()
  try {
    return fn()
  } finally {
    active = null
    ids = new WeakMap()
  }
}

export function solveCacheActive(): boolean {
  return active !== null
}

/** A stable id for an object within the current cache scope. */
export function refId(value: object | undefined | null): string {
  if (!value) return '0'
  let id = ids.get(value)
  if (id === undefined) {
    id = nextId++
    ids.set(value, id)
  }
  return String(id)
}

/** Returns the cached value for key, computing it once. Without an active scope it just computes. */
export function cached<T>(key: () => string, compute: () => T): T {
  if (!active) return compute()
  const k = key()
  if (active.has(k)) return active.get(k) as T
  const value = compute()
  active.set(k, value)
  return value
}
