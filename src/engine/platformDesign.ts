/**
 * One source of truth for the platform design. Every page, the report, the workbooks, the
 * Implementation plan, the Management page and Project & scenarios read the resolved design from
 * resolvePlatformDesign, so the same state always gives the same numbers everywhere.
 *
 * The function is pure: it takes the planning state and returns which configuration applies,
 * whether management VMs are counted, the single or split result, the per-cluster plan, the growth
 * forecast, the storage plan, the fit-gap result for existing hardware and the network node count.
 */
import { compareArchitectures, forecastGrowth, solveForward, type ArchitectureOption } from './solve'
import { DEFAULT_PLACEMENT_INPUTS, planMultipleClusters, type MultiClusterPlan, type PlacementInputs } from './deploymentPlanning'
import { assessFitGap, type FitGapAssessment } from './fitGap'
import {
  deploymentComponentsToVms,
  normalizeManagementDeploymentInputs,
  planManagementDeployment,
  type ManagementDeploymentInputs,
  type ManagementDeploymentPlan,
  type ResolvedManagementDeploymentInputs,
} from './managementDeployment'
import { growthFactorForYear, resolveGrowthPlan, type GrowthPlan } from './growth'
import { resolveManagementInputs, type ManagementAdvisorSummary, type ManagementInputsSource } from './managementAdvisor'
import type { AdvisorAnswers } from '../data/managementPlane'
import { sanCapacityTiB, sanFreeSpaceTarget } from './capacity'
import { licensableCores } from './compute'
import type { ClusterConfig, CsvPlan, Finding, SizingResult, TierId, TierPolicy, Vm } from './types'

export type DesignEngagementMode = 'new-platform' | 'existing-capacity' | 'fit-gap' | 'management-only'
export type DesignManagementDecision = 'unassessed' | 'design' | 'existing' | 'deferred'

export interface PlatformDesignInputs {
  engagementMode?: DesignEngagementMode | null
  cfg: ClusterConfig
  tiers: Record<TierId, TierPolicy>
  vms: Vm[]
  chosenKey: string
  /** Required on existing-hardware paths; ignored elsewhere. */
  existingCapacityCfg?: ClusterConfig
  existingCapacityTiers?: Record<TierId, TierPolicy>
  existingCapacityNodes?: number
  placementInputs?: PlacementInputs
  managementDecision?: DesignManagementDecision
  managementDeploymentInputs: ManagementDeploymentInputs | null
  includeManagementInSizing: boolean
  /** Management Plane Advisor answers. The stack follows them until the user picks stack fields. */
  managementAdvisorAnswers?: AdvisorAnswers
}

export type PlatformPath = 'new-platform' | 'existing' | 'management-only'

/**
 * new-platform: feasible (one cluster), split (selected and feasible), split-failed, over-limit,
 * blocked. existing: fits, does-not-fit. Both: no-workload. management-only: not-assessed.
 */
export type DesignStatus = 'feasible' | 'split' | 'split-failed' | 'over-limit' | 'blocked' | 'fits' | 'does-not-fit' | 'no-workload' | 'not-assessed'

export interface DesignClusterRow {
  id: string
  name: string
  purpose: string
  workloadVms: number
  managementVms: number
  /** Null when the cluster has no valid node count. */
  nodes: number | null
  workloadNodes: number | null
  nodesLabel: string
  binding: string
  feasible: boolean
  sourceClusters: string[]
  confidence: string
  requiredStorageTiB: number
  s2dUsableTiB: number | null
  sanToBuyUsableTiB: number | null
  licensableCores: number | null
}

export interface DesignGrowthPoint {
  year: number
  demandFactor: number
  nodes: number | null
  nodesLabel: string
  binding: string
  feasible: boolean
  additionalNodes: number | null
  /** Usable SAN capacity to buy at this point; null when not calculated. */
  sanToBuyUsableTiB: number | null
  action: string
}

export interface DesignGrowth {
  plan: GrowthPlan
  /** What the forecast describes: one cluster, the selected split, or the entered estate. */
  scope: 'single-cluster' | 'split' | 'existing'
  scopeLabel: string
  points: DesignGrowthPoint[]
  currentRequiredNodes: number | null
  plannedNodesToday: number | null
  allFeasible: boolean
}

export interface DesignCsvPlan extends CsvPlan {
  cluster?: string
}

