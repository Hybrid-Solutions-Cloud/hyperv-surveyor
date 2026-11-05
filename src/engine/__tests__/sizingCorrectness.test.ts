import { describe, expect, it } from 'vitest'
import { compareArchitectures, forecastGrowth, solveForward, solveReverse } from '../solve'
import { assessFitGap, fitGapAdditionalLabel, fitGapRequiredLabel } from '../fitGap'
import { computeDemand } from '../compute'
import { planMultipleClusters } from '../deploymentPlanning'
import { planCsvs } from '../csv'
import { validateDesign } from '../validate'
import { assessPerformanceData } from '../performance'
import { managementVmsForSizing } from '../managementDeployment'
import { LIMITS } from '../rules'
import { makeConfig, makeTiers, vm } from './fixtures'
import type { ClusterConfig, Finding, Vm } from '../types'

const tiers = makeTiers()
const has = (findings: Finding[], code: string) => findings.some((finding) => finding.code === code)
const findingOf = (findings: Finding[], code: string) => findings.find((finding) => finding.code === code)
const many = (count: number, patch: Partial<Vm>) => Array.from({ length: count }, () => vm(patch))
const san = (patch: Partial<ClusterConfig> = {}) => makeConfig({ architecture: 'san', san: { usableTiB: 1000, drr: 1 }, ...patch } as never)
const fixed = (patch: Partial<Vm> = {}) => vm({ tier: 'infrastructure', vCpu: 8, ramGiB: 32, storageGiB: 100, provisionedGiB: 100, ...patch })

describe('A1: a VM must fit on one host', () => {
  const largeVm = vm({ name: 'HUGE-1', vCpu: 256, ramGiB: 4096, storageGiB: 100 })
  const small = { sockets: 2, coresPerSocket: 16, ramGiB: 512 }

  it('blocks forward sizing even when the aggregate would fit', () => {
    const r = solveForward(san({ node: small } as never), [largeVm], tiers)
    expect(r.feasible).toBe(false)
    const finding = findingOf(r.findings, 'VM_LARGER_THAN_HOST')!
    expect(finding.severity).toBe('error')
    expect(finding.message).toContain('1 VM(s)')
    expect(finding.message).toContain('HUGE-1')
    expect(r.nodesNeeded).toBeNull()
    expect(r.computeNodesNeeded).toBeNull()
    expect(r.nodes).toBeGreaterThan(0)
  })

  it('fails fit-gap on 96-core, 1536 GiB hosts', () => {
    const cfg = san({ node: { sockets: 2, coresPerSocket: 48, ramGiB: 1536 } } as never)
    const result = assessFitGap(cfg, 16, [largeVm], tiers)
    expect(result.fits).toBe(false)
    expect(has(result.reverse.findings, 'VM_LARGER_THAN_HOST')).toBe(true)
    expect(result.reverse.status).toBe('blocked')
    expect(fitGapRequiredLabel(result)).toBe('No node count works')
  })

  it('credits the SMT factor for vCPU and uses usable, not installed, RAM', () => {
    const node = { sockets: 1, coresPerSocket: 16, ramGiB: 512 }
    const fits = solveForward(san({ node, smtFactor: 2 } as never), [vm({ vCpu: 32, ramGiB: 16 })], tiers)
    expect(has(fits.findings, 'VM_LARGER_THAN_HOST')).toBe(false)
    const tooManyVCpu = solveForward(san({ node, smtFactor: 1 } as never), [vm({ vCpu: 17, ramGiB: 16 })], tiers)
    expect(has(tooManyVCpu.findings, 'VM_LARGER_THAN_HOST')).toBe(true)
    // 512 GiB less a 12% reserve leaves 450.56 GiB usable.
    const tooMuchRam = solveForward(san({ node } as never), [vm({ vCpu: 4, ramGiB: 500 })], tiers)
    expect(has(tooMuchRam.findings, 'VM_LARGER_THAN_HOST')).toBe(true)
  })

  it('ignores excluded VMs and names the largest of several', () => {
    const cfg = san({ node: small } as never)
    expect(solveForward(cfg, [vm({ vCpu: 256, include: false })], tiers).feasible).toBe(true)
    const r = solveForward(cfg, [vm({ name: 'BIG', vCpu: 64 }), vm({ name: 'BIGGEST', vCpu: 128 })], tiers)
    const message = findingOf(r.findings, 'VM_LARGER_THAN_HOST')!.message
    expect(message).toContain('2 VM(s)')
    expect(message).toContain('BIGGEST')
  })
})

