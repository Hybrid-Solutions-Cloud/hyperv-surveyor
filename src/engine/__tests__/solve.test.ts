import { describe, expect, it } from 'vitest'
import { compareArchitectures, forecastGrowth, solveForward, solveReverse } from '../solve'
import { computeDemand, licensableCores, usableRamPerHost } from '../compute'
import { LIMITS } from '../rules'
import { fleet400, makeConfig, makeTiers, vm } from './fixtures'

const tiers = makeTiers()

describe('compute demand', () => {
  it('applies per-tier oversubscription to vCPU', () => {
    const d = computeDemand([vm({ tier: 'general', vCpu: 8 })], tiers, 1)
    expect(d.requiredPCores).toBeCloseTo(8 / 4, 5) // general = 4:1
  })
  it('database tier does not oversubscribe at all [TOOL default 1:1]', () => {
    const d = computeDemand([vm({ tier: 'database', vCpu: 16 })], tiers, 1)
    expect(d.requiredPCores).toBeCloseTo(16, 5)
  })
  it('excludes VMs flagged include=false', () => {
    const d = computeDemand([vm({ include: false, vCpu: 64 }), vm({ vCpu: 4 })], tiers, 1)
    expect(d.vmCount).toBe(1)
  })
  it('growth factor scales cores, RAM and storage together', () => {
    const a = computeDemand([vm({ vCpu: 8, ramGiB: 32, storageGiB: 100 })], tiers, 1)
    const b = computeDemand([vm({ vCpu: 8, ramGiB: 32, storageGiB: 100 })], tiers, 1.25)
    expect(b.requiredPCores / a.requiredPCores).toBeCloseTo(1.25, 5)
    expect(b.requiredRamGiB / a.requiredRamGiB).toBeCloseTo(1.25, 5)
  })
  it('right-sizing factor below 1 reduces demand', () => {
    const t = makeTiers({ general: { rightSizingFactor: 0.6 } })
    const d = computeDemand([vm({ vCpu: 10, ramGiB: 100 })], t, 1)
    expect(d.requiredRamGiB).toBeCloseTo(60, 5)
  })
})

describe('[MS] host memory reserve includes S2D pool metadata', () => {
  it('deducts 4 GiB per TB of cache capacity per node', () => {
    const withCache = makeConfig({ architecture: 's2d', node: { cacheDrivesPerNode: 4, cacheDriveTB: 3.2 } })
    const noCache = makeConfig({ architecture: 's2d', node: { cacheDrivesPerNode: 0, cacheDriveTB: 0 } })
    const delta = usableRamPerHost(noCache.node, noCache) - usableRamPerHost(withCache.node, withCache)
    expect(delta).toBeCloseTo(4 * 3.2 * 4, 3) // 4 drives x 3.2 TB x 4 GiB
  })
  it('SAN-only designs carry no S2D metadata reserve', () => {
    const san = makeConfig({ architecture: 'san', node: { cacheDrivesPerNode: 4, cacheDriveTB: 3.2 } })
    const noCache = makeConfig({ architecture: 'san', node: { cacheDrivesPerNode: 0, cacheDriveTB: 0 } })
    expect(usableRamPerHost(san.node, san)).toBeCloseTo(usableRamPerHost(noCache.node, noCache), 5)
  })
})

describe('[MS] licensable cores', () => {
  it('floors at 16 per server even for an 8-core host', () => {
    expect(licensableCores({ ...makeConfig().node, sockets: 1, coresPerSocket: 8 })).toBe(16)
  })
  it('floors at 8 per socket', () => {
    expect(licensableCores({ ...makeConfig().node, sockets: 4, coresPerSocket: 4 })).toBe(32)
  })
  it('uses actual cores when above both floors', () => {
    expect(licensableCores({ ...makeConfig().node, sockets: 2, coresPerSocket: 32 })).toBe(64)
  })
})

