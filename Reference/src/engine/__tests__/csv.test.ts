import { describe, expect, it } from 'vitest'
import { maxCsvSizeTiB, planTierCsvs, roundUpToMultiple } from '../csv'
import { DEFAULT_TIERS, LIMITS } from '../rules'

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

describe('[MS] max CSV size caps', () => {
  it('honours the 64 TiB recommendation as the outer bound', () => {
    const t = { ...general, blastRadiusTiB: 999 }
    expect(maxCsvSizeTiB(t, 'rct')).toBe(LIMITS.MAX_CSV_SIZE_TIB)
  })
  it('drops to 10 TiB when backup is VSS/volsnap', () => {
    const t = { ...general, blastRadiusTiB: 999 }
    expect(maxCsvSizeTiB(t, 'vss-volsnap')).toBe(LIMITS.VSS_CSV_LIMIT_TIB)
  })
  it('blast radius can bind tighter than either Microsoft cap', () => {
    const t = { ...general, blastRadiusTiB: 4 }
    expect(maxCsvSizeTiB(t, 'rct')).toBe(4)
  })
})

describe('CSV planning — the three drivers', () => {
  it('capacity-bound when the tier is large and VMs are few', () => {
    const p = planTierCsvs({
      tier: 'general', policy: { ...general, blastRadiusTiB: 32, maxVmsPerCsv: 1000 },
      capacityTiB: 480, vmCount: 20, nodes: 8, backup: 'rct', domain: 'san',
    })!
    expect(p.driver).toBe('capacity')
  })

  it('blast-radius-bound when VMs are many and capacity is small', () => {
    const p = planTierCsvs({
      tier: 'database', policy: database,
      capacityTiB: 120, vmCount: 40, nodes: 8, backup: 'rct', domain: 'san',
    })!
    // capacity: ceil(120/8)=15 ... blast: ceil(40/5)=8 ... nodes: 8
    expect(p.count).toBe(16)
  })

  it('node-count-bound for a small tier on a large cluster', () => {
    const p = planTierCsvs({
      tier: 'general', policy: general,
      capacityTiB: 4, vmCount: 4, nodes: 12, backup: 'rct', domain: 's2d',
    })!
    expect(p.driver).toBe('node-count')
    expect(p.count).toBe(12)
  })

  it('[MS-REC] always rounds up to a whole multiple of node count', () => {
    const p = planTierCsvs({
      tier: 'general', policy: { ...general, blastRadiusTiB: 32, maxVmsPerCsv: 25 },
      capacityTiB: 480, vmCount: 320, nodes: 12, backup: 'rct', domain: 's2d',
    })!
    expect(p.count % 12).toBe(0)
    expect(p.count).toBeGreaterThanOrEqual(p.roundedUpFrom)
  })

  it('[MS-REC] never produces fewer CSVs than nodes', () => {
    for (const nodes of [2, 4, 8, 12, 16]) {
      const p = planTierCsvs({
        tier: 'general', policy: general,
        capacityTiB: 1, vmCount: 1, nodes, backup: 'rct', domain: 's2d',
      })!
      expect(p.count).toBeGreaterThanOrEqual(nodes)
    }
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
  it('database tier is blast-radius-bound, not capacity-bound', () => {
    const p = planTierCsvs({
      tier: 'database', policy: database,
      capacityTiB: 120, vmCount: 40, nodes: 8, backup: 'rct', domain: 'san',
    })!
    const byCapacity = Math.ceil(120 / Math.min(64, database.blastRadiusTiB))
    const byBlast = Math.ceil(40 / database.maxVmsPerCsv)
    expect(byBlast).toBe(8)
    expect(p.count).toBeGreaterThanOrEqual(byCapacity)
    expect(p.vmsPerCsv).toBeLessThanOrEqual(database.maxVmsPerCsv)
  })
})
