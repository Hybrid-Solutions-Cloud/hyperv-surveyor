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
import { LIMITS, RESILIENCY, TIER_IDS } from './rules'
import {
  computeDemand, giBToTiB, licensableCores, requiredStorageGiB,
  usableCoresPerHost, usableRamPerHost,
} from './compute'
import { s2dCapacity, sanCapacityTiB } from './capacity'
import { planCsvs, totalCsvCount } from './csv'
import { growthFactorForYear, resolveGrowthPlan, type GrowthPlan } from './growth'
import { hasErrors, validateDesign } from './validate'
import { assessPerformanceData } from './performance'
import type {
  BindingConstraint, ClusterConfig, ComputeDemand, ReverseResult,
  SizingResult, StorageArchitecture, TierId, TierPolicy, Vm,
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
) {
  let requiredS2dIops = 0
  let requiredS2dThroughputMBps = 0
  let requiredSanIops = 0
  let requiredSanThroughputMBps = 0
  let measured = 0
  let included = 0
  vms.forEach((vm) => {
    if (!vm.include) return
    included += 1
    const iops = vm.performance?.storageIopsP95
    const throughput = vm.performance?.storageThroughputMBpsP95
    if (iops === undefined && throughput === undefined) return
    measured += 1
    const s2dShare = cfg.architecture === 's2d' ? 1 : cfg.architecture === 'san' ? 0 : hybridS2dShareForTier(cfg, tiers[vm.tier])
    requiredS2dIops += (iops ?? 0) * s2dShare * growthFactor
    requiredS2dThroughputMBps += (throughput ?? 0) * s2dShare * growthFactor
    requiredSanIops += (iops ?? 0) * (1 - s2dShare) * growthFactor
    requiredSanThroughputMBps += (throughput ?? 0) * (1 - s2dShare) * growthFactor
  })
  return {
    requiredS2dIops,
    requiredS2dThroughputMBps,
    requiredSanIops,
    requiredSanThroughputMBps,
    measuredVmCoveragePct: included > 0 ? (measured / included) * 100 : 0,
  }
}

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