describe('forward solve — binding constraint identification', () => {
  it('reports memory-bound when RAM is the scarce resource', () => {
    const cfg = makeConfig({ architecture: 'san', node: { ramGiB: 512, coresPerSocket: 64 } })
    const vms = Array.from({ length: 200 }, () => vm({ vCpu: 2, ramGiB: 64, storageGiB: 50 }))
    const r = solveForward(cfg, vms, tiers)
    expect(r.feasible).toBe(true)
    expect(r.binding).toBe('memory')
    expect(r.bindingExplanation).toContain('Memory-bound')
  })

  it('reports CPU-bound when cores are the scarce resource', () => {
    const cfg = makeConfig({ architecture: 'san', node: { ramGiB: 4096, sockets: 1, coresPerSocket: 8 } })
    const vms = Array.from({ length: 200 }, () => vm({ tier: 'database', vCpu: 8, ramGiB: 4, storageGiB: 10 }))
    const r = solveForward(cfg, vms, tiers)
    expect(r.binding).toBe('cpu')
  })

  it('reports storage-bound on S2D when capacity is the scarce resource', () => {
    const cfg = makeConfig({
      architecture: 's2d', resiliency: 'three-way-mirror',
      node: { ramGiB: 4096, coresPerSocket: 64, capacityDrivesPerNode: 4, capacityDriveTB: 7.68 },
    })
    const vms = Array.from({ length: 100 }, () => vm({ vCpu: 2, ramGiB: 8, storageGiB: 512 }))
    const r = solveForward(cfg, vms, tiers)
    expect(r.feasible).toBe(true)
    expect(r.binding).toBe('storage')
    expect(r.bindingExplanation).toContain('Storage-bound')
  })

  it('an infeasible design is reported as such rather than silently truncated', () => {
    const cfg = makeConfig({
      architecture: 's2d', resiliency: 'three-way-mirror',
      node: { ramGiB: 4096, coresPerSocket: 64, capacityDrivesPerNode: 4, capacityDriveTB: 1.92 },
    })
    const vms = Array.from({ length: 100 }, () => vm({ vCpu: 2, ramGiB: 8, storageGiB: 2048 }))
    const r = solveForward(cfg, vms, tiers)
    expect(r.feasible).toBe(false)
    expect(r.bindingExplanation).toContain('Not feasible')
    expect(r.bindingExplanation).toContain('16 nodes because S2D is enabled')
  })
})

describe('the central claim: SAN and S2D give different node counts for identical workloads', () => {
  const vms = fleet400()

  /**
   * The property that actually matters, tested directly: tripling the storage demand while
   * holding compute constant must move the S2D node count and must NOT move the SAN node
   * count. That is the whole reason the two architectures give different answers.
   */
  it('S2D node count responds to storage demand; SAN node count does not', () => {
    const base = makeConfig({
      node: { sockets: 2, coresPerSocket: 48, ramGiB: 2048, capacityDrivesPerNode: 8, capacityDriveTB: 7.68 },
      san: { usableTiB: 4000, drr: 2.5 },
    })
    const light = Array.from({ length: 300 }, () => vm({ vCpu: 4, ramGiB: 16, storageGiB: 300 }))
    const heavy = Array.from({ length: 300 }, () => vm({ vCpu: 4, ramGiB: 16, storageGiB: 900 }))

    const sanLight = solveForward({ ...base, architecture: 'san' }, light, tiers)
    const sanHeavy = solveForward({ ...base, architecture: 'san' }, heavy, tiers)
    expect(sanLight.feasible && sanHeavy.feasible).toBe(true)
    expect(sanHeavy.nodes).toBe(sanLight.nodes) // array capacity is independent of node count

    const cfgS2d = { ...base, architecture: 's2d' as const, resiliency: 'three-way-mirror' as const }
    const s2dLight = solveForward(cfgS2d, light, tiers)
    const s2dHeavy = solveForward(cfgS2d, heavy, tiers)
    expect(s2dLight.feasible && s2dHeavy.feasible).toBe(true)
    expect(s2dHeavy.nodes).toBeGreaterThan(s2dLight.nodes) // every node is also storage
    expect(s2dHeavy.binding).toBe('storage')
  })

  it('a more capacity-efficient resiliency needs fewer or equal nodes', () => {
    const base = makeConfig({ architecture: 's2d', node: { capacityDrivesPerNode: 6, capacityDriveTB: 3.84 } })
    const m3 = solveForward({ ...base, resiliency: 'three-way-mirror' }, vms, tiers)
    const dp = solveForward({ ...base, resiliency: 'dual-parity' }, vms, tiers)
    expect(dp.nodes).toBeLessThanOrEqual(m3.nodes)
  })

  it('compareArchitectures returns one result per architecture', () => {
    const opts = compareArchitectures(makeConfig(), vms, tiers)
    expect(opts).toHaveLength(5)
    expect(opts.map(o => o.key)).toContain('hybrid')
    for (const o of opts) expect(o.result.nodes).toBeGreaterThan(0)
  })
})

