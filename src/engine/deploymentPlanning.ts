import { LIMITS, RESILIENCY } from './rules'
import { solveForward } from './solve'
import { overLimitAdvice } from './advice'
import type { ClusterConfig, SizingResult, TierId, TierPolicy, Vm } from './types'

/** One cluster is the default. Surveyor splits a design only when the user selects split. */
export type ClusterLayout = 'single' | 'split'

export interface PlacementInputs {
  clusterLayout: ClusterLayout
  maxNodesPerCluster: number
  targetVmsPerCluster: number
  preserveSourceClusters: boolean
  separateDatabaseTier: boolean
  maxClusters: number
  sanCapacityScope: 'shared' | 'per-cluster'
}

export const DEFAULT_PLACEMENT_INPUTS: PlacementInputs = {
  clusterLayout: 'single',
  maxNodesPerCluster: 16,
  // 8,000 is the Hyper-V per-cluster maximum, so no VM target applies unless the user enters one.
  targetVmsPerCluster: 8000,
  preserveSourceClusters: false,
  separateDatabaseTier: false,
  maxClusters: 32,
  sanCapacityScope: 'shared',
}

export interface PlannedCluster {
  id: string
  name: string
  purpose: string
  vms: Vm[]
  result: SizingResult
  sourceClusters: string[]
  managementVmCount: number
}

export interface MultiClusterPlan {
  feasible: boolean
  clusters: PlannedCluster[]
  totalNodes: number
  totalWorkloadNodes: number
  warnings: string[]
}

/**
 * Placement saved before the layout choice existed. Anything other than the old defaults means
 * the user tuned the split, so keep it; untouched defaults open as one cluster.
 */
export function normalizePlacementInputs(value: unknown): PlacementInputs {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<PlacementInputs>
  if (input.clusterLayout === 'single' || input.clusterLayout === 'split') return { ...DEFAULT_PLACEMENT_INPUTS, ...input }
  const tuned = (input.maxNodesPerCluster ?? 16) !== 16
    || (input.targetVmsPerCluster ?? 800) !== 800
    || (input.maxClusters ?? 32) !== 32
    || input.preserveSourceClusters === true
    || input.separateDatabaseTier === true
  return tuned
    ? { ...DEFAULT_PLACEMENT_INPUTS, ...input, clusterLayout: 'split' }
    : { ...DEFAULT_PLACEMENT_INPUTS, sanCapacityScope: input.sanCapacityScope ?? DEFAULT_PLACEMENT_INPUTS.sanCapacityScope }
}

/** Most nodes one cluster may have for this storage type. */
export function clusterNodeLimitFor(cfg: ClusterConfig): number {
  const ceiling = cfg.nodeCeiling && cfg.nodeCeiling > 0 ? cfg.nodeCeiling : Infinity
  return cfg.architecture === 'san'
    ? Math.min(LIMITS.CLUSTER_MAX_NODES, ceiling)
    : Math.min(LIMITS.S2D_MAX_NODES, RESILIENCY[cfg.resiliency].maxNodes, ceiling)
}

/** The node count the rest of the plan should use for the selected layout. */
export function plannedPlatformNodes(result: SizingResult, plan: MultiClusterPlan, inputs: Pick<PlacementInputs, 'clusterLayout'>): number {
  if (inputs.clusterLayout === 'split') return plan.feasible ? plan.totalNodes : 0
  return result.feasible ? result.nodes : 0
}

const weight = (vm: Vm) => vm.vCpu + vm.ramGiB / 4 + vm.storageGiB / 100
const unitWeight = (unit: Vm[], key: (vm: Vm) => number = weight) => unit.reduce((sum, vm) => sum + key(vm), 0)

interface PlacementUnit {
  vms: Vm[]
  /** The source cluster when the unit keeps one together. */
  source: string | null
}

function placementUnits(vms: Vm[], preserveSourceClusters: boolean): PlacementUnit[] {
  if (!preserveSourceClusters) return vms.map((vm) => ({ vms: [vm], source: null }))
  const groups = new Map<string, PlacementUnit>()
  vms.forEach((vm) => {
    const source = vm.sourceCluster?.trim() || null
    const key = source ?? `ungrouped-${vm.id}`
    const unit = groups.get(key) ?? { vms: [], source }
    unit.vms.push(vm)
    groups.set(key, unit)
  })
  return [...groups.values()]
}

