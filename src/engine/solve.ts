/**
 * The solver.
 *
 * FORWARD  workloads -> minimum node count, per storage architecture.
 * REVERSE  fixed hardware -> how much workload fits, and WHICH CONSTRAINT BINDS FIRST.
 *
 * One constraint model, two solve targets. Built this way deliberately: two separate code
 * paths would eventually disagree with each other, and a sizing tool that contradicts itself
 * is worse than no tool.
 *
 * The reason SAN and S2D produce different node counts for identical workloads:
 *   SAN  — node count is driven by COMPUTE ONLY. Array capacity is independent of N.
 *   S2D  — node count is driven by COMPUTE AND CAPACITY TOGETHER. Every node is also storage,
 *          and parity efficiency itself improves with N, so capacity must be re-evaluated at
 *          each candidate N rather than divided once.
 */
import { LIMITS, RESILIENCY, SRC, TIER_IDS } from './rules'
import {
  computeDemand, giBToTiB, licensableCores, mergeDemand, requiredStorageGiB,
  usableCoresPerHost, usableRamPerHost,
} from './compute'
import { s2dCapacity, sanCapacityTiB, sanFreeSpaceTarget } from './capacity'
import { planCsvs, totalCsvCount } from './csv'
import { growthFactorForYear, resolveGrowthPlan, type GrowthPlan } from './growth'
import { hasErrors, validateDesign, VM_LARGER_THAN_HOST } from './validate'
import { assessPerformanceData } from './performance'
import type {
  BindingConstraint, ClusterConfig, ComputeDemand, Finding, ReverseResult, ReverseStatus, SanSizing,
  SizingResult, TierId, TierPolicy, Vm,
} from './types'

function maxNodesFor(cfg: ClusterConfig): number {
  if (cfg.architecture === 'san') return LIMITS.CLUSTER_MAX_NODES
  return Math.min(LIMITS.S2D_MAX_NODES, RESILIENCY[cfg.resiliency].maxNodes)
}

function minNodesFor(cfg: ClusterConfig): number {
  if (cfg.architecture === 'san') return 2
  return Math.max(LIMITS.S2D_MIN_NODES, RESILIENCY[cfg.resiliency].minNodes)
}

function hybridS2dShareForTier(cfg: ClusterConfig, policy: TierPolicy): number {
  const placement = policy.hybridPlacement ?? (policy.storageTier === 'performance' ? 's2d' : 'san')
  return placement === 's2d' ? 1 : placement === 'san' ? 0 : cfg.hybridS2dShare
}

function storagePerformanceDemand(
  cfg: ClusterConfig,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
  growthFactor: number,
  fixedVms: Vm[] = [],
) {
  let requiredS2dIops = 0
  let requiredS2dThroughputMBps = 0
  let requiredSanIops = 0
  let requiredSanThroughputMBps = 0
  let measured = 0
  let included = 0
  const add = (vm: Vm, factor: number) => {
    if (!vm.include) return
    included += 1
    const iops = vm.performance?.storageIopsP95
    const throughput = vm.performance?.storageThroughputMBpsP95
    if (iops === undefined && throughput === undefined) return
    // Coverage needs both figures, matching the performance assessment. One still counts as demand.
    if (iops !== undefined && throughput !== undefined) measured += 1
    const s2dShare = cfg.architecture === 's2d' ? 1 : cfg.architecture === 'san' ? 0 : hybridS2dShareForTier(cfg, tiers[vm.tier])
    requiredS2dIops += (iops ?? 0) * s2dShare * factor
    requiredS2dThroughputMBps += (throughput ?? 0) * s2dShare * factor
    requiredSanIops += (iops ?? 0) * (1 - s2dShare) * factor
    requiredSanThroughputMBps += (throughput ?? 0) * (1 - s2dShare) * factor
  }
  vms.forEach((vm) => add(vm, growthFactor))
  fixedVms.forEach((vm) => add(vm, 1))
  return {
    requiredS2dIops,
    requiredS2dThroughputMBps,
    requiredSanIops,
    requiredSanThroughputMBps,
    measuredVmCoveragePct: included > 0 ? (measured / included) * 100 : 0,
  }
}

type StoragePerformanceDemand = ReturnType<typeof storagePerformanceDemand>

/** What the entered storage can sustain at a node count. Null means no figure was entered. */
function storagePerformanceCapability(cfg: ClusterConfig, nodes: number) {
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'
  const usesSan = cfg.architecture === 'san' || cfg.architecture === 'hybrid'
  const perNode = (value: number | undefined) => usesS2d && (value ?? 0) > 0 ? value! * nodes : null
  const array = (value: number | undefined) => usesSan && (value ?? 0) > 0 ? value! : null
  return {
    availableS2dIops: perNode(cfg.node.s2dIopsPerNode),
    availableS2dThroughputMBps: perNode(cfg.node.s2dThroughputMBpsPerNode),
    availableSanIops: array(cfg.san.maxIops),
    availableSanThroughputMBps: array(cfg.san.maxThroughputMBps),
  }
}

type StoragePerformanceCapability = ReturnType<typeof storagePerformanceCapability>

const withinLimit = (required: number, available: number | null) => available === null || required <= available
const shareOf = (required: number, available: number | null) => available !== null && available > 0 ? required / available : 0

function s2dPerformanceWithin(need: StoragePerformanceDemand, have: StoragePerformanceCapability): boolean {
  return withinLimit(need.requiredS2dIops, have.availableS2dIops) && withinLimit(need.requiredS2dThroughputMBps, have.availableS2dThroughputMBps)
}

