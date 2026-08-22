import { solveForward } from './solve'
import type { ClusterConfig, SizingResult, TierId, TierPolicy, Vm } from './types'

export interface PlacementInputs {
  maxNodesPerCluster: number
  targetVmsPerCluster: number
  preserveSourceClusters: boolean
  separateDatabaseTier: boolean
  maxClusters: number
  sanCapacityScope: 'shared' | 'per-cluster'
}

export const DEFAULT_PLACEMENT_INPUTS: PlacementInputs = {
  maxNodesPerCluster: 16,
  targetVmsPerCluster: 800,
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
      return {
        id: `${purpose.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${index + 1}`,
        name: `${purpose} ${index + 1}`,
        purpose,
        vms: plannedVms,
        result: solveForward(cfg, plannedVms, tiers),
        sourceClusters: [...new Set(bin.map((vm) => vm.sourceCluster).filter((value): value is string => !!value))],
        managementVmCount: management.length,
      }
    })
    last = candidate
    const fits = candidate.every((cluster) => cluster.result.feasible
      && cluster.result.nodes <= inputs.maxNodesPerCluster
      && cluster.vms.length <= inputs.targetVmsPerCluster)
    if (fits) return { clusters: candidate, feasible: true }
  }
  return { clusters: last, feasible: false }
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
  const sharedSanPasses = inputs.sanCapacityScope === 'per-cluster' || cfg.architecture === 's2d' || sharedSanRequired <= sharedSanAvailable
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