/**
 * Packs units into count bins, largest first, each into the lightest bin that still has room under
 * the VM target. Several orders are tried (combined weight, then vCPU, memory and storage on their
 * own) because one greedy order can reject a packing that another finds.
 */
const PACKING_KEYS: Array<(vm: Vm) => number> = [weight, (vm) => vm.vCpu, (vm) => vm.ramGiB, (vm) => vm.storageGiB]

function distribute(units: PlacementUnit[], count: number, targetVms: number, key: (vm: Vm) => number): Vm[][] {
  const bins = Array.from({ length: count }, () => [] as Vm[])
  const binWeights = Array.from({ length: count }, () => 0)
  const sorted = [...units].sort((a, b) => unitWeight(b.vms, key) - unitWeight(a.vms, key) || b.vms.length - a.vms.length)
  sorted.forEach((unit) => {
    const open = bins.map((_, index) => index).filter((index) => bins[index].length + unit.vms.length <= targetVms)
    const pool = open.length > 0 ? open : bins.map((_, index) => index)
    const index = pool.reduce((best, candidate) => binWeights[candidate] < binWeights[best] ? candidate : best, pool[0])
    bins[index].push(...unit.vms)
    binWeights[index] += unitWeight(unit.vms, key)
  })
  return bins.filter((bin) => bin.length > 0)
}

interface PoolPlan { clusters: PlannedCluster[]; feasible: boolean; oversizedSources: string[] }

function planPool(
  purpose: string,
  vms: Vm[],
  cfg: ClusterConfig,
  tiers: Record<TierId, TierPolicy>,
  inputs: PlacementInputs,
  fixedManagementVms: Vm[] = [],
  maxClusters: number = inputs.maxClusters,
): PoolPlan {
  if (vms.length === 0 && fixedManagementVms.length === 0) return { clusters: [], feasible: true, oversizedSources: [] }
  const units = placementUnits(vms, inputs.preserveSourceClusters)
  const nodeCeiling = Math.min(inputs.maxNodesPerCluster, clusterNodeLimitFor(cfg))
  const fitsCluster = (result: SizingResult, vmCount: number) => result.feasible && result.nodes <= nodeCeiling && vmCount <= inputs.targetVmsPerCluster
  // A source cluster that cannot fit one target cluster on its own can never be kept together.
  const oversizedSources = inputs.preserveSourceClusters
    ? units.filter((unit) => unit.source && unit.vms.length > 1 && !fitsCluster(solveForward(cfg, unit.vms, tiers), unit.vms.length)).map((unit) => unit.source!)
    : []
  const build = (bins: Vm[][]): PlannedCluster[] => {
    if (bins.length === 0) bins.push([])
    // Management VMs stay together on one cluster of this pool: the lightest, so they fit best.
    const lightest = bins.reduce((best, bin, index) => unitWeight(bin) < unitWeight(bins[best]) ? index : best, 0)
    return bins.map((bin, index): PlannedCluster => {
      const management = index === lightest ? fixedManagementVms : []
      return {
        id: `${purpose.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${index + 1}`,
        name: `${purpose} ${index + 1}`,
        purpose,
        vms: [...bin, ...management],
        // Management VMs stay fixed while the workload grows, the same as in forecastGrowth.
        result: solveForward(cfg, bin, tiers, management),
        sourceClusters: [...new Set(bin.map((vm) => vm.sourceCluster).filter((value): value is string => !!value))],
        managementVmCount: management.length,
      }
    })
  }
  let last: PlannedCluster[] = []
  // Management VMs count as one more unit, so the ceiling can give them room of their own.
  const ceiling = Math.min(Math.max(1, maxClusters), Math.max(1, units.length + (fixedManagementVms.length > 0 ? 1 : 0)))
  for (let count = 1; count <= ceiling; count += 1) {
    const tried = new Set<string>()
    for (const key of PACKING_KEYS) {
      const bins = distribute(units, count, inputs.targetVmsPerCluster, key)
      // Management VMs are a unit too: with a cluster to spare they may have one of their own.
      if (fixedManagementVms.length > 0 && bins.length < count) bins.push([])
      const signature = bins.map((bin) => bin.map((vm) => vm.id).sort().join(',')).sort().join('|')
      if (tried.has(signature)) continue
      tried.add(signature)
      const candidate = build(bins)
      last = candidate
      if (candidate.every((cluster) => fitsCluster(cluster.result, cluster.vms.length))) return { clusters: candidate, feasible: true, oversizedSources }
    }
  }
  return { clusters: last, feasible: false, oversizedSources }
}