describe('A2: measured CPU is not divided by oversubscription', () => {
  const measured = { sizingBasis: 'measured-p95', performanceComfortFactor: 1.25 } as const

  it('sizes 100 x 16 vCPU at 50% P95 on actual use', () => {
    const vms = many(100, { vCpu: 16, performance: { cpuP95Pct: 50 } })
    expect(computeDemand(vms, tiers, 1, measured).requiredPCores).toBeCloseTo(1000)
  })

  it('applies the benchmark factor to measured CPU', () => {
    const vms = many(10, { vCpu: 16, performance: { cpuP95Pct: 50 } })
    expect(computeDemand(vms, tiers, 1, { ...measured, cpuPerformanceFactor: 2 }).requiredPCores).toBeCloseTo(50)
  })

  it('keeps allocation over ratio for VMs without a CPU measurement', () => {
    const vms = [vm({ vCpu: 16, performance: { memoryP95Pct: 50 } }), vm({ vCpu: 16 })]
    expect(computeDemand(vms, tiers, 1, measured).requiredPCores).toBeCloseTo(8)
  })

  it('leaves allocation sizing alone', () => {
    const vms = many(100, { vCpu: 16, performance: { cpuP95Pct: 50 } })
    expect(computeDemand(vms, tiers, 1, { sizingBasis: 'allocation' }).requiredPCores).toBeCloseTo(400)
  })

  it('raises the node count for measured data', () => {
    const vms = many(100, { vCpu: 16, ramGiB: 8, performance: { cpuP95Pct: 50 } })
    const allocation = solveForward(san(), vms, tiers)
    const p95 = solveForward(san(measured as never), vms, tiers)
    expect(p95.nodes).toBeGreaterThan(allocation.nodes)
  })
})

describe('A3: reverse includes storage performance', () => {
  const vms = many(100, { vCpu: 2, ramGiB: 8, storageGiB: 10, performance: { storageIopsP95: 100, storageThroughputMBpsP95: 1 } })

  it('agrees with forward when the SAN is too slow', () => {
    const cfg = san({ san: { usableTiB: 1000, drr: 1, maxIops: 100, maxThroughputMBps: 1000 } } as never)
    const forward = solveForward(cfg, vms, tiers)
    const reverse = solveReverse(cfg, 8, vms, tiers)
    expect(has(forward.findings, 'SAN_PERFORMANCE_EXCEEDED')).toBe(true)
    expect(has(reverse.findings, 'SAN_PERFORMANCE_EXCEEDED')).toBe(true)
    expect(reverse.status).toBe('over')
    expect(reverse.binding).toBe('storage')
    expect(reverse.bindingExplanation).toContain('cannot carry')
    expect(reverse.bindingExplanation).not.toContain('Headroom')
    expect(reverse.additionalVmsByTier.general).toBe(0)
  })

  it('limits further VMs by the performance that remains', () => {
    const cfg = san({ san: { usableTiB: 1000, drr: 1, maxIops: 12_000, maxThroughputMBps: 1000 } } as never)
    const reverse = solveReverse(cfg, 8, vms, tiers)
    expect(reverse.status).toBe('fits')
    expect(reverse.additionalVmsByTier.general).toBe(20)
  })

  it('checks S2D per-node capability at the entered node count', () => {
    const cfg = makeConfig({ node: { s2dIopsPerNode: 1000, s2dThroughputMBpsPerNode: 1000 } })
    const reverse = solveReverse(cfg, 4, vms, tiers)
    expect(has(reverse.findings, 'S2D_PERFORMANCE_EXCEEDED')).toBe(true)
    expect(reverse.storagePerformance.availableS2dIops).toBe(4000)
  })
})

describe('A4: management VMs are fixed in forecast and placement', () => {
  const workload = many(100, { vCpu: 8, ramGiB: 32, storageGiB: 100 })
  const management = many(6, { tier: 'infrastructure', vCpu: 16, ramGiB: 256, storageGiB: 500 })

  it('does not grow them in forward sizing', () => {
    const cfg = san({ growthFactor: 2 } as never)
    const result = solveForward(cfg, workload, tiers, management)
    const expected = computeDemand(workload, tiers, 2, cfg).requiredRamGiB + 6 * 256
    expect(result.demand.requiredRamGiB).toBeCloseTo(expected)
  })

  it('gives the same node count in forecast and placement', () => {
    const cfg = san({ annualGrowthPct: 0.5, growthHorizonYears: 3, growthStrategy: 'build-now', growthFactor: 1.2 } as never)
    const forecast = forecastGrowth(cfg, workload, tiers, management)
    const plan = planMultipleClusters(cfg, workload, tiers, { clusterLayout: 'single' }, management)
    const terminal = forecast.points[forecast.points.length - 1].result
    expect(terminal.feasible).toBe(true)
    expect(plan.totalNodes).toBe(terminal.nodes)
    expect(terminal.demand.requiredRamGiB).toBeCloseTo(plan.clusters[0].result.demand.requiredRamGiB)
  })

  it('gives the same answer as sizing the grown workload for a split plan', () => {
    const cfg = san({ growthFactor: 2 } as never)
    const plan = planMultipleClusters(cfg, workload, tiers, { clusterLayout: 'split', maxNodesPerCluster: 64 }, management)
    expect(plan.clusters[0].managementVmCount).toBe(6)
    expect(plan.clusters[0].result.demand.requiredRamGiB).toBeCloseTo(solveForward(cfg, workload, tiers, management).demand.requiredRamGiB)
  })
})