function sanPerformanceWithin(need: StoragePerformanceDemand, have: StoragePerformanceCapability): boolean {
  return withinLimit(need.requiredSanIops, have.availableSanIops) && withinLimit(need.requiredSanThroughputMBps, have.availableSanThroughputMBps)
}

function storagePerformanceShare(need: StoragePerformanceDemand, have: StoragePerformanceCapability): number {
  return Math.max(
    shareOf(need.requiredS2dIops, have.availableS2dIops),
    shareOf(need.requiredS2dThroughputMBps, have.availableS2dThroughputMBps),
    shareOf(need.requiredSanIops, have.availableSanIops),
    shareOf(need.requiredSanThroughputMBps, have.availableSanThroughputMBps),
  )
}

const SAN_PERFORMANCE_MESSAGE = 'Measured SAN IOPS or throughput demand exceeds the entered sustainable array capability.'
const s2dPerformanceMessage = (nodes: number) => `Measured S2D IOPS or throughput demand cannot be satisfied within ${nodes} nodes using the entered per-node capability.`
const PERFORMANCE_CODES = ['SAN_PERFORMANCE_EXCEEDED', 'S2D_PERFORMANCE_EXCEEDED']

/** A fixed array above its free-space target is a warning. Only above 100% does the design fail. */
function fixedSanFreeSpaceFinding(cfg: ClusterConfig, requiredTiB: number, availableTiB: number): Finding | null {
  const target = sanFreeSpaceTarget(cfg)
  if (availableTiB <= 0 || requiredTiB > availableTiB || requiredTiB <= availableTiB * (1 - target)) return null
  return {
    severity: 'warning',
    code: 'SAN_FREE_SPACE_TARGET',
    message: `The array would be ${((requiredTiB / availableTiB) * 100).toFixed(1)}% full, above the ${((1 - target) * 100).toFixed(0)}% implied by the ${(target * 100).toFixed(0)}% free-space target. It still fits, but the target needs ${(requiredTiB / (1 - target)).toFixed(1)} TiB effective against ${availableTiB.toFixed(1)} TiB available.`,
    basis: 'TOOL',
  }
}

/** Workload demand grows; fixed VMs such as the management plane do not. */
function combinedDemand(
  cfg: ClusterConfig,
  vms: Vm[],
  fixedVms: Vm[],
  tiers: Record<TierId, TierPolicy>,
  growthFactor: number,
): ComputeDemand {
  const grown = computeDemand(vms, tiers, growthFactor, cfg)
  return fixedVms.length > 0 ? mergeDemand(grown, computeDemand(fixedVms, tiers, 1, cfg)) : grown
}

const plannedVmTotal = (demand: ComputeDemand) => TIER_IDS.reduce((sum, id) => sum + demand.byTier[id].plannedVms, 0)

/** Storage the S2D domain must carry, in TiB. In hybrid, only the S2D share. */
function s2dRequiredTiB(cfg: ClusterConfig, demand: ComputeDemand, tiers: Record<TierId, TierPolicy>): number {
  const totalTiB = giBToTiB(requiredStorageGiB(demand))
  if (cfg.architecture === 's2d') return totalTiB
  if (cfg.architecture === 'hybrid') {
    return TIER_IDS.reduce((sum, id) => sum + giBToTiB(demand.byTier[id].storageGiB) * hybridS2dShareForTier(cfg, tiers[id]), 0)
  }
  return 0
}

function sanRequiredTiB(cfg: ClusterConfig, demand: ComputeDemand, tiers: Record<TierId, TierPolicy>): number {
  const totalTiB = giBToTiB(requiredStorageGiB(demand))
  if (cfg.architecture === 'san') return totalTiB
  if (cfg.architecture === 'hybrid') {
    return TIER_IDS.reduce((sum, id) => sum + giBToTiB(demand.byTier[id].storageGiB) * (1 - hybridS2dShareForTier(cfg, tiers[id])), 0)
  }
  return 0
}

/** Search limit for "how many nodes would this take", deliberately far above any cluster limit. */
const UNBOUNDED_NODE_SEARCH = 2048

function calculatedSanSizing(cfg: ClusterConfig, requiredTiB: number): SanSizing | null {
  if (cfg.sanSizingMode !== 'calculated') return null
  if (cfg.architecture !== 'san' && cfg.architecture !== 'hybrid') return null
  const freeSpaceTargetPct = sanFreeSpaceTarget(cfg)
  const drr = Math.max(1, cfg.san.drr)
  const effectiveTiB = requiredTiB / (1 - freeSpaceTargetPct)
  return { requiredTiB, freeSpaceTargetPct, drr, effectiveTiB, usableToBuyTiB: effectiveTiB / drr }
}

