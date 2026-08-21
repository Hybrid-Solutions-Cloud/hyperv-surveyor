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
import { LIMITS, TIER_IDS } from './rules'
import {
  computeDemand, giBToTiB, licensableCores, requiredStorageGiB,
  usableCoresPerHost, usableRamPerHost,
} from './compute'
import { s2dCapacity, sanCapacityTiB } from './capacity'
import { planCsvs, totalCsvCount } from './csv'
import { growthFactorForYear, resolveGrowthPlan, type GrowthPlan } from './growth'
import { validateDesign } from './validate'
import type {
  BindingConstraint, ClusterConfig, ComputeDemand, ReverseResult,
  SizingResult, StorageArchitecture, TierId, TierPolicy, Vm,
} from './types'

function maxNodesFor(arch: StorageArchitecture): number {
  return arch === 'san' ? LIMITS.CLUSTER_MAX_NODES : LIMITS.S2D_MAX_NODES
}

function minNodesFor(arch: StorageArchitecture): number {
  return arch === 'san' ? 2 : LIMITS.S2D_MIN_NODES
}

/** Storage the S2D domain must carry, in TiB. In hybrid, only the S2D share. */
function s2dRequiredTiB(cfg: ClusterConfig, demand: ComputeDemand): number {
  const totalTiB = giBToTiB(requiredStorageGiB(demand))
  if (cfg.architecture === 's2d') return totalTiB
  if (cfg.architecture === 'hybrid') return totalTiB * cfg.hybridS2dShare
  return 0
}

function sanRequiredTiB(cfg: ClusterConfig, demand: ComputeDemand): number {
  const totalTiB = giBToTiB(requiredStorageGiB(demand))
  if (cfg.architecture === 'san') return totalTiB
  if (cfg.architecture === 'hybrid') return totalTiB * (1 - cfg.hybridS2dShare)
  return 0
}