function planSingleCluster(
  cfg: ClusterConfig,
  included: Vm[],
  tiers: Record<TierId, TierPolicy>,
  fixedManagementVms: Vm[],
): MultiClusterPlan {
  if (included.length === 0 && fixedManagementVms.length === 0) {
    return { feasible: true, clusters: [], totalNodes: 0, totalWorkloadNodes: 0, warnings: [] }
  }
  const vms = [...included, ...fixedManagementVms]
  const result = solveForward(cfg, included, tiers, fixedManagementVms)
  const warnings: string[] = []
  if (!result.feasible) {
    warnings.push(result.nodesNeeded !== null && result.nodesNeeded > result.clusterNodeLimit
      ? `One cluster needs ${result.nodesNeeded} nodes, above the ${result.clusterNodeLimit}-node limit. Nothing has been split. ${overLimitAdvice(result, cfg)}`
      : result.bindingExplanation)
  }
  if (result.performanceAssessment.confidence !== 'high') warnings.push('At least one target cluster has less than high measured-data confidence; retain allocation fallback until coverage improves.')
  return {
    feasible: result.feasible,
    clusters: [{
      id: 'workload-cluster-1',
      name: 'Workload cluster 1',
      purpose: 'Workload cluster',
      vms,
      result,
      sourceClusters: [...new Set(included.map((vm) => vm.sourceCluster).filter((value): value is string => !!value))],
      managementVmCount: fixedManagementVms.length,
    }],
    totalNodes: result.feasible ? result.nodes : 0,
    totalWorkloadNodes: result.feasible ? result.workloadNodes : 0,
    warnings,
  }
}