function solveForwardAtGrowthFactor(
  cfg: ClusterConfig,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
  growthFactor: number,
  fixedVms: Vm[] = [],
): SizingResult {
  const demand = combinedDemand(cfg, vms, fixedVms, tiers, growthFactor)
  const allVms = fixedVms.length > 0 ? [...vms, ...fixedVms] : vms
  const plannedVms = plannedVmTotal(demand)
  const coresPerHost = usableCoresPerHost(cfg.node, cfg)
  const ramPerHost = usableRamPerHost(cfg.node, cfg)
  const spare = cfg.spareNodes
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'

  // Independent single-constraint node counts. These drive the "what actually bound" answer.
  const nodesIfCpuOnly =
    coresPerHost > 0 ? Math.ceil(demand.requiredPCores / coresPerHost) + spare : Infinity
  const nodesIfMemoryOnly =
    ramPerHost > 0 ? Math.ceil(demand.requiredRamGiB / ramPerHost) + spare : Infinity
  const nodesIfVmCountOnly = Math.ceil(plannedVms / LIMITS.MAX_VMS_PER_HOST) + spare

  const needS2dTiB = s2dRequiredTiB(cfg, demand, tiers)
  const needSanTiB = sanRequiredTiB(cfg, demand, tiers)
  const storagePerformanceDemandValue = storagePerformanceDemand(cfg, vms, tiers, growthFactor, fixedVms)
  const sanSizing = calculatedSanSizing(cfg, needSanTiB)
  const sanAvailable = cfg.architecture === 'san' || cfg.architecture === 'hybrid'
    ? sanSizing?.effectiveTiB ?? sanCapacityTiB(cfg.san) : null
  const sanCapacityOk = sanAvailable === null || sanAvailable >= needSanTiB
  const sanPerformanceOk = sanPerformanceWithin(storagePerformanceDemandValue, storagePerformanceCapability(cfg, 1))
  const sanOk = sanCapacityOk && sanPerformanceOk
  const s2dPerformanceOk = (nodes: number) => s2dPerformanceWithin(storagePerformanceDemandValue, storagePerformanceCapability(cfg, nodes))

  let nodesIfStorageOnly = sanOk ? minNodesFor(cfg) : Infinity
  let nodesIfS2dStorageOnly = minNodesFor(cfg)
  if (usesS2d) {
    let found = Infinity
    for (let n = minNodesFor(cfg); n <= maxNodesFor(cfg); n++) {
      if (s2dCapacity(cfg, n).usableTiB >= needS2dTiB && s2dPerformanceOk(n)) { found = n; break }
    }
    nodesIfS2dStorageOnly = found
    nodesIfStorageOnly = sanOk ? found : Infinity
  }

  const min = minNodesFor(cfg)
  const max = maxNodesFor(cfg)

  let nodes = Infinity
  for (let n = min; n <= max; n++) {
    const workload = n - spare
    if (workload < 1) continue
    const cpuOk = demand.requiredPCores <= workload * coresPerHost
    const ramOk = demand.requiredRamGiB <= workload * ramPerHost
    const vmCountOk = plannedVms <= workload * LIMITS.MAX_VMS_PER_HOST
    const s2dOk = !usesS2d || (s2dCapacity(cfg, n).usableTiB >= needS2dTiB && s2dPerformanceOk(n))
    if (cpuOk && ramOk && vmCountOk && s2dOk && sanOk) { nodes = n; break }
  }

  const resourceFeasible = Number.isFinite(nodes)
  const finalNodes = resourceFeasible ? nodes : max
  const nodeFloor = Math.max(min, spare + 1)
  const computeNodes = Math.max(nodeFloor, nodesIfCpuOnly, nodesIfMemoryOnly, nodesIfVmCountOnly)
  let computeNodesNeeded: number | null = Number.isFinite(computeNodes) ? computeNodes : null
  let nodesNeeded: number | null = resourceFeasible ? nodes : null
  // Hosts cannot fix a fixed array, so no node count works when the SAN falls short.
  if (!resourceFeasible && sanOk) {
    let storageNodes = min
    if (usesS2d) {
      storageNodes = Infinity
      for (let n = min; n <= UNBOUNDED_NODE_SEARCH; n++) {
        if (s2dCapacity(cfg, n).usableTiB >= needS2dTiB && s2dPerformanceOk(n)) { storageNodes = n; break }
      }
    }
    const needed = Math.max(computeNodes, storageNodes)
    nodesNeeded = Number.isFinite(needed) ? needed : null
  }
  const workloadNodes = Math.max(0, finalNodes - spare)

  // Which constraint bound? The largest single-constraint count that really needs its nodes. A count
  // equal to the floor needs them only if it uses more than one workload node. S2D storage is searched
  // upward from the floor, so a storage count at the floor says nothing about needing it.
  const needsNodes = (count: number, demanded: boolean) => demanded
    && (count > nodeFloor || (count === nodeFloor && count - spare >= 2))
  const candidates: Array<[BindingConstraint, number]> = [
    ['cpu', needsNodes(nodesIfCpuOnly, demand.requiredPCores > 0) ? nodesIfCpuOnly : -Infinity],
    ['memory', needsNodes(nodesIfMemoryOnly, demand.requiredRamGiB > 0) ? nodesIfMemoryOnly : -Infinity],
    ['vm-count', needsNodes(nodesIfVmCountOnly, plannedVms > 0) ? nodesIfVmCountOnly : -Infinity],
    ['storage', !sanOk || (usesS2d && nodesIfStorageOnly > nodeFloor) ? nodesIfStorageOnly : -Infinity],
    ['node-floor', nodeFloor],
  ]
  candidates.sort((a, b) => b[1] - a[1])
  const binding: BindingConstraint = candidates[0][0]
  let bindingExplanation = ''

  const cap = usesS2d ? s2dCapacity(cfg, finalNodes) : null
  const performanceCapability = storagePerformanceCapability(cfg, finalNodes)
  const performanceUtilisation = storagePerformanceShare(storagePerformanceDemandValue, performanceCapability)
  // S2D storage bound on performance when capacity alone would have fitted on one node fewer.
  const s2dBoundByPerformance = nodesIfS2dStorageOnly > min && Number.isFinite(nodesIfS2dStorageOnly)
    && s2dCapacity(cfg, nodesIfS2dStorageOnly - 1).usableTiB >= needS2dTiB

  if (!resourceFeasible) {
    const reasons: string[] = []
    const options: string[] = []
    // When the spares alone use up the node limit, a bigger server cannot help.
    const sparesExhaustLimit = spare + 1 > max
    const computeOverLimit = (count: number) => !sparesExhaustLimit && count > max
    if (sparesExhaustLimit) {
      reasons.push(`N+${spare} leaves no workload node within the ${max}-node limit for this storage design`)
      options.push('reduce the spare nodes or choose a resiliency that allows more nodes')
    }
    if (coresPerHost <= 0) {
      reasons.push('each node has 0 usable CPU cores, so no node count can carry the workload')
      options.push('correct Sockets, Cores / socket, or CPU reserve %')
    } else if (computeOverLimit(nodesIfCpuOnly)) {
      reasons.push(`CPU alone needs ${nodesIfCpuOnly} nodes`)
    }
    if (ramPerHost <= 0) {
      reasons.push('each node has 0 usable GiB of RAM, so no node count can carry the workload')
      options.push('correct RAM per node or the RAM reserve')
    } else if (computeOverLimit(nodesIfMemoryOnly)) {
      reasons.push(`memory alone needs ${nodesIfMemoryOnly} nodes`)
    }
    if (computeOverLimit(nodesIfVmCountOnly)) {
      reasons.push(`${plannedVms} VMs at ${LIMITS.MAX_VMS_PER_HOST} VMs per host need ${nodesIfVmCountOnly} nodes`)
      options.push(usesS2d ? 'use SAN-only storage (limit 64 nodes) or split into multiple clusters' : 'split into multiple clusters')
    }
    if ((coresPerHost > 0 && computeOverLimit(nodesIfCpuOnly)) || (ramPerHost > 0 && computeOverLimit(nodesIfMemoryOnly))) {
      options.push(usesS2d ? 'use a larger server, use SAN-only storage (limit 64 nodes), or split into multiple clusters' : 'use a larger server or split into multiple clusters')
    }
    const s2dOverLimit = usesS2d && !Number.isFinite(nodesIfS2dStorageOnly)
    if (s2dOverLimit) {
      const capacityPassesAtCeiling = s2dCapacity(cfg, max).usableTiB >= needS2dTiB
      reasons.push(capacityPassesAtCeiling
        ? `measured S2D IOPS or throughput exceeds the entered sustainable capability within ${max} nodes`
        : `S2D capacity cannot be satisfied within ${max} nodes at ${cap ? (cap.efficiency * 100).toFixed(1) : '?'}% efficiency`)
      options.push(capacityPassesAtCeiling
        ? 'revalidate the entered S2D performance figures or split into multiple clusters'
        : 'add or enlarge capacity drives, choose a more capacity-efficient resiliency, or split into multiple clusters')
    }
    if (!sanCapacityOk && sanAvailable !== null) {
      reasons.push(`SAN capacity provides ${sanAvailable.toFixed(1)} TiB effective but ${needSanTiB.toFixed(1)} TiB is required`)
    }
    if (!sanCapacityOk) options.push('increase the array size or data reduction ratio')
    if (!sanPerformanceOk) {
      reasons.push('measured SAN IOPS or throughput demand exceeds the entered sustainable array capability')
      options.push('revalidate the entered array performance figures')
    }
    // Say "cluster" and the ceiling only when the node limit is really what stands in the way.
    const nodeLimited = sparesExhaustLimit || s2dOverLimit || computeOverLimit(nodesIfCpuOnly) || computeOverLimit(nodesIfMemoryOnly) || computeOverLimit(nodesIfVmCountOnly)
    const computeNote = !sanOk && computeNodesNeeded !== null
      ? ` Compute alone needs ${computeNodesNeeded} nodes; adding hosts does not change the array.`
      : ''
    bindingExplanation = `Not feasible${nodeLimited ? ' in a single cluster' : ''}: ${reasons.join('; ')}.${nodeLimited ? ` Ceiling is ${max} nodes${usesS2d ? ' because S2D is enabled' : ''}.` : ''} To resolve this: ${[...new Set(options)].join('; ')}.${computeNote}`
  } else {
    switch (binding) {
      case 'cpu':
        bindingExplanation = `CPU-bound. ${demand.requiredPCores.toFixed(0)} physical cores required across ${workloadNodes} workload nodes at ${coresPerHost.toFixed(0)} usable cores each. Memory alone would need ${nodesIfMemoryOnly} nodes${usesS2d ? `, storage alone ${nodesIfStorageOnly}` : ''}.`
        break
      case 'memory':
        bindingExplanation = `Memory-bound. ${demand.requiredRamGiB.toFixed(0)} GiB required across ${workloadNodes} workload nodes at ${ramPerHost.toFixed(0)} GiB usable each. CPU alone would need ${nodesIfCpuOnly} nodes${usesS2d ? `, storage alone ${nodesIfStorageOnly}` : ''}.`
        break
      case 'vm-count':
        bindingExplanation = `VM-count-bound. ${plannedVms} VMs need ${workloadNodes} workload nodes at the ${LIMITS.MAX_VMS_PER_HOST} VMs per host maximum.`
        break
      case 'storage':
        bindingExplanation = s2dBoundByPerformance
          ? `Storage-bound (performance). Measured IOPS or throughput consumes ${(performanceUtilisation * 100).toFixed(1)}% of the entered sustainable capability. Compute alone would need ${Math.max(nodesIfCpuOnly, nodesIfMemoryOnly)} nodes. Validate peak concurrency and target performance with a proof of concept.`
          : `Storage-bound (capacity). ${needS2dTiB.toFixed(1)} TiB required on S2D and ${cap?.efficiencyLabel} yields ${((cap?.efficiency ?? 0) * 100).toFixed(1)}% efficiency. Compute alone would need ${Math.max(nodesIfCpuOnly, nodesIfMemoryOnly)} nodes.`
        break
      default:
        bindingExplanation = `Node-floor-bound. The workload fits in fewer nodes, but ${nodeFloor} is the minimum for this architecture and N+${spare} resiliency.`
    }
  }

  const csvPlans = planCsvs(cfg, demand, tiers, finalNodes)
  const findings = validateDesign(cfg, finalNodes, allVms, tiers, csvPlans, plannedVms)
  const storagePerformance = {
    ...storagePerformanceDemandValue,
    ...performanceCapability,
    validated: storagePerformanceDemandValue.measuredVmCoveragePct >= 80
      && (!usesS2d || (performanceCapability.availableS2dIops !== null && performanceCapability.availableS2dThroughputMBps !== null))
      && (!(cfg.architecture === 'san' || cfg.architecture === 'hybrid') || (performanceCapability.availableSanIops !== null && performanceCapability.availableSanThroughputMBps !== null)),
  }
  if (!storagePerformance.validated) findings.push({ severity: 'warning', code: 'STORAGE_PERFORMANCE_UNVALIDATED', message: `Storage capacity is calculated, but end-to-end performance is not fully validated. Measured IOPS/throughput coverage is ${storagePerformance.measuredVmCoveragePct.toFixed(0)}%; enter sustainable target capabilities for every active storage domain.`, basis: 'TOOL' })
  if (!sanPerformanceOk) findings.push({ severity: 'error', code: 'SAN_PERFORMANCE_EXCEEDED', message: SAN_PERFORMANCE_MESSAGE, basis: 'TOOL' })
  if (usesS2d && !s2dPerformanceOk(finalNodes)) findings.push({ severity: 'error', code: 'S2D_PERFORMANCE_EXCEEDED', message: s2dPerformanceMessage(finalNodes), basis: 'TOOL' })
  if (!sanSizing && sanAvailable !== null) {
    const freeSpace = fixedSanFreeSpaceFinding(cfg, needSanTiB, sanAvailable)
    if (freeSpace) findings.push(freeSpace)
  }
  const feasible = resourceFeasible && !hasErrors(findings)
  // A VM larger than one host does not get better with more of the same host.
  if (findings.some((finding) => finding.code === VM_LARGER_THAN_HOST)) {
    nodesNeeded = null
    computeNodesNeeded = null
  }
  if (resourceFeasible && !feasible) {
    const blockers = findings.filter((finding) => finding.severity === 'error').map((finding) => finding.message)
    bindingExplanation = `Design is not feasible until hard validation errors are resolved: ${blockers.join('; ')}`
  }

  return {
    architecture: cfg.architecture,
    resiliency: cfg.resiliency,
    feasible,
    nodes: finalNodes,
    workloadNodes,
    nodesNeeded,
    computeNodesNeeded,
    clusterNodeLimit: max,
    sanSizing,
    binding,
    bindingExplanation,
    nodesIfCpuOnly,
    nodesIfMemoryOnly,
    nodesIfStorageOnly,
    demand,
    capacity: cap,
    sanCapacityTiB: sanAvailable,
    requiredStorageTiB: giBToTiB(requiredStorageGiB(demand)),
    requiredS2dTiB: needS2dTiB,
    requiredSanTiB: needSanTiB,
    csvPlans,
    totalCsvs: totalCsvCount(csvPlans),
    findings,
    utilisationCeiling: finalNodes > 0 ? workloadNodes / finalNodes : 0,
    resiliencyOverheadPct: finalNodes > 0 ? (spare / finalNodes) * 100 : 0,
    licensableCoresPerNode: licensableCores(cfg.node),
    totalLicensableCores: licensableCores(cfg.node) * finalNodes,
    performanceAssessment: assessPerformanceData(allVms, cfg),
    storagePerformance,
  }
}