describe('[MS] node ceilings', () => {
  it('never returns more than 16 nodes for S2D', () => {
    const cfg = makeConfig({ architecture: 's2d', node: { ramGiB: 64, coresPerSocket: 4, sockets: 1 } })
    const vms = Array.from({ length: 4000 }, () => vm({ vCpu: 8, ramGiB: 64, storageGiB: 500 }))
    const r = solveForward(cfg, vms, tiers)
    expect(r.nodes).toBeLessThanOrEqual(LIMITS.S2D_MAX_NODES)
    expect(r.feasible).toBe(false)
    expect(r.bindingExplanation).toContain('Not feasible')
  })
  it('hybrid inherits the 16-node S2D ceiling — SAN does not lift it', () => {
    const cfg = makeConfig({ architecture: 'hybrid', node: { ramGiB: 64, coresPerSocket: 4, sockets: 1 } })
    const vms = Array.from({ length: 4000 }, () => vm({ vCpu: 8, ramGiB: 64, storageGiB: 500 }))
    expect(solveForward(cfg, vms, tiers).nodes).toBeLessThanOrEqual(LIMITS.S2D_MAX_NODES)
  })
  it('SAN can exceed 16 nodes because the S2D ceiling does not apply', () => {
    const cfg = makeConfig({
      architecture: 'san',
      node: { ramGiB: 512, sockets: 2, coresPerSocket: 16 },
      san: { usableTiB: 2000, drr: 2.5 },
    })
    const vms = Array.from({ length: 600 }, () => vm({ vCpu: 4, ramGiB: 32, storageGiB: 50 }))
    const r = solveForward(cfg, vms, tiers)
    expect(r.feasible).toBe(true)
    expect(r.nodes).toBeGreaterThan(LIMITS.S2D_MAX_NODES)
  })
})

describe('N+1 / N+2 resiliency arithmetic', () => {
  it('the surviving nodes must carry 100% of the workload', () => {
    const vms = Array.from({ length: 100 }, () => vm({ vCpu: 4, ramGiB: 16, storageGiB: 100 }))
    const n1 = solveForward(makeConfig({ architecture: 'san', spareNodes: 1 }), vms, tiers)
    const n2 = solveForward(makeConfig({ architecture: 'san', spareNodes: 2 }), vms, tiers)
    expect(n2.nodes).toBe(n1.nodes + 1)
    expect(n2.workloadNodes).toBe(n1.workloadNodes)
  })
  it('utilisation ceiling matches (N-spare)/N', () => {
    const vms = Array.from({ length: 100 }, () => vm())
    const r = solveForward(makeConfig({ architecture: 'san', spareNodes: 1 }), vms, tiers)
    expect(r.utilisationCeiling).toBeCloseTo((r.nodes - 1) / r.nodes, 5)
  })
})

