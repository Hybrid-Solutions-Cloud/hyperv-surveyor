/**
 * CSV / LUN layout planning.
 *
 * THE BLAST-RADIUS PRINCIPLE
 * Microsoft imposes NO limit on VMs per CSV — it says so explicitly. The real constraint is
 * recovery granularity, and it differs fundamentally by storage type:
 *
 *   SAN  — the LUN IS the restore unit. A Pure/Everpure array snapshot operates at whole-volume
 *          level, so 60 VMs on one LUN means restoring one VM mounts a 60-VM snapshot. Pure's
 *          stated design philosophy is to align CSV boundaries to snapshot/recovery granularity.
 *   S2D  — the volume is the RESILIENCY unit. Restore granularity comes from the backup product,
 *          so the drivers are resiliency tiering, rebuild time, and ownership distribution.
 *
 * ALGORITHM (per tier, per storage domain)
 *   max_csv_size = MIN(64 TiB [MS-REC], 10 TiB if VSS-volsnap [MS], blast_radius [TOOL])
 *   per_tier_count = MAX(ceil(capacity/max_size), ceil(planned_vms/max_vms_per_csv))
 *   total S2D volumes = at least node_count and rounded to a node-count multiple [MS-REC]
 *   error if total across all tiers > 64                 [MS-REC]
 */
import { LIMITS, TIER_IDS } from './rules'
import { giBToTiB } from './compute'
import type {
  BackupMethod,
  ClusterConfig,
  ComputeDemand,
  CsvPlan,
  TierId,
  TierPolicy,
} from './types'

export function roundUpToMultiple(value: number, multiple: number): number {
  if (multiple <= 0) return value
  return Math.ceil(value / multiple) * multiple
}

export function maxCsvSizeTiB(policy: TierPolicy, backup: BackupMethod): number {
  const caps = [LIMITS.MAX_CSV_SIZE_TIB, policy.blastRadiusTiB]
  if (backup === 'vss-volsnap') caps.push(LIMITS.VSS_CSV_LIMIT_TIB)
  return Math.min(...caps)
}

interface PlanArgs {
  tier: TierId
  policy: TierPolicy
  capacityTiB: number
  vmCount: number
  nodes: number
  backup: BackupMethod
  domain: 's2d' | 'san'
}

export function planTierCsvs(a: PlanArgs): CsvPlan | null {
  if (a.capacityTiB <= 0 || a.vmCount <= 0) return null

  const maxSize = maxCsvSizeTiB(a.policy, a.backup)
  const byCapacity = Math.ceil(a.capacityTiB / maxSize)
  const byBlast = Math.ceil(a.vmCount / a.policy.maxVmsPerCsv)
  const rawCount = Math.max(byCapacity, byBlast)
  const count = rawCount

  const driver: CsvPlan['driver'] = byCapacity === byBlast
    ? 'both'
    : byCapacity > byBlast ? 'capacity' : 'vm-count'

  return {
    tier: a.tier,
    storageTier: a.policy.storageTier,
    domain: a.domain,
    count,
    sizeTiB: Math.ceil((a.capacityTiB / count) * 10) / 10,
    totalTiB: a.capacityTiB,
    plannedVms: a.vmCount,
    vmsPerCsv: Math.ceil(a.vmCount / count),
    maxSizeTiB: maxSize,
    countByCapacity: byCapacity,
    countByVmLimit: byBlast,
    maxVmsPerCsv: a.policy.maxVmsPerCsv,
    driver,
    roundedUpFrom: rawCount,
    // [MS] In a hybrid cluster SAN CSVs must be NTFS - ReFS is not supported on SAN-backed
    // volumes. S2D volumes are ReFS (required for mirror-accelerated parity).
    filesystem: a.domain === 's2d' ? 'ReFS' : 'NTFS',
  }
}

/**
 * Build the full CSV plan across every tier and storage domain.
 * In hybrid mode each tier is placed explicitly on S2D, SAN, or intentionally split.
 */
export function planCsvs(
  cfg: ClusterConfig,
  demand: ComputeDemand,
  tiers: Record<TierId, TierPolicy>,
  nodes: number,
): CsvPlan[] {
  const plans: CsvPlan[] = []

  for (const id of TIER_IDS) {
    const t = demand.byTier[id]
    if (t.vms === 0) continue
    const capacityTiB = giBToTiB(t.storageGiB)
    const policy = tiers[id]

    if (cfg.architecture === 'san') {
      const p = planTierCsvs({
        tier: id, policy, capacityTiB, vmCount: t.plannedVms,
        nodes, backup: cfg.backupMethod, domain: 'san',
      })
      if (p) plans.push(p)
    } else if (cfg.architecture === 's2d') {
      const p = planTierCsvs({
        tier: id, policy, capacityTiB, vmCount: t.plannedVms,
        nodes, backup: cfg.backupMethod, domain: 's2d',
      })
      if (p) plans.push(p)
    } else {
      const placement = policy.hybridPlacement ?? (policy.storageTier === 'performance' ? 's2d' : 'san')
      const s2dShare = placement === 's2d' ? 1 : placement === 'san' ? 0 : cfg.hybridS2dShare
      const sanShare = 1 - s2dShare
      if (s2dShare > 0.01) {
        const p = planTierCsvs({
          tier: id, policy,
          capacityTiB: capacityTiB * s2dShare,
          vmCount: Math.max(1, Math.round(t.plannedVms * s2dShare)),
          nodes, backup: cfg.backupMethod, domain: 's2d',
        })
        if (p) plans.push(p)
      }
      if (sanShare > 0.01) {
        const p = planTierCsvs({
          tier: id, policy,
          capacityTiB: capacityTiB * sanShare,
          vmCount: Math.max(1, Math.round(t.plannedVms * sanShare)),
          nodes, backup: cfg.backupMethod, domain: 'san',
        })
        if (p) plans.push(p)
      }
    }
  }

  // Microsoft recommends at least one S2D volume per node and a total volume count that is
  // a multiple of node count for even coordinator ownership. Apply that once across the S2D
  // domain, not independently to every workload tier.
  const s2dPlans = plans.filter((plan) => plan.domain === 's2d')
  if (s2dPlans.length > 0 && nodes > 0) {
    const current = s2dPlans.reduce((sum, plan) => sum + plan.count, 0)
    const target = roundUpToMultiple(Math.max(current, nodes), nodes)
    const extra = target - current
    if (extra > 0) {
      const targetPlan = [...s2dPlans].sort((a, b) => b.totalTiB - a.totalTiB)[0]
      targetPlan.count += extra
      targetPlan.sizeTiB = Math.ceil((targetPlan.totalTiB / targetPlan.count) * 10) / 10
      targetPlan.vmsPerCsv = Math.ceil(targetPlan.plannedVms / targetPlan.count)
      targetPlan.driver = 'node-count'
    }
  }
  return plans
}

export function totalCsvCount(plans: CsvPlan[]): number {
  return plans.reduce((n, p) => n + p.count, 0)
}