/**
 * Forward sizing. fixedVms, such as a management plane, are carried at their planned size: they do
 * not grow with the workload, here or in forecastGrowth, so the two always agree.
 */
export function solveForward(
  cfg: ClusterConfig,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
  fixedVms: Vm[] = [],
): SizingResult {
  return solveForwardAtGrowthFactor(cfg, vms, tiers, resolveGrowthPlan(cfg).currentDesignGrowthFactor, fixedVms)
}

export interface GrowthForecastPoint {
  year: number
  demandFactor: number
  result: SizingResult
  additionalNodes: number | null
}

export interface GrowthForecast {
  plan: GrowthPlan
  points: GrowthForecastPoint[]
  currentRequiredNodes: number | null
  plannedNodesToday: number | null
}

/**
 * Forecasts compound workload growth. Optional fixed VMs (for example the current management
 * plane) remain constant while the imported workload grows. Growth means more demand, not larger
 * VMs: per-VM checks such as NUMA spanning and host fit always see the VM as configured.
 */
export function forecastGrowth(
  cfg: ClusterConfig,
  workloadVms: Vm[],
  tiers: Record<TierId, TierPolicy>,
  fixedVms: Vm[] = [],
): GrowthForecast {
  const plan = resolveGrowthPlan(cfg)
  let previousNodes: number | null = null
  const points = Array.from({ length: plan.horizonYears + 1 }, (_, year): GrowthForecastPoint => {
    const demandFactor = growthFactorForYear(plan, year)
    const result = solveForwardAtGrowthFactor(cfg, workloadVms, tiers, demandFactor, fixedVms)
    const nodes = result.feasible ? result.nodes : null
    const additionalNodes = nodes === null
      ? null
      : previousNodes === null
        ? nodes
        : Math.max(0, nodes - previousNodes)
    previousNodes = nodes
    return { year, demandFactor, result, additionalNodes }
  })
  const first = points[0].result
  const terminal = points[points.length - 1].result
  return {
    plan,
    points,
    currentRequiredNodes: first.feasible ? first.nodes : null,
    plannedNodesToday: plan.strategy === 'build-now'
      ? terminal.feasible ? terminal.nodes : null
      : first.feasible ? first.nodes : null,
  }
}