describe('A5: cache drives', () => {
  const hybrid = (cacheDriveTB: number) => solveForward(
    makeConfig({ node: { media: 'hybrid', capacityDriveTB: 16, cacheDrivesPerNode: 2, cacheDriveTB } }), [vm()], tiers,
  )

  it('rejects a cache drive below 32 GB', () => {
    const r = hybrid(0.016)
    expect(r.feasible).toBe(false)
    expect(has(r.findings, 'MIN_CACHE_DRIVE_SIZE')).toBe(true)
  })

  it('accepts exactly 32 GB, which Microsoft states in decimal', () => {
    expect(has(hybrid(0.032).findings, 'MIN_CACHE_DRIVE_SIZE')).toBe(false)
  })

  it('treats 2 x 0 TB on HDD as no cache', () => {
    const r = hybrid(0)
    expect(r.feasible).toBe(false)
    expect(has(r.findings, 'HDD_NEEDS_CACHE')).toBe(true)
  })
})

describe('A6: disk witness', () => {
  it('is an error on S2D and hybrid, and fine on SAN', () => {
    expect(has(solveForward(makeConfig({ witnessType: 'disk' }), [vm()], tiers).findings, 'DISK_WITNESS_ON_S2D')).toBe(true)
    expect(has(solveForward(makeConfig({ architecture: 'hybrid', witnessType: 'disk' }), [vm()], tiers).findings, 'DISK_WITNESS_ON_S2D')).toBe(true)
    expect(solveForward(san({ witnessType: 'disk' }), [vm()], tiers).feasible).toBe(true)
  })

  it('does not rule S2D out of the comparison when SAN uses a disk witness, and says so', () => {
    const options = compareArchitectures(san({ witnessType: 'disk' }), [vm()], tiers)
    const s2d = options.find((option) => option.key === 's2d-3wm')!
    expect(s2d.result.feasible).toBe(true)
    expect(s2d.cfg.witnessType).toBe('cloud')
    expect(has(s2d.result.findings, 'DISK_WITNESS_COMPARISON')).toBe(true)
    expect(options.find((option) => option.key === 'san')!.cfg.witnessType).toBe('disk')
  })
})

describe('A7: binding', () => {
  it('reports the floor for 5 small VMs on three-way mirror', () => {
    const r = solveForward(makeConfig(), many(5, { vCpu: 2, ramGiB: 8, storageGiB: 50 }), tiers)
    expect(r.nodes).toBe(3)
    expect(r.binding).toBe('node-floor')
    expect(r.bindingExplanation).not.toContain('Storage-bound')
  })

  it('reports the floor for no VMs at N+3', () => {
    const r = solveForward(makeConfig({ spareNodes: 3 }), [], tiers)
    expect(r.nodes).toBe(4)
    expect(r.binding).toBe('node-floor')
    expect(r.bindingExplanation).toContain('4 is the minimum')
    expect(r.bindingExplanation).not.toContain('CPU-bound')
  })

  it('does not call an S2D floor performance when a SAN is nearly full of IOPS', () => {
    const cfg = makeConfig({ architecture: 'hybrid', san: { usableTiB: 1000, drr: 1, maxIops: 1000, maxThroughputMBps: 1000 } })
    const r = solveForward(cfg, [vm({ performance: { storageIopsP95: 990, storageThroughputMBpsP95: 1 } })], tiers)
    expect(r.binding).toBe('node-floor')
  })

  it('still reports a real CPU binding at the floor', () => {
    // Needs 2 workload nodes + 1 spare = 3, the same as the three-way mirror floor.
    const r = solveForward(makeConfig(), many(1, { tier: 'database', vCpu: 61, ramGiB: 8, storageGiB: 10 }).concat(many(1, { tier: 'database', vCpu: 61, ramGiB: 8, storageGiB: 10 })), tiers)
    expect(r.nodes).toBe(3)
    expect(r.binding).toBe('cpu')
  })
})