export interface DesignStorage {
  architecture: ClusterConfig['architecture']
  requiredTiB: number
  requiredS2dTiB: number
  requiredSanTiB: number
  s2dUsableTiB: number | null
  sanMode: 'calculated' | 'fixed' | null
  /** Usable capacity the array has (fixed) or must have (calculated, to buy). */
  sanUsableTiB: number | null
  /** Effective capacity: usable times the data reduction ratio. */
  sanEffectiveTiB: number | null
  sanDrr: number | null
  sanFreeSpaceTargetPct: number | null
  sanToBuyUsableTiB: number | null
  sanToBuyEffectiveTiB: number | null
  /** Null when no plan can be given; csvNotCalculatedReason then says why. */
  csvPlans: DesignCsvPlan[] | null
  totalCsvs: number | null
  csvNotCalculatedReason: string | null
  /** Local drives describe S2D hosts only. A SAN design has none to list. */
  showLocalDrives: boolean
  perCluster: boolean
}

export interface DesignManagement {
  decision: DesignManagementDecision
  designed: boolean
  inputs: ResolvedManagementDeploymentInputs
  /** The inputs before defaults are filled in. Edits start from these, so values that follow the estate keep following it. */
  rawInputs: ManagementDeploymentInputs
  /** saved: the user's stack choices. advisor: a ready advisor result. starting-point: labelled default while the advisor is not ready. */
  source: ManagementInputsSource
  advisor: ManagementAdvisorSummary
  /** Breaches of a published limit in the management plan. */
  errors: string[]
  /** Missing scale inputs, such as 0 managed hosts or VMs on the management-only path. */
  warnings: string[]
  plan: ManagementDeploymentPlan
  vms: Vm[]
  /** True when management VMs exist and share the workload hardware in this result. */
  counted: boolean
  countedVms: Vm[]
  /** The host count management defaults are based on. Never the cluster ceiling. */
  contextNodes: number
  contextNote: string | null
  /** basis says which hardware profile the node count uses. */
  dedicated: { nodes: number | null; sizing: SizingResult | null; reason: string | null; basis: string | null } | null
  /** Nodes the management VMs add. Null when not counted or not comparable. */
  hostDelta: number | null
  impactLabel: string
  impactDetail: string
}

export interface PlatformDesign {
  path: PlatformPath
  engagementMode: DesignEngagementMode
  platformLabel: string
  /** The configuration that applies: the chosen option, or the existing hardware. */
  cfg: ClusterConfig
  tiers: Record<TierId, TierPolicy>
  /** Architecture comparison on the new-platform path, with management VMs when counted. */
  options: ArchitectureOption[]
  chosen: ArchitectureOption | null
  includedVmCount: number
  management: DesignManagement
  layout: 'single' | 'split'
  splitRequested: boolean
  splitFeasible: boolean
  placement: MultiClusterPlan | null
  /** The controlling one-cluster result. On existing paths: forward sizing on the same spec. */
  sizing: SizingResult | null
  status: DesignStatus
  /** True when the design is valid as reported, false when not, null when not assessed. */
  feasible: boolean | null
  headline: string
  explanation: string
  totalNodes: number | null
  workloadNodes: number | null
  /** Short value for the node headline, such as "9" or "48 across 3 clusters". */
  nodesLabel: string
  licensableCores: number | null
  licensableCoresDetail: string
  clusters: DesignClusterRow[]
  growth: DesignGrowth | null
  storage: DesignStorage | null
  fitGap: FitGapAssessment | null
  network: { nodes: number | null; reason: string | null }
  findings: Finding[]
  errors: string[]
}

const fmt = (value: number, digits = 1) => value.toLocaleString('en-US', { maximumFractionDigits: digits })
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** A config whose current design factor is the given demand factor. */
export function configAtGrowthFactor(cfg: ClusterConfig, factor: number): ClusterConfig {
  return { ...cfg, growthFactor: factor, annualGrowthPct: 0, growthStrategy: 'phased' }
}

/** Node need for a result: the design count when feasible, otherwise what it needs. Never the ceiling. */
export function nodesNeededForContext(result: SizingResult | null | undefined): number {
  if (!result) return 0
  if (result.feasible) return result.nodes
  return result.nodesNeeded ?? result.computeNodesNeeded ?? 0
}

/** The one-cluster node answer as text, for a result that may not fit. */
export function singleClusterNodesLabel(result: SizingResult): string {
  if (result.feasible) return fmt(result.nodes, 0)
  if (result.nodesNeeded === null) return result.computeNodesNeeded === null ? 'No node count works' : `${fmt(result.computeNodesNeeded, 0)} for compute (storage blocks)`
  return result.nodesNeeded > result.clusterNodeLimit
    ? `${fmt(result.nodesNeeded, 0)} needed (limit ${result.clusterNodeLimit})`
    : `${fmt(result.nodesNeeded, 0)} (blocked, see findings)`
}

function confidenceText(result: SizingResult): string {
  return `${result.performanceAssessment.confidence.replace('-', ' ')} (${result.performanceAssessment.score}/100)`
}

