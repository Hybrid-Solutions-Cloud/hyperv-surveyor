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
 *   count = MAX(ceil(capacity/max_size), ceil(vms/max_vms_per_csv), node_count)
 *   count = round_up_to_multiple_of(count, node_count)   [MS-REC]
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
  const byNodes = a.nodes

  const rawCount = Math.max(byCapacity, byBlast, byNodes)
  const count = roundUpToMultiple(rawCount, a.nodes)

  let driver: CsvPlan['driver'] = 'node-count'
  if (byCapacity >= byBlast && byCapacity >= byNodes) driver = 'capacity'
  else if (byBlast >= byCapacity && byBlast >= byNodes) driver = 'blast-radius'

  return {
    tier: a.tier,
    storageTier: a.policy.storageTier,
    domain: a.domain,
    count,
    sizeTiB: Math.ceil((a.capacityTiB / count) * 10) / 10,
    totalTiB: a.capacityTiB,
    vmsPerCsv: Math.ceil(a.vmCount / count),
    driver,
    roundedUpFrom: rawCount,
    // [MS] In a hybrid cluster SAN CSVs must be NTFS - ReFS is not supported on SAN-backed
    // volumes. S2D volumes are ReFS (required for mirror-accelerated parity).
    filesystem: a.domain === 's2d' ? 'ReFS' : 'NTFS',
  }
}

/**
 * Build the full CSV plan across every tier and storage domain.
 * In hybrid mode each tier's capacity is split by hybridS2dShare and planned independently
 * in each domain, because the two domains have genuinely different layout drivers.
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
        tier: id, policy, capacityTiB, vmCount: t.vms,
        nodes, backup: cfg.backupMethod, domain: 'san',
      })
      if (p) plans.push(p)
    } else if (cfg.architecture === 's2d') {
      const p = planTierCsvs({
        tier: id, policy, capacityTiB, vmCount: t.vms,
        nodes, backup: cfg.backupMethod, domain: 's2d',
      })
      if (p) plans.push(p)
    } else {
      // Hybrid: performance tiers land on S2D (local NVMe), capacity tiers on SAN, unless
      // the share slider says otherwise. Split both capacity and VM count proportionally.
      const s2dShare = cfg.hybridS2dShare
      const sanShare = 1 - s2dShare
      if (s2dShare > 0.01) {
        const p = planTierCsvs({
          tier: id, policy,
          capacityTiB: capacityTiB * s2dShare,
          vmCount: Math.max(1, Math.round(t.vms * s2dShare)),
          nodes, backup: cfg.backupMethod, domain: 's2d',
        })
        if (p) plans.push(p)
      }
      if (sanShare > 0.01) {
        const p = planTierCsvs({
          tier: id, policy,
          capacityTiB: capacityTiB * sanShare,
          vmCount: Math.max(1, Math.round(t.vms * sanShare)),
          nodes, backup: cfg.backupMethod, domain: 'san',
        })
        if (p) plans.push(p)
      }
    }
  }
  return plans
}

export function totalCsvCount(plans: CsvPlan[]): number {
  return plans.reduce((n, p) => n + p.count, 0)
}