describe('A8: hybrid reports each domain', () => {
  const cfg = makeConfig({
    architecture: 'hybrid',
    node: { capacityDrivesPerNode: 4, capacityDriveTB: 1 },
    san: { usableTiB: 100, drr: 1 },
  })
  const vms = many(10, { tier: 'database', vCpu: 1, ramGiB: 4, storageGiB: 1024 })

  it('never shows positive spare when one domain is short', () => {
    const r = solveReverse(cfg, 4, vms, tiers)
    const s2d = r.storageDomains.find((domain) => domain.domain === 's2d')!
    const sanDomain = r.storageDomains.find((domain) => domain.domain === 'san')!
    expect(s2d.headroomTiB).toBeLessThan(0)
    expect(sanDomain.headroomTiB).toBeGreaterThan(0)
    expect(r.headroomStorageTiB).toBeCloseTo(s2d.headroomTiB)
    expect(r.status).toBe('over')
  })

  it('reports the sum once every domain has room', () => {
    const r = solveReverse(cfg, 4, [vm({ tier: 'database', vCpu: 1, ramGiB: 4, storageGiB: 10 })], tiers)
    expect(r.headroomStorageTiB).toBeCloseTo(r.availableStorageTiB - r.usedStorageTiB)
  })
})

describe('A9: CSV sizes', () => {
  const demandFor = (cfg: ClusterConfig, vms: Vm[]) => computeDemand(vms, tiers, 1, cfg)

  it('reports SAN sizes including the free-space target without changing the count', () => {
    const vms = many(4, { storageGiB: 1024 })
    const withTarget = san({ sanFreeSpaceTargetPct: 0.2 })
    const noTarget = san({ sanFreeSpaceTargetPct: 0 })
    const [a] = planCsvs(withTarget, demandFor(withTarget, vms), tiers, 4)
    const [b] = planCsvs(noTarget, demandFor(noTarget, vms), tiers, 4)
    expect(a.count).toBe(b.count)
    expect(b.sizeTiB).toBe(1)
    expect(a.sizeTiB).toBe(1.3)
    expect(a.totalTiB).toBe(b.totalTiB)
    expect(a.freeSpaceTargetPct).toBe(0.2)
  })

  it('leaves S2D sizes at the data held', () => {
    const cfg = makeConfig({ sanFreeSpaceTargetPct: 0.2 })
    const [plan] = planCsvs(cfg, demandFor(cfg, many(4, { storageGiB: 1024 })), tiers, 4)
    expect(plan.freeSpaceTargetPct).toBe(0)
    expect(plan.sizeTiB).toBe(1)
  })
})

describe('A10 and C7: fixed-array free-space target', () => {
  const vms = (tib: number) => [vm({ storageGiB: tib * 1024 })]
  const cfg = san({ san: { usableTiB: 100, drr: 1 } } as never)

  it('stays quiet below the target', () => {
    expect(has(solveForward(cfg, vms(80), tiers).findings, 'SAN_FREE_SPACE_TARGET')).toBe(false)
    expect(has(solveReverse(cfg, 4, vms(80), tiers).findings, 'SAN_FREE_SPACE_TARGET')).toBe(false)
  })

  it('warns above the target and still fits', () => {
    const forward = solveForward(cfg, vms(90), tiers)
    const reverse = solveReverse(cfg, 4, vms(90), tiers)
    const fit = assessFitGap(cfg, 4, vms(90), tiers)
    expect(forward.feasible).toBe(true)
    expect(findingOf(forward.findings, 'SAN_FREE_SPACE_TARGET')!.severity).toBe('warning')
    expect(has(reverse.findings, 'SAN_FREE_SPACE_TARGET')).toBe(true)
    expect(reverse.status).toBe('fits')
    expect(fit.fits).toBe(true)
    expect(fit.recommendations.some((item) => item.includes('free-space target'))).toBe(true)
  })

  it('honours an edited target', () => {
    const edited = san({ san: { usableTiB: 100, drr: 1 }, sanFreeSpaceTargetPct: 0.05 } as never)
    expect(has(solveForward(edited, vms(90), tiers).findings, 'SAN_FREE_SPACE_TARGET')).toBe(false)
  })

  it('agrees in forward, reverse and fit at exactly 100%', () => {
    const forward = solveForward(cfg, vms(100), tiers)
    const reverse = solveReverse(cfg, 4, vms(100), tiers)
    const fit = assessFitGap(cfg, 4, vms(100), tiers)
    expect(forward.feasible).toBe(true)
    expect(reverse.status).toBe('fits')
    expect(reverse.bindingExplanation).toContain('No headroom remains')
    expect(reverse.bindingExplanation).not.toContain('cannot carry')
    expect(fit.fits).toBe(true)
  })

  it('fails in both above 100%', () => {
    expect(solveForward(cfg, vms(101), tiers).feasible).toBe(false)
    expect(solveReverse(cfg, 4, vms(101), tiers).status).toBe('over')
    expect(assessFitGap(cfg, 4, vms(101), tiers).fits).toBe(false)
  })

  it('stops room for more VMs at the target', () => {
    const r = solveReverse(cfg, 8, [vm({ vCpu: 1, ramGiB: 1, storageGiB: 10 * 1024 })], tiers)
    // 70 TiB of room before the 80 TiB target, at 10 TiB per VM.
    expect(r.additionalVmsByTier.general).toBe(7)
    expect(r.storageDomains[0].headroomTiB).toBeCloseTo(90)
    expect(r.storageDomains[0].headroomToTargetTiB).toBeCloseTo(70)
  })
})

