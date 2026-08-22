import { describe, expect, it } from 'vitest'
import { assessFitGap } from '../fitGap'
import { makeConfig, makeTiers, vm } from './fixtures'

const tiers = makeTiers()

describe('fit and gap assessment', () => {
  it('does not invent a fit decision without a workload inventory', () => {
    const result = assessFitGap(makeConfig({ architecture: 'san' }), 4, [], tiers)
    expect(result.fits).toBeNull()
    expect(result.additionalNodes).toBeNull()
  })

  it('reports a fitting workload on the existing node count', () => {
    const result = assessFitGap(makeConfig({ architecture: 'san' }), 8, [vm({ vCpu: 2, ramGiB: 8, storageGiB: 20 })], tiers)
    expect(result.fits).toBe(true)
    expect(result.additionalNodes).toBe(0)
  })

  it('calculates same-spec node expansion for a compute deficit', () => {
    const cfg = makeConfig({ architecture: 'san', spareNodes: 1, node: { sockets: 1, coresPerSocket: 8, ramGiB: 4096 }, san: { usableTiB: 1000, drr: 1 } })
    const workloads = Array.from({ length: 40 }, () => vm({ tier: 'database', vCpu: 8, ramGiB: 4, storageGiB: 10 }))
    const result = assessFitGap(cfg, 4, workloads, tiers)
    expect(result.fits).toBe(false)
    expect(result.requiredNodesAtSameSpec).toBeGreaterThan(4)
    expect(result.additionalNodes).toBe((result.requiredNodesAtSameSpec ?? 4) - 4)
    expect(result.deficits.physicalCores).toBeGreaterThan(0)
  })

  it('does not claim host expansion can repair insufficient SAN capacity', () => {
    const cfg = makeConfig({ architecture: 'san', san: { usableTiB: 1, drr: 1 } })
    const result = assessFitGap(cfg, 8, [vm({ storageGiB: 4096 })], tiers)
    expect(result.fits).toBe(false)
    expect(result.requiredNodesAtSameSpec).toBeNull()
    expect(result.deficits.sanTiB).toBeGreaterThan(0)
    expect(result.recommendations.some((item) => item.includes('Adding compute nodes alone'))).toBe(true)
  })
})