describe('storage and hard-rule feasibility', () => {
  it('marks a SAN design infeasible when effective array capacity is too small', () => {
    const cfg = makeConfig({ architecture: 'san', san: { usableTiB: 1, drr: 1 } })
    const r = solveForward(cfg, [vm({ storageGiB: 4096 })], tiers)
    expect(r.feasible).toBe(false)
    expect(r.bindingExplanation).toContain('SAN capacity')
  })

  it('honours the selected S2D resiliency minimum node count', () => {
    const cfg = makeConfig({ architecture: 's2d', resiliency: 'three-way-mirror', spareNodes: 0 })
    const r = solveForward(cfg, [vm({ vCpu: 1, ramGiB: 1, storageGiB: 1 })], tiers)
    expect(r.nodes).toBeGreaterThanOrEqual(3)
    expect(r.feasible).toBe(true)
  })

  it('lets hard validation errors block feasibility', () => {
    const cfg = makeConfig({ architecture: 'san' })
    const r = solveForward(cfg, [vm({ vCpu: LIMITS.MAX_VCPU_PER_VM + 1 })], tiers)
    expect(r.feasible).toBe(false)
    expect(r.findings.some((finding) => finding.code === 'VM_VCPU_MAX')).toBe(true)
  })

  it('blocks a SAN design when measured IOPS exceeds entered sustainable capability', () => {
    const cfg = makeConfig({ architecture: 'san', san: { maxIops: 500, maxThroughputMBps: 10_000 } })
    const r = solveForward(cfg, [vm({ performance: { storageIopsP95: 1_000, storageThroughputMBpsP95: 100 } })], tiers)
    expect(r.feasible).toBe(false)
    expect(r.findings.some((finding) => finding.code === 'SAN_PERFORMANCE_EXCEEDED')).toBe(true)
    expect(r.bindingExplanation).toContain('SAN IOPS or throughput')
  })

  it('adds S2D nodes when measured storage performance is the binding constraint', () => {
    const cfg = makeConfig({
      architecture: 's2d',
      spareNodes: 0,
      resiliency: 'three-way-mirror',
      node: { s2dIopsPerNode: 1_000, s2dThroughputMBpsPerNode: 1_000 },
    })
    const r = solveForward(cfg, [vm({ performance: { storageIopsP95: 3_500, storageThroughputMBpsP95: 100 } })], tiers)
    expect(r.feasible).toBe(true)
    expect(r.nodes).toBe(4)
    expect(r.binding).toBe('storage')
    expect(r.bindingExplanation).toContain('Storage-bound (performance)')
  })

  it('keeps unknown storage performance as a warning instead of inventing a capability', () => {
    const r = solveForward(makeConfig({ architecture: 'san' }), [vm({ performance: { storageIopsP95: 1_000, storageThroughputMBpsP95: 100 } })], tiers)
    expect(r.feasible).toBe(true)
    expect(r.storagePerformance.validated).toBe(false)
    expect(r.findings.some((finding) => finding.code === 'STORAGE_PERFORMANCE_UNVALIDATED')).toBe(true)
  })
})