function infeasibleAction(result: SizingResult): string {
  if (result.sanCapacityTiB !== null && result.requiredSanTiB > result.sanCapacityTiB) {
    return `Expand SAN effective capacity by ${fmt(result.requiredSanTiB - result.sanCapacityTiB)} TiB`
  }
  return result.nodesNeeded !== null && result.nodesNeeded > result.clusterNodeLimit
    ? `Above the ${result.clusterNodeLimit}-node limit: review server size, storage type, or cluster layout`
    : 'Review the design findings'
}

function plannedAction(plan: GrowthPlan, index: number, nodes: number, additional: number | null, plannedToday: number | null): string {
  if (plan.strategy === 'build-now') {
    return index === 0 ? `Build ${plannedToday ?? 'N/A'} nodes now` : `Covered by the initial ${plannedToday ?? 'N/A'}-node build`
  }
  if (index === 0) return `Initial build: ${nodes} nodes`
  return additional && additional > 0 ? `Add ${plural(additional, 'node')}` : 'No node addition'
}

function singleClusterGrowth(cfg: ClusterConfig, vms: Vm[], tiers: Record<TierId, TierPolicy>, fixedVms: Vm[]): DesignGrowth {
  const forecast = forecastGrowth(cfg, vms, tiers, fixedVms)
  return {
    plan: forecast.plan,
    scope: 'single-cluster',
    scopeLabel: 'One cluster',
    currentRequiredNodes: forecast.currentRequiredNodes,
    plannedNodesToday: forecast.plannedNodesToday,
    allFeasible: forecast.points.every((point) => point.result.feasible),
    points: forecast.points.map((point, index) => ({
      year: point.year,
      demandFactor: point.demandFactor,
      nodes: point.result.feasible ? point.result.nodes : null,
      nodesLabel: singleClusterNodesLabel(point.result),
      binding: point.result.binding,
      feasible: point.result.feasible,
      additionalNodes: point.additionalNodes,
      sanToBuyUsableTiB: point.result.feasible ? point.result.sanSizing?.usableToBuyTiB ?? null : null,
      action: point.result.feasible
        ? plannedAction(forecast.plan, index, point.result.nodes, point.additionalNodes, forecast.plannedNodesToday)
        : infeasibleAction(point.result),
    })),
  }
}

function splitGrowth(cfg: ClusterConfig, vms: Vm[], tiers: Record<TierId, TierPolicy>, placement: PlacementInputs, fixedVms: Vm[]): DesignGrowth {
  const plan = resolveGrowthPlan(cfg)
  let previous: number | null = null
  const raw = Array.from({ length: plan.horizonYears + 1 }, (_, year) => {
    const demandFactor = growthFactorForYear(plan, year)
    const result = planMultipleClusters(configAtGrowthFactor(cfg, demandFactor), vms, tiers, placement, fixedVms)
    const nodes = result.feasible ? result.totalNodes : null
    const additionalNodes = nodes === null ? null : previous === null ? nodes : Math.max(0, nodes - previous)
    previous = nodes
    const sanToBuy = result.feasible && result.clusters.some((cluster) => cluster.result.sanSizing)
      ? result.clusters.reduce((sum, cluster) => sum + (cluster.result.sanSizing?.usableToBuyTiB ?? 0), 0)
      : null
    return { year, demandFactor, result, nodes, additionalNodes, sanToBuy }
  })
  const first = raw[0]
  const terminal = raw[raw.length - 1]
  const plannedNodesToday = plan.strategy === 'build-now' ? terminal.nodes : first.nodes
  return {
    plan,
    scope: 'split',
    scopeLabel: 'Selected split, all clusters together',
    currentRequiredNodes: first.nodes,
    plannedNodesToday,
    allFeasible: raw.every((point) => point.nodes !== null),
    points: raw.map((point, index) => ({
      year: point.year,
      demandFactor: point.demandFactor,
      nodes: point.nodes,
      nodesLabel: point.nodes === null ? 'Split not feasible' : `${fmt(point.nodes, 0)} across ${plural(point.result.clusters.length, 'cluster')}`,
      binding: point.result.clusters.length === 1 ? point.result.clusters[0].result.binding : [...new Set(point.result.clusters.map((cluster) => cluster.result.binding))].join(', '),
      feasible: point.nodes !== null,
      additionalNodes: point.additionalNodes,
      sanToBuyUsableTiB: point.sanToBuy,
      action: point.nodes === null
        ? 'The split cannot place this demand: raise the cluster ceiling or use denser hardware'
        : plannedAction(plan, index, point.nodes, point.additionalNodes, plannedNodesToday),
    })),
  }
}