describe('A11: limits', () => {
  it('adds hosts for the 1,024 VMs per host limit', () => {
    const vms = many(1333, { tier: 'vdi', vCpu: 1, ramGiB: 1, storageGiB: 1 })
    const node = { sockets: 2, coresPerSocket: 128, ramGiB: 4096 }
    const r = solveForward(san({ spareNodes: 0, node } as never), vms, tiers)
    expect(r.nodes).toBe(2)
    expect(r.feasible).toBe(true)
    expect(r.binding).toBe('vm-count')
    const withSpare = solveForward(san({ spareNodes: 1, node } as never), vms, tiers)
    expect(withSpare.nodes).toBe(3)
    expect(withSpare.binding).toBe('vm-count')
  })

  it('fails existing hardware above 1,024 VMs per host', () => {
    const vms = many(1333, { tier: 'vdi', vCpu: 1, ramGiB: 1, storageGiB: 1 })
    const node = { sockets: 2, coresPerSocket: 128, ramGiB: 4096 }
    const r = solveReverse(san({ spareNodes: 1, node } as never), 2, vms, tiers)
    expect(r.headroomPCores).toBeGreaterThan(0)
    expect(has(r.findings, 'VMS_PER_HOST')).toBe(true)
    expect(r.status).toBe('blocked')
  })

  it('counts growth against 8,000 VMs per cluster', () => {
    const cfg = san({ growthFactor: 2, node: { sockets: 2, coresPerSocket: 128, ramGiB: 16384 } } as never)
    const r = solveForward(cfg, many(4001, { vCpu: 1, ramGiB: 1, storageGiB: 1 }), tiers)
    expect(has(r.findings, 'VMS_PER_CLUSTER')).toBe(true)
  })

  it('enforces per-VM memory, VHDX, logical-processor and Gen 1 limits', () => {
    const huge = { sockets: 8, coresPerSocket: 128, ramGiB: 512 * 1024 }
    const memory = solveForward(san({ node: huge } as never), [vm({ ramGiB: LIMITS.MAX_RAM_PER_VM_GIB + 1 })], tiers)
    expect(has(memory.findings, 'VM_RAM_MAX')).toBe(true)
    const vhdx = solveForward(san({ san: { usableTiB: 1000, drr: 1 } } as never), [vm({ provisionedGiB: 100 * 1024, diskCount: 1 })], tiers)
    expect(findingOf(vhdx.findings, 'VHDX_MAX')!.severity).toBe('warning')
    const split = solveForward(san(), [vm({ provisionedGiB: 100 * 1024, diskCount: 4 })], tiers)
    expect(has(split.findings, 'VHDX_MAX')).toBe(false)
    const lps = solveForward(san({ node: { sockets: 8, coresPerSocket: 300, ramGiB: 1024 } } as never), [vm()], tiers)
    expect(has(lps.findings, 'HOST_LOGICAL_PROCESSORS')).toBe(true)
    const gen1 = solveForward(san({ node: { sockets: 2, coresPerSocket: 64, ramGiB: 2048 } } as never), [vm({ vCpu: 65, firmware: 'bios' })], tiers)
    expect(findingOf(gen1.findings, 'VM_GEN1_LIMIT')!.severity).toBe('warning')
    const gen2 = solveForward(san({ node: { sockets: 2, coresPerSocket: 64, ramGiB: 2048 } } as never), [vm({ vCpu: 65, firmware: 'efi' })], tiers)
    expect(has(gen2.findings, 'VM_GEN1_LIMIT')).toBe(false)
  })
})