export function planMultipleClusters(
  cfg: ClusterConfig,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
  requested: Partial<PlacementInputs> = {},
  fixedManagementVms: Vm[] = [],
): MultiClusterPlan {
  const inputs = { ...DEFAULT_PLACEMENT_INPUTS, ...requested }
  const included = vms.filter((vm) => vm.include)
  if (inputs.clusterLayout === 'single') return planSingleCluster(cfg, included, tiers, fixedManagementVms)
  const pools = inputs.separateDatabaseTier
    ? [
        { purpose: 'Database cluster', vms: included.filter((vm) => vm.tier === 'database') },
        { purpose: 'General cluster', vms: included.filter((vm) => vm.tier !== 'database') },
      ]
    : [{ purpose: 'Workload cluster', vms: included }]
  const managementPoolIndex = pools.findIndex((pool) => pool.purpose !== 'Database cluster')
  const managementFor = (index: number) => index === managementPoolIndex || managementPoolIndex < 0 && index === 0 ? fixedManagementVms : []
  // The maximum applies to all clusters together: each pool may use what the other pools leave.
  const nonEmpty = pools.map((pool, index) => pool.vms.length > 0 || managementFor(index).length > 0)
  const planned = pools.map((pool, index) => planPool(pool.purpose, pool.vms, cfg, tiers, inputs, managementFor(index),
    inputs.maxClusters - nonEmpty.filter((value, other) => value && other !== index).length))
  const clusters = planned.flatMap((pool) => pool.clusters)
  const totalWithinMax = clusters.length <= inputs.maxClusters
  const warnings: string[] = []
  if (inputs.preserveSourceClusters && included.some((vm) => !vm.sourceCluster)) warnings.push('VMs without a source-cluster value are treated as independent placement units.')
  if (inputs.preserveSourceClusters && inputs.separateDatabaseTier) {
    const sources = new Map<string, Set<string>>()
    included.forEach((vm) => {
      if (!vm.sourceCluster) return
      sources.set(vm.sourceCluster, new Set([...(sources.get(vm.sourceCluster) ?? []), vm.tier === 'database' ? 'database' : 'general']))
    })
    const split = [...sources.entries()].filter(([, kinds]) => kinds.size > 1).map(([name]) => name)
    const one = split.length === 1
    if (split.length > 0) warnings.push(`Database separation comes first, so ${one ? 'source cluster' : 'source clusters'} ${split.join(', ')} ${one ? 'is' : 'are'} split: ${one ? 'its' : 'their'} database VMs go to the database clusters and the rest stay together on the general clusters. Turn off database separation to keep ${one ? 'it' : 'them'} whole.`)
  }
  const oversized = [...new Set(planned.flatMap((pool) => pool.oversizedSources))]
  if (oversized.length > 0) {
    const one = oversized.length === 1
    warnings.push(`${one ? 'Source cluster' : 'Source clusters'} ${oversized.join(', ')} cannot fit one target cluster on ${one ? 'its' : 'their'} own under your ${Math.min(inputs.maxNodesPerCluster, clusterNodeLimitFor(cfg))}-node and ${inputs.targetVmsPerCluster.toLocaleString('en-US')}-VM ceilings, so ${one ? 'it' : 'they'} cannot be kept together. Turn off "Keep each source cluster together" or raise the ceilings.`)
  } else if (!planned.every((pool) => pool.feasible) || !totalWithinMax) {
    warnings.push(`The workload could not be placed within ${inputs.maxClusters} cluster${inputs.maxClusters === 1 ? '' : 's'} in total under the selected node and VM ceilings${inputs.separateDatabaseTier ? ', counting the database and general clusters together' : ''}. Increase the maximum, use denser hardware, or relax the grouping rules.`)
  }
  const sharedFixedSan = cfg.sanSizingMode !== 'calculated' && inputs.sanCapacityScope === 'shared' && cfg.architecture !== 's2d' && clusters.length > 1
  const sharedSanRequired = clusters.reduce((sum, cluster) => sum + cluster.result.requiredSanTiB, 0)
  const sharedSanAvailable = clusters[0]?.result.sanCapacityTiB ?? 0
  const sharedSanPasses = !sharedFixedSan || sharedSanRequired <= sharedSanAvailable
  if (!sharedSanPasses) warnings.push(`All target clusters share one SAN capacity pool, but they require ${sharedSanRequired.toFixed(1)} TiB and the configured array provides ${sharedSanAvailable.toFixed(1)} TiB effective. Expand the shared array or select per-cluster arrays.`)
  // One shared array serves every cluster, so its IOPS and throughput are shared too.
  const sumOf = (pick: (result: SizingResult) => number) => clusters.reduce((sum, cluster) => sum + pick(cluster.result), 0)
  const sharedIops = sumOf((result) => result.storagePerformance.requiredSanIops)
  const sharedThroughput = sumOf((result) => result.storagePerformance.requiredSanThroughputMBps)
  const arrayIops = clusters[0]?.result.storagePerformance.availableSanIops ?? null
  const arrayThroughput = clusters[0]?.result.storagePerformance.availableSanThroughputMBps ?? null
  const sharedPerformancePasses = !sharedFixedSan
    || ((arrayIops === null || sharedIops <= arrayIops) && (arrayThroughput === null || sharedThroughput <= arrayThroughput))
  const n0 = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (!sharedPerformancePasses) warnings.push(`All target clusters share one array: together they need ${n0(sharedIops)} IOPS and ${n0(sharedThroughput)} MB/s, and the array sustains ${arrayIops === null ? 'no entered IOPS limit' : `${n0(arrayIops)} IOPS`} and ${arrayThroughput === null ? 'no entered throughput limit' : `${n0(arrayThroughput)} MB/s`}. Add array performance or select per-cluster arrays.`)
  if (clusters.some((cluster) => cluster.result.performanceAssessment.confidence !== 'high')) warnings.push('At least one target cluster has less than high measured-data confidence; retain allocation fallback until coverage improves.')
  const feasible = planned.every((pool) => pool.feasible) && totalWithinMax && sharedSanPasses && sharedPerformancePasses

  return {
    feasible,
    clusters,
    totalNodes: clusters.reduce((sum, cluster) => sum + (cluster.result.feasible ? cluster.result.nodes : 0), 0),
    totalWorkloadNodes: clusters.reduce((sum, cluster) => sum + (cluster.result.feasible ? cluster.result.workloadNodes : 0), 0),
    warnings,
  }
}