/** Reverse mode: fixed hardware, solve for headroom and the first binding constraint. */
export function solveReverse(
  cfg: ClusterConfig,
  nodes: number,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
  fixedVms: Vm[] = [],
): ReverseResult {
  const growthFactor = resolveGrowthPlan(cfg).currentDesignGrowthFactor
  // The per-VM profiles below describe a further workload VM, so they exclude fixed VMs.
  const workloadDemand = computeDemand(vms, tiers, growthFactor, cfg)
  const demand = combinedDemand(cfg, vms, fixedVms, tiers, growthFactor)
  const allVms = fixedVms.length > 0 ? [...vms, ...fixedVms] : vms
  const workloadNodes = Math.max(0, nodes - cfg.spareNodes)
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'

  const availablePCores = workloadNodes * usableCoresPerHost(cfg.node, cfg)
  const availableRamGiB = workloadNodes * usableRamPerHost(cfg.node, cfg)

  const cap = usesS2d ? s2dCapacity(cfg, nodes) : null
  let availableStorageTiB = 0
  if (cfg.architecture === 'san') availableStorageTiB = sanCapacityTiB(cfg.san)
  else if (cfg.architecture === 's2d') availableStorageTiB = cap?.usableTiB ?? 0
  else availableStorageTiB = (cap?.usableTiB ?? 0) + sanCapacityTiB(cfg.san)

  const usedS2dTiB = s2dRequiredTiB(cfg, demand, tiers)
  const usedSanTiB = sanRequiredTiB(cfg, demand, tiers)
  const usedStorageTiB = usedS2dTiB + usedSanTiB
  // Nothing used of nothing available is 0%, not full.
  const share = (used: number, available: number) => available > 0 ? used / available : used > 0 ? 1 : 0
  const storageDomains: ReverseResult['storageDomains'] = []
  if (usesS2d) {
    const available = cap?.usableTiB ?? 0
    const headroomTiB = available - usedS2dTiB
    storageDomains.push({ domain: 's2d', availableTiB: available, usedTiB: usedS2dTiB, headroomTiB, utilisationPct: share(usedS2dTiB, available) * 100, freeSpaceTargetPct: 0, headroomToTargetTiB: headroomTiB })
  }
  if (cfg.architecture === 'san' || cfg.architecture === 'hybrid') {
    const available = sanCapacityTiB(cfg.san)
    const target = sanFreeSpaceTarget(cfg)
    storageDomains.push({ domain: 'san', availableTiB: available, usedTiB: usedSanTiB, headroomTiB: available - usedSanTiB, utilisationPct: share(usedSanTiB, available) * 100, freeSpaceTargetPct: target, headroomToTargetTiB: available * (1 - target) - usedSanTiB })
  }

  const headroomPCores = availablePCores - demand.requiredPCores
  const headroomRamGiB = availableRamGiB - demand.requiredRamGiB
  // Domains cannot lend each other space, so one short domain leaves no overall spare storage.
  const storageShortfallTiB = storageDomains.reduce((sum, domain) => sum + Math.min(0, domain.headroomTiB), 0)
  const headroomStorageTiB = storageShortfallTiB < 0 ? storageShortfallTiB : availableStorageTiB - usedStorageTiB

  const performanceDemand = storagePerformanceDemand(cfg, vms, tiers, growthFactor, fixedVms)
  const performanceCapability = storagePerformanceCapability(cfg, nodes)
  const sanPerformanceOk = sanPerformanceWithin(performanceDemand, performanceCapability)
  const s2dPerformanceOk = s2dPerformanceWithin(performanceDemand, performanceCapability)
  const pctPerformance = storagePerformanceShare(performanceDemand, performanceCapability)

  const pctCpu = share(demand.requiredPCores, availablePCores)
  const pctRam = share(demand.requiredRamGiB, availableRamGiB)
  const pctCapacity = storageDomains.length > 0 ? Math.max(...storageDomains.map((domain) => domain.utilisationPct / 100)) : 0
  const pctSto = Math.max(pctCapacity, pctPerformance)

  let worstResource: BindingConstraint = 'cpu'
  let worst = pctCpu
  if (pctRam > worst) { worstResource = 'memory'; worst = pctRam }
  if (pctSto > worst) { worstResource = 'storage'; worst = pctSto }
  const noWorkload = demand.vmCount === 0
  const binding: BindingConstraint = noWorkload ? 'none' : worstResource

  // The same comparisons forward sizing makes, so the two agree at exactly 100%.
  const over = demand.requiredPCores > availablePCores
    || demand.requiredRamGiB > availableRamGiB
    || storageDomains.some((domain) => domain.usedTiB > domain.availableTiB)
    || !sanPerformanceOk
    || !s2dPerformanceOk

  const csvPlans = planCsvs(cfg, demand, tiers, nodes)
  const findings = validateDesign(cfg, nodes, allVms, tiers, csvPlans, plannedVmTotal(demand))
  if (!sanPerformanceOk) findings.push({ severity: 'error', code: 'SAN_PERFORMANCE_EXCEEDED', message: SAN_PERFORMANCE_MESSAGE, basis: 'TOOL' })
  if (!s2dPerformanceOk) findings.push({ severity: 'error', code: 'S2D_PERFORMANCE_EXCEEDED', message: s2dPerformanceMessage(nodes), basis: 'TOOL' })
  if (cfg.architecture === 'san' || cfg.architecture === 'hybrid') {
    const freeSpace = fixedSanFreeSpaceFinding(cfg, usedSanTiB, sanCapacityTiB(cfg.san))
    if (freeSpace) findings.push(freeSpace)
  }
  const blockers = findings
    .filter((finding) => finding.severity === 'error' && !PERFORMANCE_CODES.includes(finding.code))
    .map((finding) => finding.message)

  const status: ReverseStatus = blockers.length > 0 ? 'blocked' : noWorkload ? 'no-workload' : over ? 'over' : 'fits'
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  const resourceLabel = worstResource === 'cpu'
    ? 'CPU'
    : worstResource === 'memory'
      ? 'Memory'
      : pctPerformance > pctCapacity ? 'Storage performance' : 'Storage'
  const usageSummary = `CPU ${pct(pctCpu)} · Memory ${pct(pctRam)} · Storage ${pct(pctSto)}.`
  const blockerText = blockers.length > 0 ? ` This design is not valid as entered: ${blockers.join(' ')}` : ''
  const headline = status === 'blocked'
    ? 'Not valid as entered'
    : status === 'no-workload'
      ? 'Capacity only: no workloads yet'
      : status === 'over'
        ? `${resourceLabel} exceeds this hardware`
        : `${resourceLabel} binds first`
  let bindingExplanation: string
  if (noWorkload) {
    bindingExplanation = `No workloads are included, so nothing is consumed yet. Capacity is ${availablePCores.toFixed(1)} physical cores, ${availableRamGiB.toFixed(0)} GiB of memory and ${availableStorageTiB.toFixed(1)} TiB of storage.${blockerText}`
  } else if (over) {
    bindingExplanation = `${resourceLabel} binds first at ${pct(worst)} consumed. ${usageSummary} This hardware cannot carry the stated workload.${blockerText}`
  } else if (status === 'blocked') {
    bindingExplanation = `${usageSummary}${blockerText}`
  } else {
    bindingExplanation = `${resourceLabel} binds first at ${pct(worst)} consumed. ${usageSummary} ${worst >= 1 ? 'No headroom remains.' : `Headroom before the first constraint is exhausted: ${pct(1 - worst)}.`}`
  }

  // "How many more VMs of profile X fit" — the question an SE is actually asked mid-call.
  const additionalVmsByTier = {} as Record<TierId, number>
  // Room for more VMs stops at the free-space target: going past it is allowed, but not planned for.
  const domainHeadroom = (domain: 's2d' | 'san') => storageDomains.find((item) => item.domain === domain)?.headroomToTargetTiB ?? 0
  const storageHeadroomForTier = (policy: TierPolicy) => {
    if (cfg.architecture === 's2d') return domainHeadroom('s2d')
    if (cfg.architecture === 'san') return domainHeadroom('san')
    const share = hybridS2dShareForTier(cfg, policy)
    if (share <= 0) return domainHeadroom('san')
    if (share >= 1) return domainHeadroom('s2d')
    return Math.min(domainHeadroom('s2d') / share, domainHeadroom('san') / (1 - share))
  }
  // Measured IOPS and throughput per VM limit the count too, wherever a capability was entered.
  const performanceFitForTier = (id: TierId) => {
    const tierVms = vms.filter((vm) => vm.include && vm.tier === id)
    if (tierVms.length === 0) return Infinity
    const s2dShare = cfg.architecture === 's2d' ? 1 : cfg.architecture === 'san' ? 0 : hybridS2dShareForTier(cfg, tiers[id])
    const average = (pick: (vm: Vm) => number | undefined) => (tierVms.reduce((sum, vm) => sum + (pick(vm) ?? 0), 0) / tierVms.length) * growthFactor
    const iops = average((vm) => vm.performance?.storageIopsP95)
    const throughput = average((vm) => vm.performance?.storageThroughputMBpsP95)
    const fit = (perVm: number, required: number, available: number | null) => available !== null && perVm > 0 ? (available - required) / perVm : Infinity
    return Math.min(
      fit(iops * s2dShare, performanceDemand.requiredS2dIops, performanceCapability.availableS2dIops),
      fit(throughput * s2dShare, performanceDemand.requiredS2dThroughputMBps, performanceCapability.availableS2dThroughputMBps),
      fit(iops * (1 - s2dShare), performanceDemand.requiredSanIops, performanceCapability.availableSanIops),
      fit(throughput * (1 - s2dShare), performanceDemand.requiredSanThroughputMBps, performanceCapability.availableSanThroughputMBps),
    )
  }
  for (const id of TIER_IDS) {
    const t = workloadDemand.byTier[id]
    const policy = tiers[id]
    // A design that is invalid or already over has no room to offer.
    if (status === 'blocked' || status === 'over') {
      additionalVmsByTier[id] = 0
      continue
    }
    if (t.vms === 0) {
      // No exemplar in the inventory: use a nominal 4 vCPU / 16 GiB / 200 GiB profile. [TOOL]
      const cpuFit = headroomPCores / (4 / policy.oversubscription)
      const ramFit = headroomRamGiB / 16
      const stoFit = (storageHeadroomForTier(policy) * 1024) / 200
      additionalVmsByTier[id] = Math.max(0, Math.floor(Math.min(cpuFit, ramFit, stoFit)))
      continue
    }
    const avgCores = t.pCores / t.vms
    const avgRam = t.ramGiB / t.vms
    const avgSto = t.storageGiB / t.vms
    const cpuFit = avgCores > 0 ? headroomPCores / avgCores : Infinity
    const ramFit = avgRam > 0 ? headroomRamGiB / avgRam : Infinity
    const stoFit = avgSto > 0 ? (storageHeadroomForTier(policy) * 1024) / avgSto : Infinity
    additionalVmsByTier[id] = Math.max(0, Math.floor(Math.min(cpuFit, ramFit, stoFit, performanceFitForTier(id))))
  }

  return {
    status,
    headline,
    blockers,
    storagePerformance: {
      ...performanceDemand,
      ...performanceCapability,
      validated: performanceDemand.measuredVmCoveragePct >= 80
        && (!usesS2d || (performanceCapability.availableS2dIops !== null && performanceCapability.availableS2dThroughputMBps !== null))
        && (!(cfg.architecture === 'san' || cfg.architecture === 'hybrid') || (performanceCapability.availableSanIops !== null && performanceCapability.availableSanThroughputMBps !== null)),
    },
    nodes, workloadNodes,
    availablePCores, availableRamGiB, availableStorageTiB,
    usedPCores: demand.requiredPCores,
    usedRamGiB: demand.requiredRamGiB,
    usedStorageTiB,
    headroomPCores, headroomRamGiB, headroomStorageTiB,
    binding, bindingExplanation,
    additionalVmsByTier,
    findings,
    capacity: cap,
    storageDomains,
  }
}