describe('A12: smaller engine errors', () => {
  it('gives no node count for an unfixable SAN shortfall, and keeps the compute answer', () => {
    const r = solveForward(san({ san: { usableTiB: 1, drr: 1 } } as never), many(40, { tier: 'database', vCpu: 32, ramGiB: 8, storageGiB: 100 }), tiers)
    expect(r.feasible).toBe(false)
    expect(r.nodesNeeded).toBeNull()
    expect(r.computeNodesNeeded).toBeGreaterThan(2)
    expect(r.bindingExplanation).toContain(`Compute alone needs ${r.computeNodesNeeded} nodes`)
    expect(r.bindingExplanation).not.toContain('single cluster')
    expect(r.bindingExplanation).not.toContain('Ceiling')
  })

  it('does not count IOPS-only data as validated storage coverage', () => {
    const cfg = san({ san: { usableTiB: 1000, drr: 1, maxIops: 10_000, maxThroughputMBps: 1000 } } as never)
    const r = solveForward(cfg, [vm({ performance: { storageIopsP95: 100 } })], tiers)
    expect(r.storagePerformance.measuredVmCoveragePct).toBe(0)
    expect(r.storagePerformance.validated).toBe(false)
    expect(r.storagePerformance.requiredSanIops).toBe(100)
    expect(r.performanceAssessment.storagePerformanceCoveragePct).toBe(0)
  })

  it('counts a VM missing memory P95 as fallback', () => {
    const data = assessPerformanceData([vm({ performance: { cpuP95Pct: 50 } })], { sizingBasis: 'measured-p95' })
    expect(data.fallbackVms).toBe(1)
    expect(data.measuredVms).toBe(1)
  })

  it('grows totalVCpu with the demand it is displayed beside', () => {
    expect(computeDemand([vm({ vCpu: 4 })], tiers, 2).totalVCpu).toBe(8)
  })

  it('forecasts without growing each VM, so growth raises no false per-VM findings', () => {
    const cfg = san({ annualGrowthPct: 1, growthHorizonYears: 3, node: { sockets: 2, coresPerSocket: 16, ramGiB: 512 } } as never)
    const forecast = forecastGrowth(cfg, many(4, { vCpu: 12, ramGiB: 64, storageGiB: 100 }), tiers)
    const terminal = forecast.points[forecast.points.length - 1].result
    expect(forecast.points[forecast.points.length - 1].demandFactor).toBe(8)
    expect(has(terminal.findings, 'NUMA_SPANNING')).toBe(false)
    expect(has(terminal.findings, 'VM_LARGER_THAN_HOST')).toBe(false)
    expect(terminal.demand.totalVCpu).toBe(384)
    expect(terminal.demand.byTier.general.plannedVms).toBe(32)
  })

  it('plans CSVs for any non-zero hybrid share and does not double-count split VMs', () => {
    const splitTiers = makeTiers({ general: { hybridPlacement: 'split' } })
    const cfg = makeConfig({ architecture: 'hybrid', hybridS2dShare: 0.5 })
    const three = planCsvs(cfg, computeDemand(many(3, { storageGiB: 100 }), splitTiers, 1, cfg), splitTiers, 4)
    expect(three.reduce((sum, plan) => sum + plan.plannedVms, 0)).toBe(3)
    const small = makeConfig({ architecture: 'hybrid', hybridS2dShare: 0.005 })
    const plans = planCsvs(small, computeDemand(many(10, { storageGiB: 1024 }), splitTiers, 1, small), splitTiers, 4)
    expect(plans.map((plan) => plan.domain).sort()).toEqual(['s2d', 'san'])
    expect(plans.reduce((sum, plan) => sum + plan.totalTiB, 0)).toBeCloseTo(10)
  })

  it('blames the spares, not the server, for nested mirror at N+2', () => {
    const r = solveForward(makeConfig({ resiliency: 'nested-two-way-mirror', spareNodes: 2 }), [vm()], tiers)
    expect(r.feasible).toBe(false)
    expect(r.bindingExplanation).toContain('N+2')
    expect(r.bindingExplanation).toContain('reduce the spare nodes')
    expect(r.bindingExplanation).not.toContain('larger server')
    expect(r.binding).toBe('node-floor')
  })

  it('warns about two-way mirror above 2 nodes', () => {
    const above = solveForward(makeConfig({ resiliency: 'two-way-mirror', spareNodes: 2 }), [vm()], tiers)
    expect(above.nodes).toBe(3)
    expect(findingOf(above.findings, 'TWO_WAY_MIRROR_ABOVE_2_NODES')!.basis).toBe('MS-REC')
    const atTwo = solveForward(makeConfig({ resiliency: 'two-way-mirror', spareNodes: 1 }), [vm()], tiers)
    expect(atTwo.nodes).toBe(2)
    expect(has(atTwo.findings, 'TWO_WAY_MIRROR_ABOVE_2_NODES')).toBe(false)
  })
})