function solveForwardAtGrowthFactor(
  cfg: ClusterConfig,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
  growthFactor: number,
): SizingResult {
  const demand = computeDemand(vms, tiers, growthFactor)
  const coresPerHost = usableCoresPerHost(cfg.node, cfg)
  const ramPerHost = usableRamPerHost(cfg.node, cfg)
  const spare = cfg.spareNodes
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'

  // Independent single-constraint node counts. These drive the "what actually bound" answer.
  const nodesIfCpuOnly =
    coresPerHost > 0 ? Math.ceil(demand.requiredPCores / coresPerHost) + spare : Infinity
  const nodesIfMemoryOnly =
    ramPerHost > 0 ? Math.ceil(demand.requiredRamGiB / ramPerHost) + spare : Infinity

  const needS2dTiB = s2dRequiredTiB(cfg, demand)
  const needSanTiB = sanRequiredTiB(cfg, demand)
  const sanAvailable = cfg.architecture === 'san' || cfg.architecture === 'hybrid'
    ? sanCapacityTiB(cfg.san) : null

  let nodesIfStorageOnly = minNodesFor(cfg.architecture)
  if (usesS2d) {
    let found = Infinity
    for (let n = minNodesFor(cfg.architecture); n <= maxNodesFor(cfg.architecture); n++) {
      if (s2dCapacity(cfg, n).usableTiB >= needS2dTiB) { found = n; break }
    }
    nodesIfStorageOnly = found
  }

  const min = minNodesFor(cfg.architecture)
  const max = maxNodesFor(cfg.architecture)

  let nodes = Infinity
  for (let n = min; n <= max; n++) {
    const workload = n - spare
    if (workload < 1) continue
    const cpuOk = demand.requiredPCores <= workload * coresPerHost
    const ramOk = demand.requiredRamGiB <= workload * ramPerHost
    const s2dOk = !usesS2d || s2dCapacity(cfg, n).usableTiB >= needS2dTiB
    if (cpuOk && ramOk && s2dOk) { nodes = n; break }
  }

  const feasible = Number.isFinite(nodes)
  const finalNodes = feasible ? nodes : max
  const workloadNodes = Math.max(0, finalNodes - spare)

  // Which constraint bound? The one whose single-constraint node count equals the answer.
  let binding: BindingConstraint = 'none'
  let bindingExplanation = ''
  const candidates: Array<[BindingConstraint, number]> = [
    ['cpu', nodesIfCpuOnly],
    ['memory', nodesIfMemoryOnly],
    ['storage', usesS2d ? nodesIfStorageOnly : -Infinity],
    ['node-floor', min],
  ]
  candidates.sort((a, b) => b[1] - a[1])
  binding = candidates[0][0]

  const cap = usesS2d ? s2dCapacity(cfg, finalNodes) : null

  if (!feasible) {
    const reasons: string[] = []
    if (nodesIfCpuOnly > max) reasons.push(`CPU alone needs ${nodesIfCpuOnly} nodes`)
    if (nodesIfMemoryOnly > max) reasons.push(`memory alone needs ${nodesIfMemoryOnly} nodes`)
    if (usesS2d && !Number.isFinite(nodesIfStorageOnly)) {
      reasons.push(`storage cannot be satisfied within ${max} nodes at ${cap ? (cap.efficiency * 100).toFixed(1) : '?'}% efficiency`)
    }
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
        bindingExplanation = `Storage-bound. ${needS2dTiB.toFixed(1)} TiB required and ${cap?.efficiencyLabel} yields ${((cap?.efficiency ?? 0) * 100).toFixed(1)}% efficiency, so ${(needS2dTiB / (cap?.efficiency || 1)).toFixed(0)} TiB raw is needed after reserve. Compute alone would need ${Math.max(nodesIfCpuOnly, nodesIfMemoryOnly)} nodes.`
        break
      default:
        bindingExplanation = `Node-floor-bound. The workload fits in fewer nodes, but ${min} is the minimum for this architecture and N+${spare} resiliency.`
    }
  }

  const csvPlans = planCsvs(cfg, demand, tiers, finalNodes)
  const findings = validateDesign(cfg, finalNodes, vms, tiers, csvPlans)

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
    csvPlans,
    totalCsvs: totalCsvCount(csvPlans),
    findings,
    utilisationCeiling: finalNodes > 0 ? workloadNodes / finalNodes : 0,
    resiliencyOverheadPct: finalNodes > 0 ? (spare / finalNodes) * 100 : 0,
    licensableCoresPerNode: licensableCores(cfg.node),
    totalLicensableCores: licensableCores(cfg.node) * finalNodes,
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
  const demand = computeDemand(vms, tiers, resolveGrowthPlan(cfg).currentDesignGrowthFactor)
  const workloadNodes = Math.max(0, nodes - cfg.spareNodes)
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'

  const availablePCores = workloadNodes * usableCoresPerHost(cfg.node, cfg)
  const availableRamGiB = workloadNodes * usableRamPerHost(cfg.node, cfg)

  const cap = usesS2d ? s2dCapacity(cfg, nodes) : null
  let availableStorageTiB = 0
  if (cfg.architecture === 'san') availableStorageTiB = sanCapacityTiB(cfg.san)
  else if (cfg.architecture === 's2d') availableStorageTiB = cap?.usableTiB ?? 0
  else availableStorageTiB = (cap?.usableTiB ?? 0) + sanCapacityTiB(cfg.san)

  const usedStorageTiB = giBToTiB(requiredStorageGiB(demand))

  const headroomPCores = availablePCores - demand.requiredPCores
  const headroomRamGiB = availableRamGiB - demand.requiredRamGiB
  const headroomStorageTiB = availableStorageTiB - usedStorageTiB

  const pctCpu = availablePCores > 0 ? demand.requiredPCores / availablePCores : 1
  const pctRam = availableRamGiB > 0 ? demand.requiredRamGiB / availableRamGiB : 1
  const pctSto = availableStorageTiB > 0 ? usedStorageTiB / availableStorageTiB : 1

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
  for (const id of TIER_IDS) {
    const t = demand.byTier[id]
    const policy = tiers[id]
    if (t.vms === 0) {
      // No exemplar in the inventory: use a nominal 4 vCPU / 16 GiB / 200 GiB profile. [TOOL]
      const cpuFit = headroomPCores / (4 / policy.oversubscription)
      const ramFit = headroomRamGiB / 16
      const stoFit = (headroomStorageTiB * 1024) / 200
      additionalVmsByTier[id] = Math.max(0, Math.floor(Math.min(cpuFit, ramFit, stoFit)))
      continue
    }
    const avgCores = t.pCores / t.vms
    const avgRam = t.ramGiB / t.vms
    const avgSto = t.storageGiB / t.vms
    const cpuFit = avgCores > 0 ? headroomPCores / avgCores : Infinity
    const ramFit = avgRam > 0 ? headroomRamGiB / avgRam : Infinity
    const stoFit = avgSto > 0 ? (headroomStorageTiB * 1024) / avgSto : Infinity
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
