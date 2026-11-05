/**
 * What to do when a design does not fit one cluster. The advice follows what actually binds (C6): a
 * larger server only helps when CPU or memory binds. When storage binds, more server does not help.
 */
import { LIMITS } from './rules'
import type { ClusterConfig, SizingResult } from './types'

export type OverLimitCause = 'compute' | 'storage' | 'vm-count' | 'spares' | 'array' | 'other'

/** Why a one-cluster result does not fit, in order of importance. */
export function overLimitCauses(result: SizingResult, cfg: Pick<ClusterConfig, 'architecture' | 'spareNodes'>): OverLimitCause[] {
  if (result.feasible) return []
  const limit = result.clusterNodeLimit
  const causes: OverLimitCause[] = []
  if (cfg.spareNodes + 1 > limit) causes.push('spares')
  const usesS2d = cfg.architecture !== 'san'
  const arrayShort = result.sanCapacityTiB !== null && result.requiredSanTiB > result.sanCapacityTiB
  if (arrayShort) causes.push('array')
  else if (usesS2d && !Number.isFinite(result.nodesIfStorageOnly)) causes.push('storage')
  if (Math.max(result.nodesIfCpuOnly, result.nodesIfMemoryOnly) > limit && Number.isFinite(Math.max(result.nodesIfCpuOnly, result.nodesIfMemoryOnly))) causes.push('compute')
  const plannedVms = Object.values(result.demand.byTier).reduce((sum, tier) => sum + tier.plannedVms, 0)
  if (Math.ceil(plannedVms / LIMITS.MAX_VMS_PER_HOST) + cfg.spareNodes > limit) causes.push('vm-count')
  if (causes.length === 0) causes.push('other')
  return causes
}

/** One sentence of advice for a design that does not fit one cluster. Never suggests a larger server when storage binds. */
export function overLimitAdvice(result: SizingResult, cfg: Pick<ClusterConfig, 'architecture' | 'spareNodes'>): string {
  const causes = overLimitCauses(result, cfg)
  const usesS2d = cfg.architecture !== 'san'
  const steps: string[] = []
  if (causes.includes('spares')) steps.push('reduce the spare nodes or choose a resiliency that allows more nodes')
  if (causes.includes('storage')) {
    steps.push('add capacity drives or use larger drives, choose a more capacity-efficient resiliency, or move capacity to SAN or hybrid storage (a larger server does not add storage)')
  }
  if (causes.includes('array')) steps.push('increase the array size or its data reduction ratio (more hosts do not change the array)')
  if (causes.includes('compute')) steps.push(usesS2d ? 'use a larger server or SAN storage, which allows up to 64 nodes' : 'use a larger server')
  if (causes.includes('vm-count')) steps.push(usesS2d ? 'use SAN storage, which allows up to 64 nodes (a larger server does not raise the VMs-per-host limit)' : 'note that a larger server does not raise the VMs-per-host limit')
  if (causes.includes('other')) steps.push('review the design findings')
  const split = causes.some((cause) => cause === 'storage' || cause === 'compute' || cause === 'vm-count')
  return `To resolve it: ${[...new Set(steps)].join('; ')}${split ? '; or choose to split into multiple clusters yourself' : ''}.`
}