describe('A13: tags and citations', () => {
  const design = (cfg: ClusterConfig) => validateDesign(cfg, 4, [vm()], tiers, [])

  it('tags recommendations as recommendations and cites the right page', () => {
    const cfg = makeConfig({ node: { media: 'hybrid', capacityDriveTB: 16, cacheDrivesPerNode: 2, cacheDriveTB: 0.1 } })
    const findings = design(cfg)
    expect(findingOf(findings, 'CACHE_ENDURANCE')!.basis).toBe('MS-REC')
    expect(findingOf(findings, 'CACHE_RATIO')!.source).toContain('choose-drives')
  })

  it('tags the VSS and volume limits, and the SAN cap as a tool assumption', () => {
    const cfg = san({ backupMethod: 'vss-volsnap', sanCsvLayoutMode: 'custom', sanCustomCsvCount: 1 })
    const big = [{ ...planCsvs(cfg, computeDemand([vm({ storageGiB: 1024 })], tiers, 1, cfg), tiers, 4)[0], sizeTiB: 100 }]
    const findings = validateDesign(cfg, 4, [vm()], tiers, big)
    expect(findingOf(findings, 'CSV_VSS_SIZE')!.basis).toBe('MS-REC')
    expect(findingOf(findings, 'CSV_SIZE')!.basis).toBe('TOOL')
    const s2d = [{ ...big[0], domain: 's2d' as const }]
    expect(findingOf(validateDesign(makeConfig(), 4, [vm()], tiers, s2d), 'CSV_SIZE')!.basis).toBe('MS-REC')
  })

  it('does not cite a SQL on Linux page for database Dynamic Memory', () => {
    const dynamic = makeTiers({ database: { allowDynamicMemory: true } })
    const finding = findingOf(validateDesign(san(), 4, [vm()], dynamic, []), 'DYNAMIC_MEMORY_DB')!
    expect(finding.basis).toBe('TOOL')
    expect(finding.source).not.toContain('sql/linux')
  })
})

describe('C4: no workloads', () => {
  it('states capacity and never says a resource binds', () => {
    const r = solveReverse(san(), 8, [], tiers)
    expect(r.status).toBe('no-workload')
    expect(r.binding).toBe('none')
    expect(r.bindingExplanation).not.toContain('binds first')
    expect(r.headline).not.toContain('binds first')
    expect(r.bindingExplanation).toContain('physical cores')
    expect(r.additionalVmsByTier.general).toBeGreaterThan(0)
  })
})

describe('C5: management VMs in the fit verdict', () => {
  const cfg = san({ spareNodes: 1, node: { sockets: 2, coresPerSocket: 32, ramGiB: 1024 } } as never)
  const workload = many(100, { vCpu: 2, ramGiB: 40, storageGiB: 10 })
  const management = Array.from({ length: 30 }, () => fixed({ ramGiB: 256 }))

  it('defaults to none', () => {
    expect(assessFitGap(cfg, 6, workload, tiers).managementVms).toBe(0)
    expect(assessFitGap(cfg, 6, workload, tiers).fits).toBe(true)
  })

  it('turns a fit into a shortfall when management VMs share the hardware', () => {
    const result = assessFitGap(cfg, 6, workload, tiers, management)
    expect(result.managementVms).toBe(30)
    expect(result.fits).toBe(false)
    expect(result.additionalNodes).toBeGreaterThan(0)
    expect(result.deficits.ramGiB).toBeGreaterThan(0)
    expect(result.reverse.usedRamGiB).toBeCloseTo(100 * 40 + 30 * 256)
  })

  it('does not count them as workloads and needs a workload for a verdict', () => {
    expect(assessFitGap(cfg, 6, workload, tiers, management).assessedVms).toBe(100)
    expect(assessFitGap(cfg, 6, [], tiers, management).fits).toBeNull()
  })

  it('profiles further VMs from the workload only', () => {
    const r = solveReverse(cfg, 12, workload, tiers, management)
    const without = solveReverse(cfg, 12, workload, tiers)
    expect(r.additionalVmsByTier.general).toBeLessThan(without.additionalVmsByTier.general)
    expect(r.headroomRamGiB).toBeCloseTo(without.headroomRamGiB - 30 * 256)
  })

  it('counts them only for design, included in sizing, on the workload cluster', () => {
    const base = { decision: 'design', includeInSizing: true, storedInputs: null, platformNodes: 8, workloadVmCount: 100 }
    expect(managementVmsForSizing(base).length).toBeGreaterThan(0)
    expect(managementVmsForSizing({ ...base, decision: 'existing' })).toEqual([])
    expect(managementVmsForSizing({ ...base, decision: 'deferred' })).toEqual([])
    expect(managementVmsForSizing({ ...base, includeInSizing: false })).toEqual([])
  })
})