function solveForwardAtGrowthFactor(
  cfg: ClusterConfig,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
  growthFactor: number,
): SizingResult {
  const demand = computeDemand(vms, tiers, growthFactor, cfg)
  const coresPerHost = usableCoresPerHost(cfg.node, cfg)
  const ramPerHost = usableRamPerHost(cfg.node, cfg)
  const spare = cfg.spareNodes
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'

  // Independent single-constraint node counts. These drive the "what actually bound" answer.
  const nodesIfCpuOnly =
    coresPerHost > 0 ? Math.ceil(demand.requiredPCores / coresPerHost) + spare : Infinity
  const nodesIfMemoryOnly =
    ramPerHost > 0 ? Math.ceil(demand.requiredRamGiB / ramPerHost) + spare : Infinity

  const needS2dTiB = s2dRequiredTiB(cfg, demand, tiers)
  const needSanTiB = sanRequiredTiB(cfg, demand, tiers)
  const storagePerformanceDemandValue = storagePerformanceDemand(cfg, vms, tiers, growthFactor)
  const sanAvailable = cfg.architecture === 'san' || cfg.architecture === 'hybrid'
    ? sanCapacityTiB(cfg.san) : null
  const sanCapacityOk = sanAvailable === null || sanAvailable >= needSanTiB
  const sanIopsAvailable = (cfg.san.maxIops ?? 0) > 0 ? cfg.san.maxIops! : null
  const sanThroughputAvailable = (cfg.san.maxThroughputMBps ?? 0) > 0 ? cfg.san.maxThroughputMBps! : null
  const sanPerformanceOk = (sanIopsAvailable === null || storagePerformanceDemandValue.requiredSanIops <= sanIopsAvailable)
    && (sanThroughputAvailable === null || storagePerformanceDemandValue.requiredSanThroughputMBps <= sanThroughputAvailable)
  const sanOk = sanCapacityOk && sanPerformanceOk
  const s2dPerformanceOk = (nodes: number) => {
    const availableIops = (cfg.node.s2dIopsPerNode ?? 0) > 0 ? cfg.node.s2dIopsPerNode! * nodes : null
    const availableThroughput = (cfg.node.s2dThroughputMBpsPerNode ?? 0) > 0 ? cfg.node.s2dThroughputMBpsPerNode! * nodes : null
    return (availableIops === null || storagePerformanceDemandValue.requiredS2dIops <= availableIops)
      && (availableThroughput === null || storagePerformanceDemandValue.requiredS2dThroughputMBps <= availableThroughput)
  }

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
    const s2dOk = !usesS2d || (s2dCapacity(cfg, n).usableTiB >= needS2dTiB && s2dPerformanceOk(n))
    if (cpuOk && ramOk && s2dOk && sanOk) { nodes = n; break }
  }

  const resourceFeasible = Number.isFinite(nodes)
  const finalNodes = resourceFeasible ? nodes : max
  const workloadNodes = Math.max(0, finalNodes - spare)

  // Which constraint bound? The one whose single-constraint node count equals the answer.
  let binding: BindingConstraint = 'none'
  let bindingExplanation = ''
  const candidates: Array<[BindingConstraint, number]> = [
    ['cpu', nodesIfCpuOnly],
    ['memory', nodesIfMemoryOnly],
    ['storage', usesS2d || !sanOk ? nodesIfStorageOnly : -Infinity],
    ['node-floor', min],
  ]
  candidates.sort((a, b) => b[1] - a[1])
  binding = candidates[0][0]

  const cap = usesS2d ? s2dCapacity(cfg, finalNodes) : null
  const performanceUtilisation = Math.max(
    (cfg.node.s2dIopsPerNode ?? 0) > 0 ? storagePerformanceDemandValue.requiredS2dIops / (cfg.node.s2dIopsPerNode! * finalNodes) : 0,
    (cfg.node.s2dThroughputMBpsPerNode ?? 0) > 0 ? storagePerformanceDemandValue.requiredS2dThroughputMBps / (cfg.node.s2dThroughputMBpsPerNode! * finalNodes) : 0,
    sanIopsAvailable ? storagePerformanceDemandValue.requiredSanIops / sanIopsAvailable : 0,
    sanThroughputAvailable ? storagePerformanceDemandValue.requiredSanThroughputMBps / sanThroughputAvailable : 0,
  )
  const capacityUtilisation = Math.max(
    cap && cap.usableTiB > 0 ? needS2dTiB / cap.usableTiB : 0,
    sanAvailable && sanAvailable > 0 ? needSanTiB / sanAvailable : 0,
  )

  if (!resourceFeasible) {
    const reasons: string[] = []
    if (nodesIfCpuOnly > max) reasons.push(`CPU alone needs ${nodesIfCpuOnly} nodes`)
    if (nodesIfMemoryOnly > max) reasons.push(`memory alone needs ${nodesIfMemoryOnly} nodes`)
    if (usesS2d && !Number.isFinite(nodesIfS2dStorageOnly)) {
      const capacityPassesAtCeiling = s2dCapacity(cfg, max).usableTiB >= needS2dTiB
      reasons.push(capacityPassesAtCeiling
        ? `measured S2D IOPS or throughput exceeds the entered sustainable capability within ${max} nodes`
        : `S2D capacity cannot be satisfied within ${max} nodes at ${cap ? (cap.efficiency * 100).toFixed(1) : '?'}% efficiency`)
    }
    if (!sanCapacityOk && sanAvailable !== null) {
      reasons.push(`SAN capacity provides ${sanAvailable.toFixed(1)} TiB effective but ${needSanTiB.toFixed(1)} TiB is required`)
    }
    if (!sanPerformanceOk) reasons.push('measured SAN IOPS or throughput demand exceeds the entered sustainable array capability')
    bindingExplanation = `Not feasible in a single cluster: ${reasons.join('; ')}. Ceiling is ${max} nodes${usesS2d ? ' because S2D is enabled' : ''}. Split into multiple clusters, use denser nodes, or choose a more capacity-efficient resiliency.`
  } else {
    switch (binding) {
      case 'cpu':
        bindingExplanation = `CPU-bound. ${demand.requiredPCores.toFixed(0)} physical cores required across ${workloadNodes} workload nodes at ${coresPerHost.toFixed(0)} usable cores each. Memory alone would need ${nodesIfMemoryOnly} nodes${usesS2d ? `, storage alone ${nodesIfStorageOnly}` : ''}.`
        break
      case 'memory':
        bindingExplanation = `Memory-bound. ${demand.requiredRamGiB.toFixed(0)} GiB required across ${workloadNodes} workload nodes at ${ramPerHost.toFixed(0)} GiB usable each. CPU alone would need ${nodesIfCpuOnly} nodes${usesS2d ? `, storage alone ${nodesIfStorageOnly}` : ''}.`
        break
      case 'storage':
        bindingExplanation = performanceUtilisation > capacityUtilisation
          ? `Storage-bound (performance). Measured IOPS or throughput consumes ${(performanceUtilisation * 100).toFixed(1)}% of the entered sustainable capability. Compute alone would need ${Math.max(nodesIfCpuOnly, nodesIfMemoryOnly)} nodes. Validate peak concurrency and target performance with a proof of concept.`
          : `Storage-bound (capacity). ${needS2dTiB.toFixed(1)} TiB required on S2D and ${cap?.efficiencyLabel} yields ${((cap?.efficiency ?? 0) * 100).toFixed(1)}% efficiency. Compute alone would need ${Math.max(nodesIfCpuOnly, nodesIfMemoryOnly)} nodes.`
        break
      default:
        bindingExplanation = `Node-floor-bound. The workload fits in fewer nodes, but ${min} is the minimum for this architecture and N+${spare} resiliency.`
    }
  }

  const csvPlans = planCsvs(cfg, demand, tiers, finalNodes)
  const findings = validateDesign(cfg, finalNodes, vms, tiers, csvPlans)
  const storagePerformance = {
    ...storagePerformanceDemandValue,
    availableS2dIops: usesS2d && (cfg.node.s2dIopsPerNode ?? 0) > 0 ? cfg.node.s2dIopsPerNode! * finalNodes : null,
    availableS2dThroughputMBps: usesS2d && (cfg.node.s2dThroughputMBpsPerNode ?? 0) > 0 ? cfg.node.s2dThroughputMBpsPerNode! * finalNodes : null,
    availableSanIops: cfg.architecture === 'san' || cfg.architecture === 'hybrid' ? sanIopsAvailable : null,
    availableSanThroughputMBps: cfg.architecture === 'san' || cfg.architecture === 'hybrid' ? sanThroughputAvailable : null,
    validated: storagePerformanceDemandValue.measuredVmCoveragePct >= 80
      && (!usesS2d || ((cfg.node.s2dIopsPerNode ?? 0) > 0 && (cfg.node.s2dThroughputMBpsPerNode ?? 0) > 0))
      && (!(cfg.architecture === 'san' || cfg.architecture === 'hybrid') || (sanIopsAvailable !== null && sanThroughputAvailable !== null)),
  }
  if (!storagePerformance.validated) findings.push({ severity: 'warning', code: 'STORAGE_PERFORMANCE_UNVALIDATED', message: `Storage capacity is calculated, but end-to-end performance is not fully validated. Measured IOPS/throughput coverage is ${storagePerformance.measuredVmCoveragePct.toFixed(0)}%; enter sustainable target capabilities for every active storage domain.`, basis: 'TOOL' })
  if (!sanPerformanceOk) findings.push({ severity: 'error', code: 'SAN_PERFORMANCE_EXCEEDED', message: 'Measured SAN IOPS or throughput demand exceeds the entered sustainable array capability.', basis: 'TOOL' })
  if (usesS2d && !s2dPerformanceOk(finalNodes)) findings.push({ severity: 'error', code: 'S2D_PERFORMANCE_EXCEEDED', message: `Measured S2D IOPS or throughput demand cannot be satisfied within ${finalNodes} nodes using the entered per-node capability.`, basis: 'TOOL' })
  const feasible = resourceFeasible && !hasErrors(findings)
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
    performanceAssessment: assessPerformanceData(vms, cfg),
    storagePerformance,
  }
}