function existingGrowth(cfg: ClusterConfig, vms: Vm[], tiers: Record<TierId, TierPolicy>, fixedVms: Vm[], existingNodes: number): DesignGrowth {
  const forecast = forecastGrowth(cfg, vms, tiers, fixedVms)
  return {
    plan: forecast.plan,
    scope: 'existing',
    scopeLabel: `The ${existingNodes} entered nodes`,
    currentRequiredNodes: forecast.currentRequiredNodes,
    plannedNodesToday: existingNodes,
    allFeasible: forecast.points.every((point) => point.result.feasible && point.result.nodes <= existingNodes),
    points: forecast.points.map((point) => {
      const nodes = point.result.feasible ? point.result.nodes : null
      const action = nodes === null
        ? `Not solved by adding nodes: ${infeasibleAction(point.result).toLowerCase()}`
        : nodes <= existingNodes
          ? `Fits on the ${existingNodes} existing nodes`
          : `Needs ${plural(nodes - existingNodes, 'more node')} than the ${existingNodes} entered`
      return {
        year: point.year,
        demandFactor: point.demandFactor,
        nodes,
        nodesLabel: nodes === null ? singleClusterNodesLabel(point.result) : `${fmt(nodes, 0)} needed`,
        binding: point.result.binding,
        feasible: nodes !== null && nodes <= existingNodes,
        additionalNodes: nodes === null ? null : Math.max(0, nodes - existingNodes),
        sanToBuyUsableTiB: null,
        action,
      }
    }),
  }
}

function clusterRow(cluster: MultiClusterPlan['clusters'][number]): DesignClusterRow {
  const result = cluster.result
  return {
    id: cluster.id,
    name: cluster.name,
    purpose: cluster.purpose,
    workloadVms: cluster.vms.length - cluster.managementVmCount,
    managementVms: cluster.managementVmCount,
    nodes: result.feasible ? result.nodes : null,
    workloadNodes: result.feasible ? result.workloadNodes : null,
    nodesLabel: result.feasible ? fmt(result.nodes, 0) : singleClusterNodesLabel(result),
    binding: result.binding,
    feasible: result.feasible,
    sourceClusters: cluster.sourceClusters,
    confidence: confidenceText(result),
    requiredStorageTiB: result.requiredStorageTiB,
    s2dUsableTiB: result.feasible && result.capacity ? result.capacity.usableTiB : null,
    sanToBuyUsableTiB: result.feasible ? result.sanSizing?.usableToBuyTiB ?? null : null,
    licensableCores: result.feasible ? result.totalLicensableCores : null,
  }
}

function sanFields(cfg: ClusterConfig) {
  const usesSan = cfg.architecture === 'san' || cfg.architecture === 'hybrid'
  if (!usesSan) return { sanMode: null, sanUsableTiB: null, sanEffectiveTiB: null, sanDrr: null, sanFreeSpaceTargetPct: null } as const
  const calculated = cfg.sanSizingMode === 'calculated'
  return {
    sanMode: calculated ? 'calculated' as const : 'fixed' as const,
    sanUsableTiB: calculated ? null : cfg.san.usableTiB,
    sanEffectiveTiB: calculated ? null : sanCapacityTiB(cfg.san),
    sanDrr: Math.max(1, cfg.san.drr),
    sanFreeSpaceTargetPct: sanFreeSpaceTarget(cfg),
  }
}