describe('C19: fit panel answers', () => {
  it('shows the compute answer when the array blocks, with the shortfall separate', () => {
    const cfg = san({ san: { usableTiB: 1, drr: 1 }, spareNodes: 1 } as never)
    const vms = many(40, { tier: 'database', vCpu: 32, ramGiB: 8, storageGiB: 100 })
    const result = assessFitGap(cfg, 8, vms, tiers)
    expect(result.fits).toBe(false)
    expect(result.requiredNodesAtSameSpec).toBeNull()
    expect(result.requiredNodesForCompute).toBeGreaterThan(8)
    expect(result.additionalNodesForCompute).toBe(result.requiredNodesForCompute! - 8)
    expect(result.storageShortfalls[0]).toContain('Adding hosts does not change the array')
    expect(fitGapRequiredLabel(result)).toBe(`${result.requiredNodesForCompute} for compute`)
    expect(fitGapAdditionalLabel(result)).toBe(`${result.additionalNodesForCompute} for compute`)
  })

  it('says Add workloads with no workloads', () => {
    const result = assessFitGap(san(), 8, [], tiers)
    expect(fitGapRequiredLabel(result)).toBe('Add workloads')
    expect(fitGapAdditionalLabel(result)).toBe('Add workloads')
    expect(result.storageShortfalls).toEqual([])
  })

  it('still reports plain numbers when nodes solve it', () => {
    const cfg = san({ node: { sockets: 1, coresPerSocket: 8, ramGiB: 4096 } } as never)
    const result = assessFitGap(cfg, 4, many(40, { tier: 'database', vCpu: 8, ramGiB: 4, storageGiB: 10 }), tiers)
    expect(fitGapRequiredLabel(result)).toBe(result.requiredNodesAtSameSpec)
    expect(fitGapAdditionalLabel(result)).toBe(result.additionalNodes)
  })
})

describe('C21: engine contradictions', () => {
  it('2-node three-way mirror is not headroom', () => {
    const r = solveReverse(makeConfig(), 2, [vm()], tiers)
    expect(has(r.findings, 'RESILIENCY_MIN_NODES')).toBe(true)
    expect(r.status).toBe('blocked')
    expect(r.headline).toBe('Not valid as entered')
    expect(r.bindingExplanation).not.toContain('Headroom')
    expect(r.bindingExplanation).toContain('minimum of 3 nodes')
    expect(r.additionalVmsByTier.general).toBe(0)
  })

  it('20-host S2D explains that more hosts will not help', () => {
    const result = assessFitGap(makeConfig({ spareNodes: 1 }), 20, [vm()], tiers)
    expect(result.fits).toBe(false)
    expect(result.requiredNodesAtSameSpec).toBe(3)
    expect(result.additionalNodes).toBe(0)
    expect(result.blockers.join(' ')).toContain('Storage Spaces Direct ceiling')
    expect(result.recommendations.some((item) => item.includes('adding hosts will not help'))).toBe(true)
  })

  it('fixed SAN shortfall does not read as nodes needed', () => {
    const r = solveForward(san({ san: { usableTiB: 1, drr: 1 } } as never), many(200, { tier: 'database', vCpu: 16, storageGiB: 100 }), tiers)
    expect(r.nodesNeeded).toBeNull()
    expect(r.computeNodesNeeded).toBeGreaterThan(2)
    expect(r.nodes).toBe(64)
  })
})

describe('E13: licensing floor', () => {
  const floorMessage = (node: Partial<ClusterConfig['node']>) => findingOf(
    solveForward(san({ node } as never), [vm({ vCpu: 1, ramGiB: 1 })], tiers).findings, 'LICENSE_FLOOR',
  )?.message

  it('reports the real unused cores for 4 sockets x 3 cores', () => {
    expect(floorMessage({ sockets: 4, coresPerSocket: 3, ramGiB: 1024 })).toContain('20 unused cores')
  })

  it('covers the per-socket floor above 16 total cores', () => {
    expect(floorMessage({ sockets: 4, coresPerSocket: 6, ramGiB: 1024 })).toContain('8 unused cores')
  })

  it('stays quiet at or above both floors', () => {
    expect(floorMessage({ sockets: 2, coresPerSocket: 8, ramGiB: 1024 })).toBeUndefined()
  })
})

describe('all four paths stay consistent', () => {
  const vms = many(50, { vCpu: 4, ramGiB: 16, storageGiB: 200 })

  it('new platform: forward and CSV planning are unchanged at allocation', () => {
    const r = solveForward(san({ sanSizingMode: 'calculated', sanFreeSpaceTargetPct: 0.2, san: { usableTiB: 1, drr: 2.5 } } as never), vms, tiers)
    expect(r.feasible).toBe(true)
    expect(r.sanSizing?.usableToBuyTiB).toBeCloseTo((50 * 200) / 1024 / 0.8 / 2.5)
    expect(has(r.findings, 'SAN_FREE_SPACE_TARGET')).toBe(false)
  })

  it('existing capacity and fit-gap agree with forward on what fits', () => {
    const cfg = san()
    const forward = solveForward(cfg, vms, tiers)
    expect(solveReverse(cfg, forward.nodes, vms, tiers).status).toBe('fits')
    expect(assessFitGap(cfg, forward.nodes, vms, tiers).fits).toBe(true)
    expect(assessFitGap(cfg, forward.nodes, vms, tiers).additionalNodes).toBe(0)
  })

  it('management only: sizing nothing stays quiet', () => {
    const r = solveForward(san(), [], tiers)
    expect(r.demand.vmCount).toBe(0)
    expect(r.feasible).toBe(true)
  })
})
