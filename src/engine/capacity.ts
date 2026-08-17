/**
 * Storage capacity maths — S2D and SAN.
 *
 * S2D usable capacity chain [MS]:
 *   1. raw_per_server = capacity_drives x drive_size      (cache excluded entirely)
 *   2. raw_pool       = sum(raw_per_server)
 *   3. available      = raw_pool - reserve
 *   4. usable         = available x efficiency(resiliency, nodes, media)
 *
 * Microsoft publishes NO filesystem-overhead percentage beyond this. We do not invent one.
 */
import { LIMITS, resiliencyEfficiency } from './rules'
import { giBToTiB, tbToGiB } from './compute'
import type { CapacityResult, ClusterConfig, NodeSpec, SanSpec } from './types'

/**
 * Reserve capacity for in-place repair [MS-REC]:
 *   one capacity drive per server, capped at 4 drives' worth TOTAL regardless of cluster size.
 * A 16-node cluster still reserves only 4 drives. Source: plan-volumes.
 */
export function reserveTiB(node: NodeSpec, nodes: number): number {
  const driveGiB = tbToGiB(node.capacityDriveTB)
  return giBToTiB(Math.min(driveGiB * nodes, driveGiB * 4))
}

export function s2dCapacity(cfg: ClusterConfig, nodes: number): CapacityResult {
  const node = cfg.node
  const rawGiB = nodes * node.capacityDrivesPerNode * tbToGiB(node.capacityDriveTB)
  const rawTiB = giBToTiB(rawGiB)
  const reserve = reserveTiB(node, nodes)
  const availableTiB = Math.max(0, rawTiB - reserve)
  const { eff, label } = resiliencyEfficiency(
    cfg.resiliency,
    nodes,
    node.media,
    node.capacityDrivesPerNode,
    cfg.nestedMapMirrorPct,
  )
  return {
    rawTiB,
    reserveTiB: reserve,
    availableTiB,
    usableTiB: availableTiB * eff,
    efficiency: eff,
    efficiencyLabel: label,
  }
}

/**
 * Minimum S2D node count to satisfy a capacity requirement.
 * Efficiency is itself a function of node count for parity layouts, so this must iterate
 * rather than divide. Returns Infinity when unreachable within the 16-node ceiling.
 */
export function s2dNodesForCapacity(cfg: ClusterConfig, requiredTiB: number): number {
  const min = Math.max(LIMITS.S2D_MIN_NODES, 2)
  for (let n = min; n <= LIMITS.S2D_MAX_NODES; n++) {
    if (s2dCapacity(cfg, n).usableTiB >= requiredTiB) return n
  }
  return Infinity
}

/**
 * SAN effective capacity.
 * Input MUST be usable capacity, never "effective" — effective already has DRR baked in and
 * multiplying it again double-counts. Thin-provisioning savings are modelled separately and
 * are NEVER folded into the DRR, because thin savings evaporate as guests fill their volumes.
 */
export function sanCapacityTiB(san: SanSpec): number {
  return san.usableTiB * Math.max(1, san.drr)
}

/** Raw capacity per server, for the 400 TB soft-ceiling check [MS-REC]. */
export function rawPerServerTB(node: NodeSpec): number {
  return node.capacityDrivesPerNode * node.capacityDriveTB
}

export function cacheRatio(node: NodeSpec): number {
  const cap = node.capacityDrivesPerNode * node.capacityDriveTB
  const cache = node.cacheDrivesPerNode * node.cacheDriveTB
  return cap > 0 ? cache / cap : 0
}

export function usesCacheTier(node: NodeSpec): boolean {
  return node.cacheDrivesPerNode > 0
}
