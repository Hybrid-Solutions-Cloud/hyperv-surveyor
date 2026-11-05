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

function placementUnits(vms: Vm[], preserveSourceClusters: boolean): Vm[][] {
  if (!preserveSourceClusters) return vms.map((vm) => [vm])
  const groups = new Map<string, Vm[]>()
  vms.forEach((vm) => {
    const key = vm.sourceCluster?.trim() || `ungrouped-${vm.id}`
    groups.set(key, [...(groups.get(key) ?? []), vm])
  })
  return [...groups.values()]
}

function distribute(units: Vm[][], count: number): Vm[][] {
  const bins = Array.from({ length: count }, () => [] as Vm[])
  const binWeights = Array.from({ length: count }, () => 0)
  const sorted = [...units].sort((a, b) => b.reduce((sum, vm) => sum + weight(vm), 0) - a.reduce((sum, vm) => sum + weight(vm), 0))
  sorted.forEach((unit) => {
    const index = binWeights.indexOf(Math.min(...binWeights))
    bins[index].push(...unit)
    binWeights[index] += unit.reduce((sum, vm) => sum + weight(vm), 0)
  })
  return bins.filter((bin) => bin.length > 0)
}

function planPool(
  purpose: string,
  vms: Vm[],
  cfg: ClusterConfig,
  tiers: Record<TierId, TierPolicy>,
  inputs: PlacementInputs,
  fixedManagementVms: Vm[] = [],
): { clusters: PlannedCluster[]; feasible: boolean } {
  if (vms.length === 0 && fixedManagementVms.length === 0) return { clusters: [], feasible: true }
  const units = placementUnits(vms, inputs.preserveSourceClusters)
  let last: PlannedCluster[] = []
  const ceiling = Math.min(inputs.maxClusters, Math.max(1, units.length))
  for (let count = 1; count <= ceiling; count += 1) {
    const bins = distribute(units, count)
    if (bins.length === 0) bins.push([])
    const candidate = bins.map((bin, index): PlannedCluster => {
      const management = index === 0 ? fixedManagementVms : []
      const plannedVms = [...bin, ...management]
      // Management VMs stay fixed while the workload grows, the same as in forecastGrowth.
      return {
        id: `${purpose.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${index + 1}`,
        name: `${purpose} ${index + 1}`,
        purpose,
        vms: plannedVms,
        result: solveForward(cfg, bin, tiers, management),
        sourceClusters: [...new Set(bin.map((vm) => vm.sourceCluster).filter((value): value is string => !!value))],
        managementVmCount: management.length,
      }
    })
    last = candidate
    const fits = candidate.every((cluster) => cluster.result.feasible
      && cluster.result.nodes <= Math.min(inputs.maxNodesPerCluster, clusterNodeLimitFor(cfg))
      && cluster.vms.length <= inputs.targetVmsPerCluster)
    if (fits) return { clusters: candidate, feasible: true }
  }
  return { clusters: last, feasible: false }
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
  const planned = pools.map((pool, index) => planPool(pool.purpose, pool.vms, cfg, tiers, inputs, index === managementPoolIndex || managementPoolIndex < 0 && index === 0 ? fixedManagementVms : []))
  const clusters = planned.flatMap((pool) => pool.clusters)
  const warnings: string[] = []
  if (inputs.preserveSourceClusters && included.some((vm) => !vm.sourceCluster)) warnings.push('VMs without a source-cluster value are treated as independent placement units.')
  if (!planned.every((pool) => pool.feasible)) warnings.push(`The workload could not be placed within ${inputs.maxClusters} clusters under the selected node and VM ceilings. Increase the ceiling, use denser hardware, or relax source-cluster preservation.`)
  const sharedSanRequired = clusters.reduce((sum, cluster) => sum + cluster.result.requiredSanTiB, 0)
  const sharedSanAvailable = clusters[0]?.result.sanCapacityTiB ?? 0
  const sharedSanPasses = cfg.sanSizingMode === 'calculated' || inputs.sanCapacityScope === 'per-cluster' || cfg.architecture === 's2d' || sharedSanRequired <= sharedSanAvailable
  if (!sharedSanPasses) warnings.push(`All target clusters share one SAN capacity pool, but they require ${sharedSanRequired.toFixed(1)} TiB and the configured array provides ${sharedSanAvailable.toFixed(1)} TiB effective. Expand the shared array or select per-cluster arrays.`)
  if (clusters.some((cluster) => cluster.result.performanceAssessment.confidence !== 'high')) warnings.push('At least one target cluster has less than high measured-data confidence; retain allocation fallback until coverage improves.')
  return {
    feasible: planned.every((pool) => pool.feasible) && sharedSanPasses,
    clusters,
    totalNodes: clusters.reduce((sum, cluster) => sum + (cluster.result.feasible ? cluster.result.nodes : 0), 0),
    totalWorkloadNodes: clusters.reduce((sum, cluster) => sum + (cluster.result.feasible ? cluster.result.workloadNodes : 0), 0),
    warnings,
  }
}