/**
 * The headline output: solve every viable architecture against the same workload so the
 * trade is visible side by side. This is what produces
 * "8 nodes on SAN, 11 on S2D three-way mirror, 9 on S2D MAP".
 */
export interface ArchitectureOption {
  key: string
  label: string
  cfg: ClusterConfig
  result: SizingResult
}

/**
 * Reference server sizes to compare. These are planning building blocks, not a bill of materials,
 * and the engine never switches to one on its own. [TOOL]
 */
export const REFERENCE_SERVER_PROFILES = [
  { key: 'small', label: 'Small', sockets: 2, coresPerSocket: 16, ramGiB: 512 },
  { key: 'medium', label: 'Medium', sockets: 2, coresPerSocket: 32, ramGiB: 1024 },
  { key: 'large', label: 'Large', sockets: 2, coresPerSocket: 48, ramGiB: 1536 },
  { key: 'xlarge', label: 'Extra large', sockets: 2, coresPerSocket: 64, ramGiB: 2048 },
] as const

export interface ReferenceServerOption {
  key: string
  label: string
  sockets: number
  coresPerSocket: number
  ramGiB: number
  selected: boolean
  result: SizingResult
}

/** Size one storage option on each reference server, keeping every other assumption unchanged. */
export function compareReferenceServers(
  cfg: ClusterConfig,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
): ReferenceServerOption[] {
  const isCurrent = (p: { sockets: number; coresPerSocket: number; ramGiB: number }) =>
    p.sockets === cfg.node.sockets && p.coresPerSocket === cfg.node.coresPerSocket && p.ramGiB === cfg.node.ramGiB
  const profiles: Array<{ key: string; label: string; sockets: number; coresPerSocket: number; ramGiB: number }> = [...REFERENCE_SERVER_PROFILES]
  if (!profiles.some(isCurrent)) {
    profiles.push({ key: 'current', label: 'Your entry', sockets: cfg.node.sockets, coresPerSocket: cfg.node.coresPerSocket, ramGiB: cfg.node.ramGiB })
  }
  return profiles.map((profile) => ({
    ...profile,
    selected: isCurrent(profile),
    result: solveForward({ ...cfg, node: { ...cfg.node, sockets: profile.sockets, coresPerSocket: profile.coresPerSocket, ramGiB: profile.ramGiB } }, vms, tiers),
  }))
}

