/** Compute demand and per-host usable capacity. */
import { LIMITS, TB_TO_GIB, TIER_IDS } from './rules'
import type { ClusterConfig, ComputeDemand, NodeSpec, TierId, TierPolicy, Vm } from './types'

export function totalCores(node: NodeSpec): number {
  return node.sockets * node.coresPerSocket
}

/**
 * Licensable cores per node. Windows Server minimums: 8 per socket AND 16 per server,
 * whichever is greater. [MS] Undersized hosts still cost 16 cores of Datacenter licensing.
 */
export function licensableCores(node: NodeSpec): number {
  return Math.max(
    totalCores(node),
    node.sockets * LIMITS.LICENSE_MIN_CORES_PER_SOCKET,
    LIMITS.LICENSE_MIN_CORES_PER_SERVER,
  )
}

/**
 * Usable physical cores per host after the root-partition reserve.
 * Microsoft publishes no CPU reserve figure — it is calculated dynamically by Hyper-V.
 * We reserve max(1 core, hostCoreReservePct). [TOOL]
 *
 * smtFactor defaults to 1.0 — no credit for hyperthreading. The core scheduler (default
 * since WS2019) pairs VPs onto SMT siblings so a physical core is never shared between two
 * VMs; taking SMT credit on top of a 4:1 ratio double-counts the same headroom.
 */
export function usableCoresPerHost(node: NodeSpec, cfg: ClusterConfig): number {
  const cores = totalCores(node)
  const reserve = Math.max(1, cores * cfg.hostCoreReservePct)
  return Math.max(0, (cores - reserve) * cfg.smtFactor)
}

/**
 * S2D pool metadata RAM: 4 GiB per TB of cache capacity per server. [MS]
 * Routinely forgotten, and can be tens of GiB per node.
 */
export function s2dMetadataRamGiB(node: NodeSpec, usesS2d: boolean): number {
  if (!usesS2d) return 0
  const cacheTB = node.cacheDrivesPerNode * node.cacheDriveTB
  return cacheTB * LIMITS.S2D_RAM_PER_TB_CACHE_GIB
}

/**
 * Usable RAM per host. Reserve is max(absolute, percentage) plus S2D metadata.
 * Closest official anchor for the percentage is Azure Stack Hub's published 15% constant,
 * which is Azure Stack Hub-specific rather than general Hyper-V guidance. [TOOL]
 */
export function usableRamPerHost(node: NodeSpec, cfg: ClusterConfig): number {
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'
  const reserve =
    Math.max(cfg.hostRamReserveGiB, node.ramGiB * cfg.hostRamReservePct) +
    s2dMetadataRamGiB(node, usesS2d)
  return Math.max(0, node.ramGiB - reserve)
}

const emptyTier = () => ({ pCores: 0, ramGiB: 0, vms: 0, storageGiB: 0 })

/** Aggregate workload demand, applying per-tier oversubscription and right-sizing. */
export function computeDemand(
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
  growthFactor: number,
): ComputeDemand {
  const byTier = {
    general: emptyTier(),
    database: emptyTier(),
    vdi: emptyTier(),
    infrastructure: emptyTier(),
  } as ComputeDemand['byTier']

  let totalVCpu = 0
  let vmCount = 0

  for (const vm of vms) {
    if (!vm.include) continue
    const t = tiers[vm.tier]
    const rsf = t.rightSizingFactor
    byTier[vm.tier].pCores += (vm.vCpu * rsf) / t.oversubscription
    byTier[vm.tier].ramGiB += vm.ramGiB * rsf
    byTier[vm.tier].storageGiB += vm.storageGiB
    byTier[vm.tier].vms += 1
    totalVCpu += vm.vCpu
    vmCount += 1
  }

  let requiredPCores = 0
  let requiredRamGiB = 0
  for (const id of TIER_IDS) {
    byTier[id].pCores *= growthFactor
    byTier[id].ramGiB *= growthFactor
    byTier[id].storageGiB *= growthFactor
    requiredPCores += byTier[id].pCores
    requiredRamGiB += byTier[id].ramGiB
  }

  return { requiredPCores, requiredRamGiB, totalVCpu, vmCount, byTier }
}

export function requiredStorageGiB(demand: ComputeDemand): number {
  return TIER_IDS.reduce((sum, id) => sum + demand.byTier[id].storageGiB, 0)
}

export const tbToGiB = (tb: number) => tb * TB_TO_GIB
export const giBToTiB = (giB: number) => giB / 1024
export const tiBToGiB = (tiB: number) => tiB * 1024
