import { describe, expect, it } from 'vitest'
import { LIMITS } from '../rules'
import { assessFitGap } from '../fitGap'
import { clusterNodeLimitFor, normalizePlacementInputs, planMultipleClusters, plannedPlatformNodes } from '../deploymentPlanning'
import { compareArchitectures, compareReferenceServers, solveForward } from '../solve'
import { hardwareInputProblems } from '../validate'
import { makeConfig, makeTiers, vm } from './fixtures'

const tiers = makeTiers()
const smallNode = { sockets: 1, coresPerSocket: 16, ramGiB: 256 }

/** VMs sized so memory forces close to one workload node per VM group, for predictable counts. */
function fleetNeeding(workloadNodes: number) {
  const usableRam = 256 - Math.max(32, 256 * 0.12)
  return Array.from({ length: workloadNodes }, (_, i) => vm({ name: `VM${i}`, vCpu: 1, ramGiB: usableRam, storageGiB: 10 }))
}

describe('real node counts around the cluster limits', () => {
  const san = makeConfig({ architecture: 'san', spareNodes: 2, node: smallNode })
  const s2d = makeConfig({ architecture: 's2d', spareNodes: 2, node: { ...smallNode, cacheDrivesPerNode: 0 } })

  it.each([
    [16, 14, true],
    [17, 15, true],
    [22, 20, true],
    [64, 62, true],
    [65, 63, false],
  ])('SAN: %i nodes needed has feasible=%s at the 64-node limit', (nodes, workload, feasible) => {
    const r = solveForward(san, fleetNeeding(workload), tiers)
    expect(r.nodesNeeded).toBe(nodes)
    expect(r.clusterNodeLimit).toBe(LIMITS.CLUSTER_MAX_NODES)
    expect(r.feasible).toBe(feasible)
  })

  it.each([
    [16, 14, true],
    [17, 15, false],
    [22, 20, false],
  ])('S2D: %i nodes needed against the 16-node limit', (nodes, workload, feasible) => {
    const r = solveForward(s2d, fleetNeeding(workload), tiers)
    expect(r.nodesNeeded).toBe(nodes)
    expect(r.clusterNodeLimit).toBe(LIMITS.S2D_MAX_NODES)
    expect(r.feasible).toBe(feasible)
  })

  it('keeps the node ceiling in `nodes` so existing-hardware callers are unaffected', () => {
    const r = solveForward(s2d, fleetNeeding(20), tiers)
    expect(r.nodes).toBe(16)
    expect(r.nodesNeeded).toBe(22)
  })

  it('reports no node count, and names the field, when a server value is 0', () => {
    const cfg = makeConfig({ architecture: 'san', node: { sockets: 0 } })
    const r = solveForward(cfg, [vm()], tiers)
    expect(r.nodesNeeded).toBeNull()
    expect(r.bindingExplanation).not.toContain('Infinity')
    expect(r.bindingExplanation).toContain('Sockets')
    expect(hardwareInputProblems(cfg)).toContain('Sockets must be at least 1.')
  })

  it('gives CPU advice, not storage-resiliency advice, when CPU is the limit', () => {
    const r = solveForward(san, Array.from({ length: 800 }, () => vm({ tier: 'database', vCpu: 8, ramGiB: 1, storageGiB: 1 })), tiers)
    expect(r.feasible).toBe(false)
    expect(r.bindingExplanation).toContain('larger server')
    expect(r.bindingExplanation).not.toContain('resiliency')
  })
})

