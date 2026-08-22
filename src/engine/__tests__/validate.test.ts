import { describe, expect, it } from 'vitest'
import { validateDesign } from '../validate'
import { planCsvs } from '../csv'
import { computeDemand } from '../compute'
import { makeConfig, makeTiers, vm } from './fixtures'

const tiers = makeTiers()
const plansFor = (cfg: any, vms: any[], nodes: number) =>
  planCsvs(cfg, computeDemand(vms, tiers, 1), tiers, nodes)

const codes = (f: ReturnType<typeof validateDesign>) => f.map(x => x.code)
const bySeverity = (f: ReturnType<typeof validateDesign>, s: string) =>
  f.filter(x => x.severity === s).map(x => x.code)

describe('[MS] node ceilings', () => {
  it('errors when S2D exceeds 16 nodes', () => {
    const cfg = makeConfig({ architecture: 's2d' })
    const f = validateDesign(cfg, 20, [vm()], tiers, plansFor(cfg, [vm()], 20))
    expect(bySeverity(f, 'error')).toContain('S2D_MAX_NODES')
  })
  it('does not apply the S2D ceiling to a SAN cluster', () => {
    const cfg = makeConfig({ architecture: 'san', witnessType: 'none' })
    const f = validateDesign(cfg, 24, [vm()], tiers, plansFor(cfg, [vm()], 24))
    expect(codes(f)).not.toContain('S2D_MAX_NODES')
  })
})

describe('[MS] quorum and witness', () => {
  it('errors on a 2-node cluster with no witness', () => {
    const cfg = makeConfig({ architecture: 's2d', resiliency: 'nested-two-way-mirror', witnessType: 'none' })
    const f = validateDesign(cfg, 2, [vm()], tiers, plansFor(cfg, [vm()], 2))
    expect(bySeverity(f, 'error')).toContain('WITNESS_REQUIRED')
  })
  it('warns at 3 and 4 nodes', () => {
    const cfg = makeConfig({ architecture: 'san', witnessType: 'none' })
    for (const n of [3, 4]) {
      const f = validateDesign(cfg, n, [vm()], tiers, plansFor(cfg, [vm()], n))
      expect(bySeverity(f, 'warning')).toContain('WITNESS_RECOMMENDED')
    }
  })
  it('says a witness adds nothing at 5+ nodes', () => {
    const cfg = makeConfig({ architecture: 'san' })
    const f = validateDesign(cfg, 8, [vm()], tiers, plansFor(cfg, [vm()], 8))
    expect(codes(f)).toContain('WITNESS_UNNEEDED')
  })
})

describe('[MS] drive rules', () => {
  it('errors below 4 capacity drives per node', () => {
    const cfg = makeConfig({ architecture: 's2d', node: { capacityDrivesPerNode: 2 } })
    const f = validateDesign(cfg, 8, [vm()], tiers, plansFor(cfg, [vm()], 8))
    expect(bySeverity(f, 'error')).toContain('MIN_CAPACITY_DRIVES')
  })
  it('errors on a hybrid-media config with no cache tier (HDD-only is unsupported)', () => {
    const cfg = makeConfig({ architecture: 's2d', node: { media: 'hybrid', cacheDrivesPerNode: 0 } })
    const f = validateDesign(cfg, 8, [vm()], tiers, plansFor(cfg, [vm()], 8))
    expect(bySeverity(f, 'error')).toContain('HDD_NEEDS_CACHE')
  })
  it('warns when the cache ratio is under the recommendation', () => {
    const cfg = makeConfig({
      architecture: 's2d',
      node: { media: 'all-flash', cacheDrivesPerNode: 2, cacheDriveTB: 0.4, capacityDrivesPerNode: 8, capacityDriveTB: 7.68 },
    })
    const f = validateDesign(cfg, 8, [vm()], tiers, plansFor(cfg, [vm()], 8))
    expect(bySeverity(f, 'warning')).toContain('CACHE_RATIO')
  })
  it('does not apply drive rules to a SAN-only design', () => {
    const cfg = makeConfig({ architecture: 'san', node: { capacityDrivesPerNode: 0 } })
    const f = validateDesign(cfg, 8, [vm()], tiers, plansFor(cfg, [vm()], 8))
    expect(codes(f)).not.toContain('MIN_CAPACITY_DRIVES')
  })
})

