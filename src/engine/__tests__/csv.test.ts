import { describe, expect, it } from 'vitest'
import { maxCsvSizeTiB, planCsvs, planTierCsvs, roundUpToMultiple } from '../csv'
import { DEFAULT_TIERS, LIMITS } from '../rules'
import { makeConfig } from './fixtures'

const general = DEFAULT_TIERS.general
const database = DEFAULT_TIERS.database

describe('roundUpToMultiple', () => {
  it('rounds 15 up to 16 for an 8-node cluster', () => {
    expect(roundUpToMultiple(15, 8)).toBe(16)
  })
  it('leaves exact multiples alone', () => {
    expect(roundUpToMultiple(24, 12)).toBe(24)
  })
})

describe('[MS] maximum recovery-unit size caps', () => {
  it('honours the 64 TiB recommendation as the outer bound', () => {
    const t = { ...general, blastRadiusTiB: 999 }
    expect(maxCsvSizeTiB(t, 'rct')).toBe(LIMITS.MAX_CSV_SIZE_TIB)
  })
  it('drops to 10 TiB when backup is VSS/volsnap', () => {
    const t = { ...general, blastRadiusTiB: 999 }
    expect(maxCsvSizeTiB(t, 'vss-volsnap')).toBe(LIMITS.VSS_CSV_LIMIT_TIB)
  })
  it('the editable recovery-unit size can bind tighter than either Microsoft cap', () => {
    const t = { ...general, blastRadiusTiB: 4 }
    expect(maxCsvSizeTiB(t, 'rct')).toBe(4)
  })
})

describe('CSV planning — the controlling rules', () => {
  it('capacity-bound when the tier is large and VMs are few', () => {
    const p = planTierCsvs({
      tier: 'general', policy: { ...general, blastRadiusTiB: 32, maxVmsPerCsv: 1000 },
      capacityTiB: 480, vmCount: 20, nodes: 8, backup: 'rct', domain: 'san',
    })!
    expect(p.driver).toBe('capacity')
  })

  it('VM-recovery-grouping-bound when VMs are many and capacity is small', () => {
    const p = planTierCsvs({
      tier: 'database', policy: database,
      capacityTiB: 8, vmCount: 40, nodes: 8, backup: 'rct', domain: 'san',
    })!
    expect(p.countByCapacity).toBe(1)
    expect(p.countByVmLimit).toBe(8)
    expect(p.count).toBe(8)
    expect(p.driver).toBe('vm-count')
  })

  it('does not multiply the cluster-wide node-count target into every tier', () => {
    const p = planTierCsvs({
      tier: 'general', policy: general,
      capacityTiB: 4, vmCount: 4, nodes: 12, backup: 'rct', domain: 's2d',
    })!
    expect(p.count).toBe(1)
  })

  it('keeps a tier plan at the larger size or VM-grouping requirement', () => {
    const p = planTierCsvs({
      tier: 'general', policy: { ...general, blastRadiusTiB: 32, maxVmsPerCsv: 25 },
      capacityTiB: 480, vmCount: 320, nodes: 12, backup: 'rct', domain: 's2d',
    })!
    expect(p.count).toBe(p.roundedUpFrom)
  })

  it('[MS-REC] applies node-count ownership once across all S2D tiers', () => {
    const demand = {
      requiredPCores: 1, requiredRamGiB: 1, totalVCpu: 1, vmCount: 2,
      byTier: {
        general: { pCores: 1, ramGiB: 1, vms: 1, plannedVms: 1, storageGiB: 100 },
        database: { pCores: 1, ramGiB: 1, vms: 1, plannedVms: 1, storageGiB: 100 },
        vdi: { pCores: 0, ramGiB: 0, vms: 0, plannedVms: 0, storageGiB: 0 },
        infrastructure: { pCores: 0, ramGiB: 0, vms: 0, plannedVms: 0, storageGiB: 0 },
      },
    }
    const plans = planCsvs(makeConfig({ architecture: 's2d' }), demand, DEFAULT_TIERS, 8)
    const total = plans.reduce((sum, plan) => sum + plan.count, 0)
    expect(total).toBe(8)
    expect(total % 8).toBe(0)
  })

  it('[MS] S2D volumes are ReFS, SAN volumes are NTFS', () => {
    const args = { tier: 'general' as const, policy: general, capacityTiB: 100, vmCount: 50, nodes: 8, backup: 'rct' as const }
    expect(planTierCsvs({ ...args, domain: 's2d' })!.filesystem).toBe('ReFS')
    expect(planTierCsvs({ ...args, domain: 'san' })!.filesystem).toBe('NTFS')
  })

  it('returns null for an empty tier rather than a zero-count plan', () => {
    expect(planTierCsvs({
      tier: 'vdi', policy: general, capacityTiB: 0, vmCount: 0,
      nodes: 8, backup: 'rct', domain: 's2d',
    })).toBeNull()
  })

  it('VSS backup forces many more, smaller CSVs than RCT', () => {
    const args = { tier: 'general' as const, policy: { ...general, blastRadiusTiB: 64 }, capacityTiB: 200, vmCount: 100, nodes: 8, domain: 'san' as const }
    const rct = planTierCsvs({ ...args, backup: 'rct' })!
    const vss = planTierCsvs({ ...args, backup: 'vss-volsnap' })!
    expect(vss.count).toBeGreaterThan(rct.count)
    expect(vss.sizeTiB).toBeLessThan(rct.sizeTiB)
  })
})

describe('worked example from the spec — 400 VMs, 8-node SAN', () => {
  it('shows both calculations and selects the larger one', () => {
    const p = planTierCsvs({
      tier: 'database', policy: database,
      capacityTiB: 120, vmCount: 40, nodes: 8, backup: 'rct', domain: 'san',
    })!
    const byCapacity = Math.ceil(120 / Math.min(64, database.blastRadiusTiB))
    const byBlast = Math.ceil(40 / database.maxVmsPerCsv)
    expect(p.countByCapacity).toBe(byCapacity)
    expect(p.countByVmLimit).toBe(byBlast)
    expect(p.driver).toBe('capacity')
    expect(byBlast).toBe(8)
    expect(p.count).toBe(byCapacity)
    expect(p.vmsPerCsv).toBeLessThanOrEqual(database.maxVmsPerCsv)
  })
})
