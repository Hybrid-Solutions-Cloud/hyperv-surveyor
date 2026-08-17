/**
 * Scenario -> URL. An SE builds a config on a call, sends the link, the customer opens the
 * exact same numbers. VM inventories are omitted above a size threshold to keep URLs usable —
 * the config always survives, and the inventory is re-importable.
 */
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'

export interface Scenario {
  cfg: ClusterConfig
  tiers: Record<TierId, TierPolicy>
  vms?: Vm[]
  customerName?: string
}

const MAX_VMS_IN_URL = 60

function encode(obj: unknown): string {
  const json = JSON.stringify(obj)
  return btoa(unescape(encodeURIComponent(json)))
}

function decode<T>(s: string): T | null {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(s)))) as T
  } catch {
    return null
  }
}

export function toUrl(scn: Scenario): string {
  const payload: Scenario = {
    cfg: scn.cfg,
    tiers: scn.tiers,
    customerName: scn.customerName,
    vms: scn.vms && scn.vms.length <= MAX_VMS_IN_URL ? scn.vms : undefined,
  }
  const base = window.location.href.split('#')[0]
  return `${base}#s=${encode(payload)}`
}

export function fromUrl(): Scenario | null {
  const hash = window.location.hash
  if (!hash.startsWith('#s=')) return null
  return decode<Scenario>(hash.slice(3))
}

export function urlOmittedInventory(scn: Scenario): boolean {
  return !!scn.vms && scn.vms.length > MAX_VMS_IN_URL
}
