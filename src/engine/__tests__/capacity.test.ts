import { describe, expect, it } from 'vitest'
import { reserveTiB, s2dCapacity, sanCapacityTiB } from '../capacity'
import { dualParityEfficiency, nestedMapEfficiency, RESILIENCY } from '../rules'
import { makeConfig } from './fixtures'

describe('[MS] dual-parity efficiency by node count — fault-tolerance tables', () => {
  it('hybrid: 4-6 nodes = 50% (RS 2+2)', () => {
    for (const n of [4, 5, 6]) expect(dualParityEfficiency(n, 'hybrid').eff).toBeCloseTo(0.5, 5)
  })
  it('hybrid: 7-11 nodes = 66.7% (RS 4+2)', () => {
    for (const n of [7, 8, 9, 10, 11]) expect(dualParityEfficiency(n, 'hybrid').eff).toBeCloseTo(2 / 3, 3)
  })
  it('hybrid: 12-16 nodes = 72.7% (LRC 8,2,1)', () => {
    for (const n of [12, 14, 16]) expect(dualParityEfficiency(n, 'hybrid').eff).toBeCloseTo(0.727, 3)
  })
  it('all-flash: 9-15 nodes reaches 75% (RS 6+2) where hybrid stays at 66.7%', () => {
    expect(dualParityEfficiency(9, 'all-flash').eff).toBeCloseTo(0.75, 3)
    expect(dualParityEfficiency(9, 'hybrid').eff).toBeCloseTo(2 / 3, 3)
  })
  it('all-flash: 16 nodes = 80% (LRC 12,2,1)', () => {
    expect(dualParityEfficiency(16, 'all-flash').eff).toBeCloseTo(0.8, 5)
  })
  it('media divergence above 8 nodes is real — a single table would be wrong', () => {
    expect(dualParityEfficiency(12, 'all-flash').eff).not.toBeCloseTo(
      dualParityEfficiency(12, 'hybrid').eff, 3)
  })
})

describe('[MS] fixed resiliency efficiencies', () => {
  it('two-way mirror 50%, three-way 33.3%, nested two-way 25%', () => {
    expect(RESILIENCY['two-way-mirror'].fixedEfficiency).toBeCloseTo(0.5, 5)
    expect(RESILIENCY['three-way-mirror'].fixedEfficiency).toBeCloseTo(1 / 3, 5)
    expect(RESILIENCY['nested-two-way-mirror'].fixedEfficiency).toBeCloseTo(0.25, 5)
  })
  it('[MS] nested MAP: 4 drives/10% mirror = 35.7%, 7+ drives/10% = 40.0%', () => {
    expect(nestedMapEfficiency(4, 0.1)).toBeCloseTo(0.357, 3)
    expect(nestedMapEfficiency(7, 0.1)).toBeCloseTo(0.4, 3)
    expect(nestedMapEfficiency(12, 0.1)).toBeCloseTo(0.4, 3) // clamps at the 7+ row
  })
  it('[MS] nested MAP efficiency falls as the mirror share rises', () => {
    expect(nestedMapEfficiency(6, 0.3)).toBeLessThan(nestedMapEfficiency(6, 0.1))
  })
})

describe('[MS-REC] reserve capacity — 1 drive per server, capped at 4 drives total', () => {
  const cfg = makeConfig({ node: { capacityDriveTB: 4 } })
  it('scales with node count below the cap', () => {
    const r2 = reserveTiB(cfg.node, 2)
    const r3 = reserveTiB(cfg.node, 3)
    expect(r3).toBeGreaterThan(r2)
  })
  it('stops growing at 4 nodes and never exceeds 4 drives', () => {
    const r4 = reserveTiB(cfg.node, 4)
    expect(reserveTiB(cfg.node, 8)).toBeCloseTo(r4, 5)
    expect(reserveTiB(cfg.node, 16)).toBeCloseTo(r4, 5)
  })
})

describe('S2D usable capacity chain', () => {
  it('excludes cache drives from raw capacity entirely [MS]', () => {
    const withCache = makeConfig({ node: { cacheDrivesPerNode: 4, cacheDriveTB: 3.2 } })
    const noCache = makeConfig({ node: { cacheDrivesPerNode: 0, cacheDriveTB: 0 } })
    expect(s2dCapacity(withCache, 8).rawTiB).toBeCloseTo(s2dCapacity(noCache, 8).rawTiB, 5)
  })
  it('applies reserve before efficiency, not after', () => {
    const cfg = makeConfig({ resiliency: 'three-way-mirror' })
    const c = s2dCapacity(cfg, 8)
    expect(c.usableTiB).toBeCloseTo((c.rawTiB - c.reserveTiB) * (1 / 3), 3)
  })
  it('three-way mirror yields roughly a third of available capacity', () => {
    const c = s2dCapacity(makeConfig({ resiliency: 'three-way-mirror' }), 8)
    expect(c.usableTiB / c.availableTiB).toBeCloseTo(1 / 3, 3)
  })
  it('usable capacity grows with node count', () => {
    const cfg = makeConfig({ resiliency: 'three-way-mirror' })
    expect(s2dCapacity(cfg, 12).usableTiB).toBeGreaterThan(s2dCapacity(cfg, 6).usableTiB)
  })
  it('dual parity beats three-way mirror on capacity at the same node count', () => {
    const dp = s2dCapacity(makeConfig({ resiliency: 'dual-parity' }), 8)
    const m3 = s2dCapacity(makeConfig({ resiliency: 'three-way-mirror' }), 8)
    expect(dp.usableTiB).toBeGreaterThan(m3.usableTiB)
  })
})

describe('SAN capacity — the DRR trap', () => {
  it('multiplies usable by DRR', () => {
    expect(sanCapacityTiB({ usableTiB: 100, drr: 2.5, thinProvisioningSavings: 0 })).toBeCloseTo(250, 5)
  })
  it('never applies a DRR below 1 — that would shrink capacity', () => {
    expect(sanCapacityTiB({ usableTiB: 100, drr: 0.5, thinProvisioningSavings: 0 })).toBeCloseTo(100, 5)
  })
  it('thin-provisioning savings are NOT folded into the reduction multiplier', () => {
    const a = sanCapacityTiB({ usableTiB: 100, drr: 2.5, thinProvisioningSavings: 0 })
    const b = sanCapacityTiB({ usableTiB: 100, drr: 2.5, thinProvisioningSavings: 0.4 })
    expect(a).toBeCloseTo(b, 5)
  })
})