export const ARCHITECTURE_VARIANTS: ReadonlyArray<{ key: string; label: string; patch: Partial<ClusterConfig> }> = [
  { key: 'san', label: 'SAN', patch: { architecture: 'san' } },
  { key: 's2d-3wm', label: 'S2D — three-way mirror', patch: { architecture: 's2d', resiliency: 'three-way-mirror' } },
  { key: 's2d-map', label: 'S2D — mirror-accelerated parity', patch: { architecture: 's2d', resiliency: 'mirror-accelerated-parity' } },
  { key: 's2d-dp', label: 'S2D — dual parity', patch: { architecture: 's2d', resiliency: 'dual-parity' } },
  { key: 'hybrid', label: 'Hybrid — S2D + SAN', patch: { architecture: 'hybrid', resiliency: 'three-way-mirror' } },
]

export function compareArchitectures(
  base: ClusterConfig,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
): ArchitectureOption[] {
  return ARCHITECTURE_VARIANTS.map(v => {
    const variant = { ...base, ...v.patch } as ClusterConfig
    // A disk witness chosen for a SAN design must not rule S2D out of the comparison. Say so plainly.
    const swapWitness = variant.architecture !== 'san' && variant.witnessType === 'disk'
    const cfg: ClusterConfig = swapWitness ? { ...variant, witnessType: 'cloud' } : variant
    const result = solveForward(cfg, vms, tiers)
    if (swapWitness) {
      result.findings.push({
        severity: 'info',
        code: 'DISK_WITNESS_COMPARISON',
        message: 'The disk witness selected for SAN is not supported with Storage Spaces Direct, so this option is sized with a cloud witness.',
        basis: 'MS',
        source: SRC.quorum,
      })
    }
    return { key: v.key, label: v.label, cfg, result }
  })
}