describe('[MS] resiliency minimum node counts', () => {
  it('errors on three-way mirror below 3 nodes', () => {
    const cfg = makeConfig({ architecture: 's2d', resiliency: 'three-way-mirror', witnessType: 'none' })
    const f = validateDesign(cfg, 2, [vm()], tiers, plansFor(cfg, [vm()], 2))
    expect(bySeverity(f, 'error')).toContain('RESILIENCY_MIN_NODES')
  })
  it('errors on dual parity below 4 nodes', () => {
    const cfg = makeConfig({ architecture: 's2d', resiliency: 'dual-parity' })
    const f = validateDesign(cfg, 3, [vm()], tiers, plansFor(cfg, [vm()], 3))
    expect(bySeverity(f, 'error')).toContain('RESILIENCY_MIN_NODES')
  })
  it('errors when nested resiliency is used above 2 nodes', () => {
    const cfg = makeConfig({ architecture: 's2d', resiliency: 'nested-two-way-mirror' })
    const f = validateDesign(cfg, 6, [vm()], tiers, plansFor(cfg, [vm()], 6))
    expect(bySeverity(f, 'error')).toContain('RESILIENCY_MAX_NODES')
  })
})

describe('[MS] WS2025 NUMA behaviour change', () => {
  it('warns for VMs with more vCPUs than one NUMA node has cores', () => {
    const cfg = makeConfig({ architecture: 'san', node: { coresPerSocket: 16 } })
    const vms = [vm({ vCpu: 32 })]
    const f = validateDesign(cfg, 8, vms, tiers, plansFor(cfg, vms, 8))
    expect(bySeverity(f, 'warning')).toContain('NUMA_SPANNING')
  })
  it('stays quiet when every VM fits inside a NUMA node', () => {
    const cfg = makeConfig({ architecture: 'san', node: { coresPerSocket: 32 } })
    const vms = [vm({ vCpu: 8 })]
    const f = validateDesign(cfg, 8, vms, tiers, plansFor(cfg, vms, 8))
    expect(codes(f)).not.toContain('NUMA_SPANNING')
  })
})

describe('hybrid guardrails', () => {
  const cfg = makeConfig({ architecture: 'hybrid' })
  const f = validateDesign(cfg, 8, [vm()], tiers, plansFor(cfg, [vm()], 8))
  it('states that the architecture is supported', () => {
    expect(codes(f)).toContain('HYBRID_SUPPORTED')
  })
  it('warns that SAN LUNs must never enter the S2D pool', () => {
    expect(bySeverity(f, 'warning')).toContain('HYBRID_POOL_ISOLATION')
  })
  it('warns that SAN CSVs must be NTFS', () => {
    expect(bySeverity(f, 'warning')).toContain('HYBRID_FILESYSTEM')
  })
  it('reminds that the 16-node ceiling still applies', () => {
    expect(codes(f)).toContain('HYBRID_NODE_CEILING')
  })
})

describe('licensing warnings', () => {
  it('warns when hosts are under the 16-core licensing floor', () => {
    const cfg = makeConfig({ architecture: 'san', node: { sockets: 1, coresPerSocket: 8 } })
    const f = validateDesign(cfg, 8, [vm()], tiers, plansFor(cfg, [vm()], 8))
    expect(bySeverity(f, 'warning')).toContain('LICENSE_FLOOR')
  })
  it('stays quiet on a 64-core host', () => {
    const cfg = makeConfig({ architecture: 'san', node: { sockets: 2, coresPerSocket: 32 } })
    const f = validateDesign(cfg, 8, [vm()], tiers, plansFor(cfg, [vm()], 8))
    expect(codes(f)).not.toContain('LICENSE_FLOOR')
  })
})

describe('every finding carries a basis tag', () => {
  it('MS, MS-REC or TOOL on all findings', () => {
    const cfg = makeConfig({ architecture: 'hybrid' })
    const f = validateDesign(cfg, 8, [vm({ vCpu: 64 })], tiers, plansFor(cfg, [vm()], 8))
    for (const x of f) expect(['MS', 'MS-REC', 'TOOL']).toContain(x.basis)
  })
})