export function resolvePlatformDesign(input: PlatformDesignInputs): PlatformDesign {
  const engagementMode: DesignEngagementMode = input.engagementMode ?? 'new-platform'
  const path: PlatformPath = engagementMode === 'management-only'
    ? 'management-only'
    : engagementMode === 'existing-capacity' || engagementMode === 'fit-gap' ? 'existing' : 'new-platform'
  const placementInputs = { ...DEFAULT_PLACEMENT_INPUTS, ...(input.placementInputs ?? {}) }
  const decision: DesignManagementDecision = input.managementDecision ?? (input.managementDeploymentInputs ? 'design' : 'unassessed')
  const platformVms = path === 'management-only' ? [] : input.vms
  const includedVmCount = input.vms.filter((vm) => vm.include).length
  const existingCfg = input.existingCapacityCfg ?? input.cfg
  const existingTiers = input.existingCapacityTiers ?? input.tiers
  const existingNodes = Math.max(1, Math.round(input.existingCapacityNodes ?? 8))
  const splitRequested = path === 'new-platform' && placementInputs.clusterLayout === 'split'

  // Step 1: the design without management VMs. It sets the host count management defaults use.
  const baselineOptions = path === 'new-platform' ? compareArchitectures(input.cfg, platformVms, input.tiers) : []
  const baselineChosen = baselineOptions.find((option) => option.key === input.chosenKey) ?? baselineOptions[0] ?? null
  const baselineSplit = splitRequested && baselineChosen ? planMultipleClusters(baselineChosen.cfg, platformVms, input.tiers, placementInputs) : null
  let contextNodes = 0
  let contextNote: string | null = null
  if (path === 'management-only') {
    contextNodes = Math.max(0, input.managementDeploymentInputs?.managedHosts ?? 0)
    if (contextNodes === 0) contextNote = 'Managed hosts are not entered yet. Enter them in the management deployment design; nothing is sized for 0 hosts.'
  } else if (path === 'existing') {
    contextNodes = existingNodes
  } else if (baselineSplit?.feasible) {
    contextNodes = baselineSplit.totalNodes
  } else {
    contextNodes = nodesNeededForContext(baselineChosen?.result)
    if (baselineChosen && !baselineChosen.result.feasible) contextNote = contextNodes > 0
      ? `The design does not fit, so management defaults use the ${contextNodes} nodes the workload needs, not the cluster limit.`
      : 'The design has no valid node count, so management defaults are not based on a host count.'
  }

  // Step 2: management, by one rule.
  const resolvedManagement = resolveManagementInputs({
    stored: input.managementDeploymentInputs,
    answers: input.managementAdvisorAnswers,
    contextNodes,
    includedVmCount,
  })
  const managementInputs = normalizeManagementDeploymentInputs(resolvedManagement.inputs)
  const managementPlan = planManagementDeployment(managementInputs)
  const managementVms = deploymentComponentsToVms(managementPlan.components)
  const designed = decision === 'design'
  const counted = designed
    && input.includeManagementInSizing
    && managementInputs.managementPlacement === 'workload-cluster'
    && path !== 'management-only'
    && managementVms.length > 0
  const countedVms = counted ? managementVms : []

  // Step 3: the platform.
  const options = path === 'new-platform'
    ? counted ? compareArchitectures(input.cfg, platformVms, input.tiers, countedVms) : baselineOptions
    : []
  const chosen = options.find((option) => option.key === input.chosenKey) ?? options[0] ?? null
  const cfg = path === 'existing' ? existingCfg : chosen?.cfg ?? input.cfg
  const tiers = path === 'existing' ? existingTiers : input.tiers

  let placement: MultiClusterPlan | null = null
  let sizing: SizingResult | null = null
  let fitGap: FitGapAssessment | null = null
  let status: DesignStatus = 'not-assessed'
  let feasible: boolean | null = null
  let headline = 'Platform sizing not requested'
  let explanation = 'This is a management-only engagement, so no workload platform is sized.'
  let totalNodes: number | null = null
  let workloadNodes: number | null = null
  let nodesLabel = 'Not requested'
  let licensableCoresValue: number | null = null
  let licensableCoresDetail = 'No platform is sized'
  let clusters: DesignClusterRow[] = []
  let growth: DesignGrowth | null = null
  let storage: DesignStorage | null = null
  let platformLabel = 'Management-only scope'
  let baselineNodes: number | null = null

  if (path === 'new-platform' && chosen) {
    platformLabel = chosen.label
    sizing = chosen.result
    placement = planMultipleClusters(chosen.cfg, platformVms, input.tiers, placementInputs, countedVms)
    const r = chosen.result
    const spare = chosen.cfg.spareNodes
    const noWorkload = includedVmCount === 0 && countedVms.length === 0
    if (noWorkload) {
      status = 'no-workload'
      feasible = null
      headline = 'Add workloads first'
      explanation = 'No workloads are included, so no platform is sized.'
      nodesLabel = 'Add workloads'
    } else if (splitRequested) {
      if (placement.feasible) {
        status = 'split'
        feasible = true
        totalNodes = placement.totalNodes
        workloadNodes = placement.totalWorkloadNodes
        nodesLabel = `${fmt(totalNodes, 0)} across ${plural(placement.clusters.length, 'cluster')}`
        headline = `${fmt(totalNodes, 0)} nodes across ${plural(placement.clusters.length, 'cluster')}, split by your choice`
        explanation = `Each cluster keeps its own N+${spare} reserve; ${fmt(workloadNodes, 0)} nodes carry workload in total.`
        licensableCoresValue = placement.clusters.reduce((sum, cluster) => sum + cluster.result.totalLicensableCores, 0)
        licensableCoresDetail = `${licensableCores(chosen.cfg.node)} per node × ${totalNodes} nodes across the clusters`
      } else {
        status = 'split-failed'
        feasible = false
        nodesLabel = 'Split placement not feasible'
        headline = 'The selected split cannot place this workload'
        explanation = placement.warnings.join(' ') || 'Revise the cluster ceiling, hardware density or grouping rules.'
        licensableCoresDetail = 'Not calculated: the split does not place the workload'
      }
    } else if (r.feasible) {
      status = 'feasible'
      feasible = true
      totalNodes = r.nodes
      workloadNodes = r.workloadNodes
      nodesLabel = fmt(r.nodes, 0)
      headline = `${r.nodes} nodes, ${r.workloadNodes} carrying workload after N+${spare}`
      explanation = r.bindingExplanation
      licensableCoresValue = r.totalLicensableCores
      licensableCoresDetail = `${r.licensableCoresPerNode} per node × ${r.nodes}`
    } else {
      status = r.nodesNeeded !== null && r.nodesNeeded > r.clusterNodeLimit ? 'over-limit' : 'blocked'
      feasible = false
      nodesLabel = singleClusterNodesLabel(r)
      headline = status === 'over-limit'
        ? `One cluster needs ${r.nodesNeeded} nodes; the limit is ${r.clusterNodeLimit}`
        : r.nodesNeeded === null ? 'No node count works with these inputs' : 'This design is blocked'
      explanation = status === 'over-limit'
        ? `${r.bindingExplanation} Nothing has been split: use a larger server, another storage type, or choose Split into multiple clusters.`
        : r.bindingExplanation
      licensableCoresDetail = 'Not calculated: the design does not fit'
    }
    clusters = noWorkload ? [] : placement.clusters.map(clusterRow)
    if (status === 'split-failed') {
      // A cluster above the chosen ceiling is part of why the split fails, so it is not shown as fine.
      const ceiling = Math.min(placementInputs.maxNodesPerCluster, chosen.result.clusterNodeLimit)
      clusters = clusters.map((cluster) => cluster.nodes !== null && cluster.nodes > ceiling
        ? { ...cluster, feasible: false, nodesLabel: `${cluster.nodes} (above the ${ceiling}-node ceiling)` }
        : cluster)
    }
    growth = noWorkload ? null : splitRequested
      ? splitGrowth(chosen.cfg, platformVms, input.tiers, placementInputs, countedVms)
      : singleClusterGrowth(chosen.cfg, platformVms, input.tiers, countedVms)

    const split = status === 'split'
    const reported = feasible === true
    const san = sanFields(chosen.cfg)
    const sharedFixedSan = split && san.sanMode === 'fixed' && placementInputs.sanCapacityScope === 'shared'
    const csvPlans: DesignCsvPlan[] | null = !reported
      ? null
      : split
        ? placement.clusters.flatMap((cluster) => cluster.result.csvPlans.map((plan) => ({ ...plan, cluster: cluster.name })))
        : r.csvPlans
    const sum = (pick: (result: SizingResult) => number) => placement!.clusters.reduce((total, cluster) => total + pick(cluster.result), 0)
    const sanToBuyUsable = !reported ? null : split
      ? placement.clusters.some((cluster) => cluster.result.sanSizing) ? sum((result) => result.sanSizing?.usableToBuyTiB ?? 0) : null
      : r.sanSizing?.usableToBuyTiB ?? null
    const sanToBuyEffective = !reported ? null : split
      ? placement.clusters.some((cluster) => cluster.result.sanSizing) ? sum((result) => result.sanSizing?.effectiveTiB ?? 0) : null
      : r.sanSizing?.effectiveTiB ?? null
    storage = noWorkload ? null : {
      architecture: chosen.cfg.architecture,
      requiredTiB: split ? sum((result) => result.requiredStorageTiB) : r.requiredStorageTiB,
      requiredS2dTiB: split ? sum((result) => result.requiredS2dTiB) : r.requiredS2dTiB,
      requiredSanTiB: split ? sum((result) => result.requiredSanTiB) : r.requiredSanTiB,
      s2dUsableTiB: !reported || chosen.cfg.architecture === 'san' ? null : split ? sum((result) => result.capacity?.usableTiB ?? 0) : r.capacity?.usableTiB ?? null,
      ...san,
      sanUsableTiB: san.sanMode === 'calculated' ? sanToBuyUsable : san.sanMode === 'fixed' && split && !sharedFixedSan ? (san.sanUsableTiB ?? 0) * placement.clusters.length : san.sanUsableTiB,
      sanEffectiveTiB: san.sanMode === 'calculated' ? sanToBuyEffective : san.sanMode === 'fixed' && split && !sharedFixedSan ? (san.sanEffectiveTiB ?? 0) * placement.clusters.length : san.sanEffectiveTiB,
      sanToBuyUsableTiB: sanToBuyUsable,
      sanToBuyEffectiveTiB: sanToBuyEffective,
      csvPlans,
      totalCsvs: csvPlans ? csvPlans.reduce((total, plan) => total + plan.count, 0) : null,
      csvNotCalculatedReason: reported ? null : status === 'split-failed'
        ? 'Not calculated: the selected split cannot place the workload.'
        : 'Not calculated: this design does not fit one cluster, so a volume layout would describe something that cannot be built.',
      showLocalDrives: chosen.cfg.architecture !== 'san',
      perCluster: split,
    }

    if (counted) {
      if (splitRequested) {
        baselineNodes = baselineSplit?.feasible ? baselineSplit.totalNodes : null
      } else {
        baselineNodes = baselineChosen?.result.feasible ? baselineChosen.result.nodes : null
      }
    }
  } else if (path === 'existing') {
    platformLabel = `Existing ${existingCfg.architecture.toUpperCase()} estate`
    fitGap = assessFitGap(existingCfg, existingNodes, platformVms, existingTiers, countedVms)
    sizing = fitGap.required
    const reverse = fitGap.reverse
    totalNodes = existingNodes
    workloadNodes = reverse.workloadNodes
    nodesLabel = fmt(existingNodes, 0)
    const coresPerNode = licensableCores(existingCfg.node)
    licensableCoresValue = coresPerNode * existingNodes
    licensableCoresDetail = `${coresPerNode} per node × ${existingNodes} entered nodes`
    if (fitGap.fits === null) {
      status = 'no-workload'
      feasible = null
      headline = `Capacity of the ${existingNodes} entered nodes`
      explanation = reverse.bindingExplanation
    } else if (fitGap.fits) {
      status = 'fits'
      feasible = true
      headline = `Fits on the ${existingNodes} entered nodes`
      explanation = reverse.bindingExplanation
    } else {
      status = 'does-not-fit'
      feasible = false
      headline = `Does not fit the ${existingNodes} entered nodes`
      explanation = [reverse.bindingExplanation, ...fitGap.recommendations.slice(0, 1)].join(' ')
    }
    clusters = includedVmCount === 0 && countedVms.length === 0 ? [] : [{
      id: 'existing-cluster',
      name: 'Existing cluster',
      purpose: 'Entered estate',
      workloadVms: includedVmCount,
      managementVms: countedVms.length,
      nodes: existingNodes,
      workloadNodes: reverse.workloadNodes,
      nodesLabel: `${existingNodes} entered`,
      binding: reverse.binding,
      feasible: fitGap.fits !== false,
      sourceClusters: [...new Set(platformVms.filter((vm) => vm.include).map((vm) => vm.sourceCluster).filter((value): value is string => !!value))],
      confidence: confidenceText(fitGap.required),
      requiredStorageTiB: reverse.usedStorageTiB,
      s2dUsableTiB: reverse.capacity?.usableTiB ?? null,
      sanToBuyUsableTiB: null,
      licensableCores: licensableCoresValue,
    }]
    growth = includedVmCount === 0 ? null : existingGrowth(existingCfg, platformVms, existingTiers, countedVms, existingNodes)
    const s2d = reverse.storageDomains.find((domain) => domain.domain === 's2d')
    const sanDomain = reverse.storageDomains.find((domain) => domain.domain === 'san')
    const san = sanFields(existingCfg)
    const reported = fitGap.fits === true
    storage = {
      architecture: existingCfg.architecture,
      requiredTiB: reverse.usedStorageTiB,
      requiredS2dTiB: s2d?.usedTiB ?? 0,
      requiredSanTiB: sanDomain?.usedTiB ?? 0,
      s2dUsableTiB: reverse.capacity?.usableTiB ?? null,
      ...san,
      sanToBuyUsableTiB: null,
      sanToBuyEffectiveTiB: null,
      csvPlans: reported ? reverse.csvPlans : null,
      totalCsvs: reported ? reverse.csvPlans.reduce((total, plan) => total + plan.count, 0) : null,
      csvNotCalculatedReason: reported ? null : fitGap.fits === null
        ? 'Not calculated: add workloads to plan storage objects.'
        : `Not calculated: the workload does not fit the ${existingNodes} entered nodes.`,
      showLocalDrives: existingCfg.architecture !== 'san',
      perCluster: false,
    }
    if (counted) {
      const baseline = solveForward(existingCfg, platformVms, existingTiers)
      baselineNodes = baseline.feasible ? baseline.nodes : null
    }
  }

  // Dedicated management cluster.
  let dedicated: DesignManagement['dedicated'] = null
  if (designed && managementInputs.managementPlacement === 'dedicated-management-cluster' && managementVms.length > 0) {
    // Management-only has no workload hardware, so the reference server is the stated basis.
    const result = solveForward(cfg, [], tiers, managementVms)
    const basis = path === 'management-only'
      ? `Sized on the reference server (${cfg.node.sockets} × ${cfg.node.coresPerSocket} cores, ${cfg.node.ramGiB} GiB RAM) with N+${cfg.spareNodes}. It is a starting assumption: change it on the reference server page.`
      : null
    dedicated = { nodes: result.feasible ? result.nodes : null, sizing: result, reason: result.feasible ? null : result.bindingExplanation, basis }
  }

  const managementWarnings: string[] = []
  if (path === 'management-only' && designed) {
    if (managementInputs.managedHosts <= 0) managementWarnings.push('Managed hosts are 0. Enter the hosts this management plane will manage; the bill of materials is not sized for a host count until then.')
    if (managementInputs.managedVms <= 0) managementWarnings.push('Managed workload VMs are 0. Enter the workload VMs this management plane will manage; SCOM and Arc sizing depend on them.')
  }

  // Host impact, attributed to management only when management VMs exist and cause it.
  const designNodesWithManagement = path === 'existing'
    ? sizing?.feasible ? sizing.nodes : null
    : status === 'split' || status === 'feasible' ? totalNodes : null
  const hostDelta = counted && baselineNodes !== null && designNodesWithManagement !== null
    ? Math.max(0, designNodesWithManagement - baselineNodes)
    : null
  let impactLabel: string
  let impactDetail: string
  if (!designed) {
    impactLabel = 'Not part of the design'
    impactDetail = 'No management design is saved.'
  } else if (path === 'management-only') {
    impactLabel = 'Platform not supplied'
    impactDetail = 'No workload cluster is part of this engagement.'
  } else if (managementInputs.managementPlacement !== 'workload-cluster') {
    impactLabel = 'Separate capacity domain'
    impactDetail = 'Management VMs do not use workload-cluster capacity.'
  } else if (!input.includeManagementInSizing) {
    impactLabel = 'Excluded from sizing by choice'
    impactDetail = 'Management overhead is excluded from the workload result.'
  } else if (managementVms.length === 0) {
    impactLabel = 'No management VMs'
    impactDetail = 'The saved design has no management VMs to place.'
  } else if (hostDelta === null) {
    impactLabel = 'Could not compare: the design does not fit'
    impactDetail = 'A node count is needed with and without management to compare.'
  } else {
    impactLabel = hostDelta > 0 ? `+${plural(hostDelta, 'node')}` : 'No additional nodes'
    impactDetail = hostDelta > 0 ? `${managementVms.length} management VMs add ${plural(hostDelta, 'node')}.` : `${managementVms.length} management VMs fit without extra nodes.`
  }

  // Network nodes: only a design with a node count can be cabled.
  let network: PlatformDesign['network']
  if (path === 'management-only') {
    network = { nodes: null, reason: 'Not calculated: no platform hardware in a management-only engagement.' }
  } else if (path === 'existing') {
    network = { nodes: existingNodes + (dedicated?.nodes ?? 0), reason: null }
  } else if (totalNodes !== null) {
    network = { nodes: totalNodes + (dedicated?.nodes ?? 0), reason: null }
  } else {
    network = { nodes: null, reason: status === 'no-workload'
      ? 'Not calculated: add workloads to size the platform first.'
      : status === 'split-failed'
        ? 'Not calculated: the selected split cannot place the workload, so there is no node count to cable.'
        : 'Not calculated: the design does not fit, so there is no node count to cable.' }
  }

  const findings = path === 'existing' ? fitGap?.reverse.findings ?? [] : sizing?.findings ?? []
  const errors = [
    ...findings.filter((finding) => finding.severity === 'error').map((finding) => finding.message),
    ...(status === 'split-failed' ? placement?.warnings ?? [] : []),
    ...(status === 'does-not-fit' && findings.every((finding) => finding.severity !== 'error') ? [headline] : []),
  ]

  return {
    path,
    engagementMode,
    platformLabel,
    cfg,
    tiers,
    options,
    chosen,
    includedVmCount,
    management: {
      decision,
      designed,
      inputs: managementInputs,
      rawInputs: resolvedManagement.inputs,
      source: resolvedManagement.source,
      advisor: resolvedManagement.advisor,
      errors: designed ? managementPlan.errors : [],
      warnings: managementWarnings,
      plan: managementPlan,
      vms: managementVms,
      counted,
      countedVms,
      contextNodes,
      contextNote,
      dedicated,
      hostDelta,
      impactLabel,
      impactDetail,
    },
    layout: placementInputs.clusterLayout,
    splitRequested,
    splitFeasible: status === 'split',
    placement,
    sizing,
    status,
    feasible,
    headline,
    explanation,
    totalNodes,
    workloadNodes,
    nodesLabel,
    licensableCores: licensableCoresValue,
    licensableCoresDetail,
    clusters,
    growth,
    storage,
    fitGap,
    network,
    findings,
    errors: [...new Set(errors)],
  }
}

/** One-word outcome for tables that compare designs. */
export function designResultLabel(design: PlatformDesign): string {
  switch (design.status) {
    case 'feasible': return 'Fits one cluster'
    case 'split': return 'Split fits'
    case 'split-failed': return 'Split not feasible'
    case 'over-limit': return 'Over the cluster limit'
    case 'blocked': return 'Blocked'
    case 'fits': return 'Fits'
    case 'does-not-fit': return 'Does not fit'
    case 'no-workload': return 'No workloads'
    default: return 'Not assessed'
  }
}

/** True when the design cannot be approved as reported. */
export function designIsBlocked(design: PlatformDesign): boolean {
  return design.feasible === false || design.errors.length > 0
}