describe('capacity growth planning', () => {
  const workloads = Array.from({ length: 160 }, () => vm({ tier: 'database', vCpu: 8, ramGiB: 32, storageGiB: 200 }))

  it('keeps phased sizing at current demand and compounds the annual timeline', () => {
    const cfg = makeConfig({
      architecture: 'san',
      annualGrowthPct: 0.5,
      growthHorizonYears: 2,
      growthStrategy: 'phased',
    })
    const forecast = forecastGrowth(cfg, workloads, tiers)
    expect(forecast.points.map((point) => point.demandFactor)).toEqual([1, 1.5, 2.25])
    expect(solveForward(cfg, workloads, tiers).nodes).toBe(forecast.points[0].result.nodes)
    expect(forecast.points[2].result.nodes).toBeGreaterThan(forecast.points[0].result.nodes)
    expect(forecast.plannedNodesToday).toBe(forecast.points[0].result.nodes)
  })

  it('builds the terminal forecast into the current recommendation when selected', () => {
    const cfg = makeConfig({
      architecture: 'san',
      annualGrowthPct: 0.5,
      growthHorizonYears: 2,
      growthStrategy: 'build-now',
    })
    const forecast = forecastGrowth(cfg, workloads, tiers)
    const terminal = forecast.points[forecast.points.length - 1].result
    expect(solveForward(cfg, workloads, tiers).nodes).toBe(terminal.nodes)
    expect(forecast.plannedNodesToday).toBe(terminal.nodes)
  })

  it('holds fixed management VMs constant while the workload grows', () => {
    const cfg = makeConfig({ architecture: 'san', annualGrowthPct: 1, growthHorizonYears: 1 })
    const forecast = forecastGrowth(cfg, [vm({ vCpu: 4 })], tiers, [vm({ vCpu: 4, tier: 'infrastructure' })])
    expect(forecast.points[0].result.demand.totalVCpu).toBe(8)
    expect(forecast.points[1].result.demand.totalVCpu).toBe(12)
  })

  it('grows measured storage performance demand with the workload forecast', () => {
    const cfg = makeConfig({
      architecture: 'san',
      annualGrowthPct: 1,
      growthHorizonYears: 1,
      san: { maxIops: 1_500, maxThroughputMBps: 1_500 },
    })
    const forecast = forecastGrowth(cfg, [vm({ performance: { storageIopsP95: 1_000, storageThroughputMBpsP95: 100 } })], tiers)
    expect(forecast.points[0].result.storagePerformance.requiredSanIops).toBe(1_000)
    expect(forecast.points[1].result.storagePerformance.requiredSanIops).toBe(2_000)
    expect(forecast.points[1].result.feasible).toBe(false)
  })
})

describe('reverse solve', () => {
  it('names the constraint that binds first', () => {
    const cfg = makeConfig({ architecture: 'san', node: { ramGiB: 256 } })
    const vms = Array.from({ length: 50 }, () => vm({ vCpu: 2, ramGiB: 48, storageGiB: 20 }))
    const r = solveReverse(cfg, 8, vms, tiers)
    expect(['cpu', 'memory', 'storage']).toContain(r.binding)
    expect(r.bindingExplanation).toMatch(/binds first/)
  })
  it('reports how many more VMs of each tier fit', () => {
    const cfg = makeConfig({ architecture: 'san' })
    const vms = Array.from({ length: 10 }, () => vm({ vCpu: 4, ramGiB: 16, storageGiB: 100 }))
    const r = solveReverse(cfg, 8, vms, tiers)
    expect(r.additionalVmsByTier.general).toBeGreaterThan(0)
  })
  it('flags an over-committed cluster rather than reporting negative headroom as fine', () => {
    const cfg = makeConfig({ architecture: 'san', node: { ramGiB: 64, sockets: 1, coresPerSocket: 8 } })
    const vms = Array.from({ length: 500 }, () => vm({ vCpu: 8, ramGiB: 64, storageGiB: 500 }))
    const r = solveReverse(cfg, 4, vms, tiers)
    expect(r.bindingExplanation).toContain('cannot carry')
  })
  it('forward and reverse agree: the solved node count leaves non-negative headroom', () => {
    const cfg = makeConfig({ architecture: 'san' })
    const vms = fleet400()
    const fwd = solveForward(cfg, vms, tiers)
    const rev = solveReverse(cfg, fwd.nodes, vms, tiers)
    expect(rev.headroomPCores).toBeGreaterThanOrEqual(0)
    expect(rev.headroomRamGiB).toBeGreaterThanOrEqual(0)
  })
})

describe('CSV plan is produced with every result', () => {
  it('produces plans covering every populated tier', () => {
    const r = solveForward(makeConfig({ architecture: 'san' }), fleet400(), tiers)
    const covered = new Set(r.csvPlans.map(p => p.tier))
    expect(covered.has('general')).toBe(true)
    expect(covered.has('database')).toBe(true)
    expect(r.totalCsvs).toBeGreaterThan(0)
  })
  it('hybrid produces plans in both storage domains', () => {
    const r = solveForward(makeConfig({ architecture: 'hybrid', hybridS2dShare: 0.4 }), fleet400(), tiers)
    const domains = new Set(r.csvPlans.map(p => p.domain))
    expect(domains.has('s2d')).toBe(true)
    expect(domains.has('san')).toBe(true)
  })
})