export function solveForward(
  cfg: ClusterConfig,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
): SizingResult {
  return solveForwardAtGrowthFactor(cfg, vms, tiers, resolveGrowthPlan(cfg).currentDesignGrowthFactor)
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
 * plane) remain constant while the imported workload grows.
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
    const growingVms = workloadVms.map((vm) => ({
      ...vm,
      vCpu: vm.vCpu * demandFactor,
      ramGiB: vm.ramGiB * demandFactor,
      storageGiB: vm.storageGiB * demandFactor,
      provisionedGiB: vm.provisionedGiB * demandFactor,
      performance: vm.performance ? {
        ...vm.performance,
        storageIopsP95: vm.performance.storageIopsP95 === undefined ? undefined : vm.performance.storageIopsP95 * demandFactor,
        storageThroughputMBpsP95: vm.performance.storageThroughputMBpsP95 === undefined ? undefined : vm.performance.storageThroughputMBpsP95 * demandFactor,
        networkMbpsP95: vm.performance.networkMbpsP95 === undefined ? undefined : vm.performance.networkMbpsP95 * demandFactor,
      } : undefined,
    }))
    const result = solveForwardAtGrowthFactor(cfg, [...growingVms, ...fixedVms], tiers, 1)
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
): ReverseResult {
  const demand = computeDemand(vms, tiers, resolveGrowthPlan(cfg).currentDesignGrowthFactor, cfg)
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
  const storageDomains: ReverseResult['storageDomains'] = []
  if (usesS2d) {
    const available = cap?.usableTiB ?? 0
    storageDomains.push({ domain: 's2d', availableTiB: available, usedTiB: usedS2dTiB, headroomTiB: available - usedS2dTiB, utilisationPct: available > 0 ? (usedS2dTiB / available) * 100 : 100 })
  }
  if (cfg.architecture === 'san' || cfg.architecture === 'hybrid') {
    const available = sanCapacityTiB(cfg.san)
    storageDomains.push({ domain: 'san', availableTiB: available, usedTiB: usedSanTiB, headroomTiB: available - usedSanTiB, utilisationPct: available > 0 ? (usedSanTiB / available) * 100 : 100 })
  }

  const headroomPCores = availablePCores - demand.requiredPCores
  const headroomRamGiB = availableRamGiB - demand.requiredRamGiB
  const headroomStorageTiB = availableStorageTiB - usedStorageTiB

  const pctCpu = availablePCores > 0 ? demand.requiredPCores / availablePCores : 1
  const pctRam = availableRamGiB > 0 ? demand.requiredRamGiB / availableRamGiB : 1
  const pctSto = storageDomains.length > 0 ? Math.max(...storageDomains.map((domain) => domain.utilisationPct / 100)) : 1

  let binding: BindingConstraint = 'cpu'
  let worst = pctCpu
  if (pctRam > worst) { binding = 'memory'; worst = pctRam }
  if (pctSto > worst) { binding = 'storage'; worst = pctSto }

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  const bindingExplanation =
    `${binding === 'cpu' ? 'CPU' : binding === 'memory' ? 'Memory' : 'Storage'} binds first at ${pct(worst)} consumed. ` +
    `CPU ${pct(pctCpu)} · Memory ${pct(pctRam)} · Storage ${pct(pctSto)}. ` +
    (worst >= 1
      ? 'This hardware cannot carry the stated workload.'
      : `Headroom before the first constraint is exhausted: ${pct(1 - worst)}.`)

  // "How many more VMs of profile X fit" — the question an SE is actually asked mid-call.
  const additionalVmsByTier = {} as Record<TierId, number>
  const domainHeadroom = (domain: 's2d' | 'san') => storageDomains.find((item) => item.domain === domain)?.headroomTiB ?? 0
  const storageHeadroomForTier = (policy: TierPolicy) => {
    if (cfg.architecture === 's2d') return domainHeadroom('s2d')
    if (cfg.architecture === 'san') return domainHeadroom('san')
    const share = hybridS2dShareForTier(cfg, policy)
    if (share <= 0) return domainHeadroom('san')
    if (share >= 1) return domainHeadroom('s2d')
    return Math.min(domainHeadroom('s2d') / share, domainHeadroom('san') / (1 - share))
  }
  for (const id of TIER_IDS) {
    const t = demand.byTier[id]
    const policy = tiers[id]
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
    additionalVmsByTier[id] = Math.max(0, Math.floor(Math.min(cpuFit, ramFit, stoFit)))
  }

  const csvPlans = planCsvs(cfg, demand, tiers, nodes)
  const findings = validateDesign(cfg, nodes, vms, tiers, csvPlans)

  return {
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

export function compareArchitectures(
  base: ClusterConfig,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
): ArchitectureOption[] {
  const variants: Array<{ key: string; label: string; patch: Partial<ClusterConfig> }> = [
    { key: 'san', label: 'SAN (Pure / Everpure)', patch: { architecture: 'san' } },
    { key: 's2d-3wm', label: 'S2D — three-way mirror', patch: { architecture: 's2d', resiliency: 'three-way-mirror' } },
    { key: 's2d-map', label: 'S2D — mirror-accelerated parity', patch: { architecture: 's2d', resiliency: 'mirror-accelerated-parity' } },
    { key: 's2d-dp', label: 'S2D — dual parity', patch: { architecture: 's2d', resiliency: 'dual-parity' } },
    { key: 'hybrid', label: 'Hybrid — S2D + SAN', patch: { architecture: 'hybrid', resiliency: 'three-way-mirror' } },
  ]
  return variants.map(v => {
    const cfg = { ...base, ...v.patch } as ClusterConfig
    return { key: v.key, label: v.label, cfg, result: solveForward(cfg, vms, tiers) }
  })
}