describe('one cluster or split is the user choice', () => {
  const san = makeConfig({ architecture: 'san', spareNodes: 2, node: smallNode })

  it('keeps a 22-node SAN design as one cluster by default', () => {
    const plan = planMultipleClusters(san, fleetNeeding(20), tiers)
    expect(plan.feasible).toBe(true)
    expect(plan.clusters).toHaveLength(1)
    expect(plan.totalNodes).toBe(22)
  })

  it('does not apply a VM-count target unless the user entered one', () => {
    const plan = planMultipleClusters(san, Array.from({ length: 1000 }, (_, i) => vm({ name: `V${i}`, vCpu: 1, ramGiB: 1, storageGiB: 1 })), tiers)
    expect(plan.clusters).toHaveLength(1)
  })

  it('never splits an S2D design over the limit on its own', () => {
    const s2d = makeConfig({ architecture: 's2d', spareNodes: 2, node: { ...smallNode, cacheDrivesPerNode: 0 } })
    const plan = planMultipleClusters(s2d, fleetNeeding(20), tiers)
    expect(plan.feasible).toBe(false)
    expect(plan.clusters).toHaveLength(1)
    expect(plan.warnings[0]).toContain('Nothing has been split')
    expect(plan.totalNodes).toBe(0)
  })

  it('splits only when asked, and each cluster keeps its own spares', () => {
    const plan = planMultipleClusters(san, fleetNeeding(20), tiers, { clusterLayout: 'split', maxNodesPerCluster: 12 })
    expect(plan.feasible).toBe(true)
    expect(plan.clusters).toHaveLength(2)
    expect(plan.totalNodes).toBe(24)
    expect(plannedPlatformNodes(plan.clusters[0].result, plan, { clusterLayout: 'split' })).toBe(24)
  })

  it('cannot exceed the storage type limit even if a larger maximum was stored', () => {
    const s2d = makeConfig({ architecture: 's2d', spareNodes: 2, node: { ...smallNode, cacheDrivesPerNode: 0 } })
    expect(clusterNodeLimitFor(s2d)).toBe(16)
    const plan = planMultipleClusters(s2d, fleetNeeding(20), tiers, { clusterLayout: 'split', maxNodesPerCluster: 64 })
    expect(plan.feasible).toBe(true)
    expect(plan.clusters.every((cluster) => cluster.result.nodes <= 16)).toBe(true)
  })

  it('opens old projects as one cluster unless the split was tuned', () => {
    expect(normalizePlacementInputs(undefined).clusterLayout).toBe('single')
    expect(normalizePlacementInputs({ maxNodesPerCluster: 16, targetVmsPerCluster: 800, maxClusters: 32, preserveSourceClusters: false, separateDatabaseTier: false, sanCapacityScope: 'shared' }))
      .toMatchObject({ clusterLayout: 'single', targetVmsPerCluster: 8000 })
    expect(normalizePlacementInputs({ maxNodesPerCluster: 8 })).toMatchObject({ clusterLayout: 'split', maxNodesPerCluster: 8 })
  })
})

describe('SAN sizing', () => {
  const vms = [vm({ storageGiB: 1024 * 156 })]

  it('calculates the array to buy and treats it as no limit in a new design', () => {
    const cfg = makeConfig({ architecture: 'san', sanSizingMode: 'calculated', sanFreeSpaceTargetPct: 0.2, san: { usableTiB: 1, drr: 2.5 } })
    const r = solveForward(cfg, vms, tiers)
    expect(r.feasible).toBe(true)
    expect(r.sanSizing?.usableToBuyTiB).toBeCloseTo(78, 5)
    expect(r.sanCapacityTiB).toBeCloseTo(195, 5)
  })

  it('keeps an entered array as a hard limit when the mode is absent, as on existing hardware', () => {
    const cfg = makeConfig({ architecture: 'san', san: { usableTiB: 1, drr: 2.5 } })
    const r = solveForward(cfg, vms, tiers)
    expect(r.feasible).toBe(false)
    expect(r.sanSizing).toBeNull()
    expect(r.bindingExplanation).toContain('SAN capacity provides')
    expect(assessFitGap(cfg, 8, vms, tiers).deficits.sanTiB).toBeGreaterThan(0)
  })

  it('does not report a shared-array shortfall for a calculated SAN that is split', () => {
    const cfg = makeConfig({ architecture: 'san', spareNodes: 2, sanSizingMode: 'calculated', node: smallNode })
    const plan = planMultipleClusters(cfg, fleetNeeding(20), tiers, { clusterLayout: 'split', maxNodesPerCluster: 12 })
    expect(plan.feasible).toBe(true)
  })

  it('reports nothing to buy for S2D', () => {
    const options = compareArchitectures(makeConfig({ sanSizingMode: 'calculated' }), [vm()], tiers)
    expect(options.find((option) => option.key === 's2d-3wm')?.result.sanSizing).toBeNull()
    expect(options.find((option) => option.key === 'san')?.result.sanSizing).not.toBeNull()
  })
})

describe('reference server comparison', () => {
  it('compares sizes without changing the configured server', () => {
    const cfg = makeConfig({ architecture: 'san', node: { sockets: 2, coresPerSocket: 48, ramGiB: 1536 } })
    const servers = compareReferenceServers(cfg, fleetNeeding(10), tiers)
    expect(servers.filter((server) => server.selected).map((server) => server.key)).toEqual(['large'])
    expect(servers.find((server) => server.key === 'small')!.result.nodesNeeded!).toBeGreaterThanOrEqual(servers.find((server) => server.key === 'xlarge')!.result.nodesNeeded!)
    expect(cfg.node.coresPerSocket).toBe(48)
  })

  it('adds a custom server the user entered', () => {
    const servers = compareReferenceServers(makeConfig({ architecture: 'san', node: { sockets: 2, coresPerSocket: 24, ramGiB: 768 } }), [vm()], tiers)
    expect(servers.find((server) => server.selected)?.key).toBe('current')
  })
})
