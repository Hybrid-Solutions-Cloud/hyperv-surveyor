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
 * SAN defaults to an operationally balanced plan: at least one CSV/LUN per node for a
 * SAN-only cluster, then only enough additional LUNs to satisfy the platform/backup size cap.
 * The editable recovery-size and VMs-per-recovery-unit targets remain visible as a more
 * granular alternative. Operators can enforce that alternative or enter a custom total.
 *
 * S2D continues to enforce the per-tier recovery targets and then applies the documented
 * minimum of one volume per node. Microsoft recommends no maximum VM count per CSV.
 */
import { LIMITS, TIER_IDS } from './rules'
import { giBToTiB } from './compute'
import type {
  BackupMethod,
  ClusterConfig,
  ComputeDemand,
  CsvPlan,
  SanCsvLayoutMode,
  TierId,
  TierPolicy,
} from './types'

export function roundUpToMultiple(value: number, multiple: number): number {
  if (multiple <= 0) return value
  return Math.ceil(value / multiple) * multiple
}

export function maxCsvSizeTiB(policy: TierPolicy, backup: BackupMethod): number {
  return Math.min(hardMaxCsvSizeTiB(backup), policy.blastRadiusTiB)
}

/** Platform/backup cap without the editable tool recovery target. */
export function hardMaxCsvSizeTiB(backup: BackupMethod): number {
  const caps: number[] = [LIMITS.MAX_CSV_SIZE_TIB]
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
  layoutMode?: SanCsvLayoutMode | 's2d'
}

export function planTierCsvs(a: PlanArgs): CsvPlan | null {
  if (a.capacityTiB <= 0 || a.vmCount <= 0) return null

  const layoutMode = a.layoutMode ?? (a.domain === 's2d' ? 's2d' : 'granular')
  const recoveryMaxSize = maxCsvSizeTiB(a.policy, a.backup)
  const hardMaxSize = hardMaxCsvSizeTiB(a.backup)
  const recoveryCountByCapacity = Math.ceil(a.capacityTiB / recoveryMaxSize)
  const hardCountByCapacity = Math.ceil(a.capacityTiB / hardMaxSize)
  const byBlast = Math.ceil(a.vmCount / a.policy.maxVmsPerCsv)
  const granularAdvisoryCount = Math.max(recoveryCountByCapacity, byBlast)
  const recoveryGroupingApplied = layoutMode === 'granular' || layoutMode === 's2d'
  const byCapacity = recoveryGroupingApplied ? recoveryCountByCapacity : hardCountByCapacity
  const maxSize = recoveryGroupingApplied ? recoveryMaxSize : hardMaxSize
  const rawCount = recoveryGroupingApplied ? granularAdvisoryCount : hardCountByCapacity
  const count = rawCount

  const driver: CsvPlan['driver'] = !recoveryGroupingApplied
    ? 'capacity'
    : byCapacity === byBlast
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
    granularAdvisoryCount,
    recoveryGroupingApplied,
    layoutMode,
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
  const sanLayoutMode = cfg.sanCsvLayoutMode ?? 'balanced'

  for (const id of TIER_IDS) {
    const t = demand.byTier[id]
    if (t.vms === 0) continue
    const capacityTiB = giBToTiB(t.storageGiB)
    const policy = tiers[id]

    if (cfg.architecture === 'san') {
      const p = planTierCsvs({
        tier: id, policy, capacityTiB, vmCount: t.plannedVms,
        nodes, backup: cfg.backupMethod, domain: 'san', layoutMode: sanLayoutMode,
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
          nodes, backup: cfg.backupMethod, domain: 'san', layoutMode: sanLayoutMode,
        })
        if (p) plans.push(p)
      }
    }
  }

  // Microsoft recommends at least one S2D volume per node. Apply the floor once across the
  // S2D domain, not independently to every workload tier. CSV ownership automatically
  // distributes across nodes; an exact node-count multiple is useful but not a published limit.
  const s2dPlans = plans.filter((plan) => plan.domain === 's2d')
  if (s2dPlans.length > 0 && nodes > 0) {
    const current = s2dPlans.reduce((sum, plan) => sum + plan.count, 0)
    distributeAdditionalVolumes(s2dPlans, Math.max(current, nodes), 'node-count')
  }

  // For a SAN-only cluster, balanced mode starts at one CSV/LUN per node. In hybrid mode,
  // the S2D domain already supplies the cluster-wide node ownership floor, so SAN starts at
  // its capacity/backup floor. Custom mode intentionally allows a lower-than-node target;
  // validation flags the operational tradeoff without overriding the user's choice.
  const sanPlans = plans.filter((plan) => plan.domain === 'san')
  if (sanPlans.length > 0) {
    const current = sanPlans.reduce((sum, plan) => sum + plan.count, 0)
    if (sanLayoutMode === 'balanced') {
      const nodeFloor = cfg.architecture === 'san' ? nodes : 0
      distributeAdditionalVolumes(sanPlans, Math.max(current, nodeFloor), 'operational-balance')
    } else if (sanLayoutMode === 'custom') {
      const requested = Math.max(1, Math.round(cfg.sanCustomCsvCount ?? nodes))
      distributeAdditionalVolumes(sanPlans, Math.max(current, requested), 'custom-target')
    }
  }
  return plans
}

function distributeAdditionalVolumes(
  plans: CsvPlan[],
  targetTotal: number,
  driver: 'node-count' | 'operational-balance' | 'custom-target',
): void {
  let current = plans.reduce((sum, plan) => sum + plan.count, 0)
  while (current < targetTotal) {
    // Add the next object to the tier with the largest current average object. Repeating this
    // produces a capacity-proportional layout while retaining distinct workload tiers.
    const target = [...plans].sort((a, b) => (b.totalTiB / b.count) - (a.totalTiB / a.count))[0]
    target.count += 1
    target.sizeTiB = Math.ceil((target.totalTiB / target.count) * 10) / 10
    target.vmsPerCsv = Math.ceil(target.plannedVms / target.count)
    target.driver = driver
    current += 1
  }
}

export function totalCsvCount(plans: CsvPlan[]): number {
  return plans.reduce((n, p) => n + p.count, 0)
}
