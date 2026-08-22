import { MANAGEMENT_PLANES, type PlaneId } from '../data/managementPlane'
import {
  deploymentComponentsToVms,
  deploymentInputsFromStack,
  normalizeManagementDeploymentInputs,
  planManagementDeployment,
  type ManagementDeploymentInputs,
} from '../engine/managementDeployment'
import { compareArchitectures, forecastGrowth, solveForward } from '../engine/solve'
import { RESILIENCY } from '../engine/rules'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'
import { DEFAULT_PLACEMENT_INPUTS, planMultipleClusters, type PlacementInputs } from '../engine/deploymentPlanning'
import { assessMigrationReadiness } from '../engine/readiness'
import { DEFAULT_NETWORK_INPUTS, designNetwork, type NetworkDesignInputs } from '../engine/networkDesign'
import { DEFAULT_DR_INPUTS, designDisasterRecovery, type DrDesignInputs } from '../engine/drDesign'
import { DEFAULT_REPORT_METADATA, ENGINE_VERSION, type ProjectDataSource, type ReportMetadata } from '../state/project'
import { assessFitGap } from '../engine/fitGap'
import { DEFAULT_CONFIG, defaultTiers } from '../state/defaults'
import { ENGAGEMENT_LABELS, type EngagementMode, type ManagementDecision } from '../state/journey'

export const REPORT_SECTION_DEFINITIONS = [
  { id: 'executive', label: 'Executive summary' },
  { id: 'architecture', label: 'Solution architecture' },
  { id: 'nodes', label: 'Node requirements' },
  { id: 'existing', label: 'Existing capacity and fit' },
  { id: 'deployment', label: 'Multi-cluster implementation plan' },
  { id: 'workloads', label: 'Workload summary' },
  { id: 'data-quality', label: 'Sizing evidence and confidence' },
  { id: 'readiness', label: 'Migration readiness' },
  { id: 'storage', label: 'Storage and CSV plan' },
  { id: 'network', label: 'Network design' },
  { id: 'recovery', label: 'Backup and disaster recovery' },
  { id: 'management', label: 'Management plane' },
  { id: 'assumptions', label: 'Assumptions and policies' },
  { id: 'findings', label: 'Findings and cautions' },
  { id: 'inventory', label: 'VM inventory' },
  { id: 'sources', label: 'Sources and methodology' },
] as const

export type ReportSectionId = typeof REPORT_SECTION_DEFINITIONS[number]['id']
export type ReportSelection = Record<ReportSectionId, boolean>

export interface ReportOutputOptions {
  includeDecisionReasoning: boolean
}

export const DEFAULT_REPORT_OUTPUT_OPTIONS: ReportOutputOptions = {
  includeDecisionReasoning: false,
}

export interface ReportMetric {
  label: string
  value: string
  detail?: string
}

export interface ReportTable {
  title?: string
  headers: string[]
  rows: string[][]
}

export interface ReportReasoningItem {
  decision: string
  basis: 'User-selected' | 'Calculated' | 'Derived from inputs' | 'Validation requirement'
  explanation: string
  tradeoff?: string
}

export interface ReportSection {
  id: ReportSectionId
  title: string
  paragraphs: string[]
  metrics: ReportMetric[]
  reasoning: ReportReasoningItem[]
  bullets: string[]
  tables: ReportTable[]
}

export interface SolutionReport {
  schemaVersion: 3
  title: string
  customerName: string
  generatedAt: string
  selectedArchitecture: string
  metadata: ReportMetadata
  sections: ReportSection[]
}

export interface SolutionReportInputs {
  engagementMode?: EngagementMode | null
  managementDecision?: ManagementDecision
  customerName: string
  cfg: ClusterConfig
  vms: Vm[]
  tiers: Record<TierId, TierPolicy>
  chosenKey: string
  managementDeploymentInputs: ManagementDeploymentInputs | null
  includeManagementInSizing: boolean
  generatedAt?: string
  placementInputs?: PlacementInputs
  networkDesignInputs?: NetworkDesignInputs
  drDesignInputs?: DrDesignInputs
  reportMetadata?: ReportMetadata
  dataSources?: ProjectDataSource[]
  existingCapacityCfg?: ClusterConfig
  existingCapacityTiers?: Record<TierId, TierPolicy>
  existingCapacityNodes?: number
}

export function defaultReportSelection(engagementMode?: EngagementMode | null): ReportSelection {
  const selection = Object.fromEntries(REPORT_SECTION_DEFINITIONS.map(({ id }) => [id, true])) as ReportSelection
  if (engagementMode === 'new-platform') selection.existing = false
  if (engagementMode === 'management-only') {
    REPORT_SECTION_DEFINITIONS.forEach(({ id }) => { selection[id] = id === 'executive' || id === 'management' || id === 'sources' })
  }
  return selection
}

function number(value: number, maximumFractionDigits = 0) {
  return value.toLocaleString('en-US', { maximumFractionDigits })
}

function gib(value: number) {
  return `${number(value)} GiB`
}

function tib(value: number | null) {
  return value === null ? 'Not applicable' : `${number(value, 2)} TiB`
}

function yesNo(value: boolean) {
  return value ? 'Yes' : 'No'
}

function managementLabel(inputs: ManagementDeploymentInputs) {
  const resolved = normalizeManagementDeploymentInputs(inputs)
  const foundation = inputs.foundation === 'scvmm'
    ? `SCVMM 2025 (${resolved.fabricHighAvailability ? 'HA' : 'standalone'})`
    : 'Classic Hyper-V tools'
  const wac = inputs.wac === 'wac-admin'
    ? 'WAC Administration Mode'
    : inputs.wac === 'wac-virtual'
      ? 'WAC Virtualization Mode'
      : 'No WAC gateway'
  const monitoring = inputs.monitoring === 'scom'
    ? resolved.scomHighAvailability
      ? `SCOM 2025 HA${resolved.scomSqlPlacement === 'shared-vmm' && inputs.foundation === 'scvmm' ? ' on shared VMM SQL infrastructure' : ''}`
      : 'SCOM 2025 single-server management group'
    : 'Existing / no monitoring platform'
  const arc = inputs.includeArc
    ? `; Azure Arc core management${resolved.arcServices.length ? ` + ${resolved.arcServices.length} add-on${resolved.arcServices.length === 1 ? '' : 's'}` : ' only'}`
    : ''
  return `${foundation}; ${wac}; ${monitoring}${arc}`
}

function storageProtectionMetric(cfg: ClusterConfig): ReportMetric {
  const s2dResiliency = RESILIENCY[cfg.resiliency].label
  if (cfg.architecture === 'san') {
    return {
      label: 'Storage protection',
      value: 'External SAN (array-managed; not modeled)',
      detail: 'S2D resiliency does not apply to this design. Confirm array protection and replication in the final storage design.',
    }
  }
  if (cfg.architecture === 'hybrid') {
    return {
      label: 'Storage protection',
      value: `S2D: ${s2dResiliency}; SAN: array-managed`,
      detail: 'The S2D setting applies only to S2D-hosted data. SAN protection and replication are not modeled by Surveyor.',
    }
  }
  return {
    label: 'S2D resiliency',
    value: s2dResiliency,
    detail: 'Applies to Storage Spaces Direct capacity in this design.',
  }
}

export function buildSolutionReport(input: SolutionReportInputs): SolutionReport {
  const includedVms = input.vms.filter((vm) => vm.include)
  const options = compareArchitectures(input.cfg, input.vms, input.tiers)
  const chosen = options.find((option) => option.key === input.chosenKey) ?? options[0]
  const engagementMode = input.engagementMode ?? 'new-platform'
  const managementDecision = input.managementDecision ?? (input.managementDeploymentInputs ? 'design' : 'unassessed')
  const usesExistingHardware = engagementMode === 'existing-capacity' || engagementMode === 'fit-gap'
  const existingCfg = input.existingCapacityCfg ?? structuredClone(DEFAULT_CONFIG)
  const existingTiers = input.existingCapacityTiers ?? defaultTiers()
  const existingNodes = Math.max(1, input.existingCapacityNodes ?? 8)
  const platformVms = engagementMode === 'management-only' ? [] : input.vms
  const platformCfg = usesExistingHardware ? existingCfg : chosen.cfg
  const platformTiers = usesExistingHardware ? existingTiers : input.tiers
  const selectedPlatformLabel = engagementMode === 'management-only'
    ? 'Management-only scope'
    : usesExistingHardware
      ? `Existing ${existingCfg.architecture.toUpperCase()} estate`
      : chosen.label
  const managementContextNodes = engagementMode === 'management-only'
    ? input.managementDeploymentInputs?.managedHosts ?? 0
    : usesExistingHardware ? existingNodes : chosen.result.feasible ? chosen.result.nodes : 0
  const defaultStack: PlaneId[] = managementContextNodes <= 4
    ? ['classic', 'wac-admin']
    : ['scvmm', 'wac-admin']
  const managementInputs = normalizeManagementDeploymentInputs(input.managementDeploymentInputs
    ? { ...input.managementDeploymentInputs, monitoring: input.managementDeploymentInputs.monitoring ?? 'none' }
    : deploymentInputsFromStack(
      defaultStack,
      managementContextNodes,
      includedVms.length,
    ))
  const managementPlan = planManagementDeployment(managementInputs)
  const managementVms = deploymentComponentsToVms(managementPlan.components)
  const managementConsumesPlatform = managementDecision === 'design'
    && input.includeManagementInSizing
    && managementInputs.managementPlacement === 'workload-cluster'
    && engagementMode !== 'management-only'
  const placementPlan = planMultipleClusters(platformCfg, platformVms, platformTiers, input.placementInputs ?? DEFAULT_PLACEMENT_INPUTS, managementConsumesPlatform ? managementVms : [])
  const dedicatedManagementSizing = engagementMode !== 'management-only' && managementDecision === 'design' && managementInputs.managementPlacement === 'dedicated-management-cluster' && managementVms.length > 0
    ? solveForward(platformCfg, managementVms, platformTiers)
    : null
  const readiness = assessMigrationReadiness(platformVms, platformCfg)
  const networkNodes = (usesExistingHardware ? existingNodes : placementPlan.totalNodes) + (dedicatedManagementSizing?.feasible ? dedicatedManagementSizing.nodes : 0)
  const network = designNetwork(platformCfg, networkNodes, input.networkDesignInputs ?? DEFAULT_NETWORK_INPUTS)
  const metadata = { ...DEFAULT_REPORT_METADATA, ...input.reportMetadata }
  const baselineGrowthForecast = forecastGrowth(platformCfg, platformVms, platformTiers)
  const growthForecast = forecastGrowth(
    platformCfg,
    platformVms,
    platformTiers,
    managementConsumesPlatform ? managementVms : [],
  )
  const plannedGrowthPoint = growthForecast.plan.strategy === 'build-now'
    ? growthForecast.points[growthForecast.points.length - 1]
    : growthForecast.points[0]
  const finalSizing = plannedGrowthPoint.result
  const baselineGrowthPoint = baselineGrowthForecast.plan.strategy === 'build-now'
    ? baselineGrowthForecast.points[baselineGrowthForecast.points.length - 1]
    : baselineGrowthForecast.points[0]
  const managementHostDelta = !managementConsumesPlatform || !finalSizing.feasible
    ? null
    : usesExistingHardware
      ? Math.max(0, finalSizing.nodes - existingNodes)
      : baselineGrowthPoint.result.feasible ? finalSizing.nodes - baselineGrowthPoint.result.nodes : null
  const fitGap = assessFitGap(existingCfg, existingNodes, input.vms, existingTiers)
  const recovery = designDisasterRecovery(platformVms, finalSizing, input.drDesignInputs ?? DEFAULT_DR_INPUTS)

  const workloadTotals = includedVms.reduce((totals, vm) => ({
    vCpu: totals.vCpu + vm.vCpu,
    ramGiB: totals.ramGiB + vm.ramGiB,
    storageGiB: totals.storageGiB + vm.storageGiB,
    provisionedGiB: totals.provisionedGiB + vm.provisionedGiB,
  }), { vCpu: 0, ramGiB: 0, storageGiB: 0, provisionedGiB: 0 })

  const tierRows = (Object.keys(platformTiers) as TierId[]).map((tierId) => {
    const tierVms = includedVms.filter((vm) => vm.tier === tierId)
    return [
      platformTiers[tierId].label,
      number(tierVms.length),
      number(tierVms.reduce((sum, vm) => sum + vm.vCpu, 0)),
      gib(tierVms.reduce((sum, vm) => sum + vm.ramGiB, 0)),
      tib(tierVms.reduce((sum, vm) => sum + vm.storageGiB, 0) / 1024),
    ]
  })

  const sourceMap = new Map<string, string>()
  if (engagementMode !== 'management-only') {
    finalSizing.findings.forEach((finding) => {
      if (finding.source) sourceMap.set(finding.source, finding.message)
    })
  }
  if (managementDecision === 'design') {
    managementPlan.components.forEach((component) => {
      if (component.source) sourceMap.set(component.source, component.name)
    })
    managementPlan.arcServices.forEach((service) => sourceMap.set(service.source, service.name))
  }
  if (engagementMode !== 'management-only') {
    network.findings.forEach((finding) => { if (finding.source) sourceMap.set(finding.source, finding.message) })
    recovery.findings.forEach((finding) => { if (finding.source) sourceMap.set(finding.source, finding.message) })
  }

  const engagementOutcome = engagementMode === 'new-platform'
    ? `${input.customerName || 'This solution'} is sized on ${chosen.label}. ${finalSizing.feasible ? `The calculated design requires ${finalSizing.nodes} nodes, including ${platformCfg.spareNodes} spare nodes.` : 'The selected design is not currently feasible within the platform limits.'}`
    : engagementMode === 'existing-capacity'
      ? `${input.customerName || 'This solution'} assesses an existing ${existingNodes}-node ${existingCfg.architecture.toUpperCase()} estate. ${includedVms.length > 0 ? `${includedVms.length.toLocaleString()} included workloads are applied to the capacity envelope.` : 'No workload inventory was supplied, so estate-specific utilization is not asserted.'}`
      : engagementMode === 'fit-gap'
        ? `${input.customerName || 'This solution'} tests ${includedVms.length.toLocaleString()} included workloads against an existing ${existingNodes}-node ${existingCfg.architecture.toUpperCase()} estate. ${fitGap.fits === null ? 'A fit decision requires workload evidence.' : fitGap.fits ? 'The complete included estate fits.' : 'The complete included estate does not fit under the entered assumptions.'}`
        : `${input.customerName || 'This solution'} is a management-only engagement. Platform hardware sizing was not requested; the report documents the management topology, virtual-machine bill of materials, dependencies, and operating-model decisions.`
  const managementDecisionLabel = managementDecision === 'design'
    ? 'Management design included'
    : managementDecision === 'existing'
      ? 'Existing solution recorded'
      : managementDecision === 'deferred'
        ? 'Decision deferred'
        : 'Not assessed'
  const placementInputs = input.placementInputs ?? DEFAULT_PLACEMENT_INPUTS
  const networkInputs = input.networkDesignInputs ?? DEFAULT_NETWORK_INPUTS
  const recoveryInputs = input.drDesignInputs ?? DEFAULT_DR_INPUTS
  const architectureAlternatives = options
    .filter((option) => option.key !== chosen.key)
    .map((option) => `${option.label}: ${option.result.feasible ? `${option.result.nodes} nodes` : 'not feasible'}`)
    .join('; ')

  const sections: ReportSection[] = [
    {
      id: 'executive',
      title: 'Executive summary',
      paragraphs: [
        engagementOutcome,
        `Management status: ${managementDecisionLabel}. ${managementConsumesPlatform ? `${managementPlan.totalInstances} management VM instances are included in workload-cluster capacity.` : 'Management infrastructure does not consume workload-cluster capacity in this result.'}`,
      ],
      metrics: [
        { label: 'Engagement', value: ENGAGEMENT_LABELS[engagementMode] },
        { label: 'Platform context', value: selectedPlatformLabel },
        { label: usesExistingHardware ? 'Existing nodes' : engagementMode === 'management-only' ? 'Platform sizing' : 'Required nodes', value: engagementMode === 'management-only' ? 'Not requested' : usesExistingHardware ? number(existingNodes) : finalSizing.feasible ? number(finalSizing.nodes) : 'Review required', detail: engagementMode === 'management-only' ? undefined : finalSizing.bindingExplanation },
        { label: 'Workload VMs', value: number(includedVms.length) },
        { label: 'Management decision', value: managementDecisionLabel },
        { label: 'Management VMs', value: managementDecision === 'design' ? number(managementPlan.totalInstances) : 'Not calculated', detail: managementConsumesPlatform ? 'Included in workload-cluster sizing' : 'Separate from workload-cluster sizing' },
      ],
      reasoning: [
        {
          decision: `Use the ${ENGAGEMENT_LABELS[engagementMode]} planning path`,
          basis: 'User-selected',
          explanation: engagementMode === 'new-platform'
            ? 'The project is solving forward from workload demand to a proposed hardware platform.'
            : engagementMode === 'existing-capacity'
              ? 'The project is documenting what the entered estate can host without asserting a new hardware recommendation.'
              : engagementMode === 'fit-gap'
                ? 'The project compares the supplied workload inventory with the entered existing estate so gaps and same-spec expansion can be calculated.'
                : 'The project scope is limited to the management plane, so workload-platform hardware is intentionally not inferred.',
          tradeoff: 'Changing the planning path changes which conclusions are valid; a management-only or existing-capacity report must not be read as a greenfield hardware recommendation.',
        },
        {
          decision: managementDecisionLabel,
          basis: 'User-selected',
          explanation: managementDecision === 'design'
            ? `The saved management topology produces ${managementPlan.totalInstances} component instances and is included as an explicit solution workstream.`
            : managementDecision === 'existing'
              ? 'The report records that a management solution already exists but does not claim that its topology or capacity was validated.'
              : managementDecision === 'deferred'
                ? 'The management decision remains open by design and should be closed before implementation approval.'
                : 'No management assessment was completed, which is different from selecting no management solution.',
        },
      ],
      bullets: [
        ...(metadata.decisionNotes ? [`Decision / sign-off: ${metadata.decisionNotes}`] : []),
        ...(finalSizing.feasible ? [] : finalSizing.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.message)),
      ],
      tables: [],
    },
    {
      id: 'architecture',
      title: 'Solution architecture',
      paragraphs: [engagementMode === 'management-only' ? 'No platform architecture was assessed in this management-only engagement.' : finalSizing.bindingExplanation],
      metrics: [
        { label: 'Architecture', value: selectedPlatformLabel },
        ...(engagementMode === 'management-only' ? [] : [storageProtectionMetric(platformCfg)]),
        { label: 'Failure reserve', value: engagementMode === 'management-only' ? 'Not assessed' : `N+${platformCfg.spareNodes}` },
        { label: 'Binding constraint', value: engagementMode === 'management-only' ? 'Not assessed' : finalSizing.binding },
      ],
      reasoning: engagementMode === 'management-only' ? [] : [
        {
          decision: `Use ${selectedPlatformLabel}`,
          basis: 'User-selected',
          explanation: `This is the architecture selected in Sizing Results. Surveyor validates its feasibility and calculates its node count, but it does not silently choose the architecture on the user's behalf. The selected result is ${finalSizing.feasible ? `feasible at ${finalSizing.nodes} nodes` : 'not currently feasible'} and is ${finalSizing.binding}-bound.`,
          tradeoff: architectureAlternatives ? `Other modeled outcomes were ${architectureAlternatives}. Node count is only one decision factor; storage ownership, operations, supportability, recovery, and cost still require review.` : undefined,
        },
        {
          decision: platformCfg.architecture === 'san'
            ? 'Use external SAN protection semantics'
            : platformCfg.architecture === 'hybrid'
              ? 'Apply protection separately to S2D and SAN data'
              : `Use ${RESILIENCY[platformCfg.resiliency].label}`,
          basis: 'Derived from inputs',
          explanation: platformCfg.architecture === 'san'
            ? 'The selected architecture stores workload data on the external array. Surveyor models effective SAN capacity but does not apply an S2D mirror or parity setting to SAN data.'
            : platformCfg.architecture === 'hybrid'
              ? `The ${RESILIENCY[platformCfg.resiliency].label} setting applies only to S2D-hosted data; SAN protection remains array-managed.`
              : `The selected S2D resiliency controls usable-capacity efficiency and local fault tolerance for S2D-hosted data.`,
          tradeoff: platformCfg.architecture === 'san' || platformCfg.architecture === 'hybrid'
            ? 'Array RAID, snapshots, replication, and failure-domain behavior must be confirmed in the storage design because they are not inferred here.'
            : 'More protective S2D layouts consume more raw capacity; the final design must also satisfy the platform minimum-node rules.',
        },
        {
          decision: `Reserve N+${platformCfg.spareNodes} host capacity`,
          basis: 'User-selected',
          explanation: `${platformCfg.spareNodes} node${platformCfg.spareNodes === 1 ? '' : 's'} are withheld from normal workload capacity so the design can absorb the selected host-failure reserve. The solver sizes workload demand first and includes this reserve in the total node count.`,
          tradeoff: 'This is a capacity reserve, not a complete availability design; storage, network, witness, backup, and management-plane failure domains are evaluated separately.',
        },
      ],
      bullets: [],
      tables: engagementMode === 'new-platform' ? [{
        title: 'Architecture comparison',
        headers: ['Option', 'Feasible', 'Nodes', 'Binding constraint'],
        rows: options.map((option) => [
          option.label,
          yesNo(option.result.feasible),
          option.result.feasible ? number(option.result.nodes) : 'N/A',
          option.result.binding,
        ]),
      }] : [],
    },
    {
      id: 'nodes',
      title: 'Node requirements',
      paragraphs: engagementMode === 'management-only' ? [
        'Platform node sizing was not requested for this management-only engagement. Add a new-platform or existing-hardware profile before using this report to make host-capacity decisions.',
      ] : [
        finalSizing.bindingExplanation,
        growthForecast.plan.strategy === 'build-now'
          ? `The current design includes the full Year ${growthForecast.plan.horizonYears} forecast at ${(growthForecast.plan.annualGrowthPct * 100).toFixed(1)}% compounded annual workload growth.`
          : `The current design is sized for today's demand; the timeline phases node additions over ${growthForecast.plan.horizonYears} years at ${(growthForecast.plan.annualGrowthPct * 100).toFixed(1)}% compounded annual workload growth.`,
      ],
      metrics: engagementMode === 'management-only' ? [
        { label: 'Platform node sizing', value: 'Not assessed' },
      ] : [
        { label: 'Total nodes', value: finalSizing.feasible ? number(finalSizing.nodes) : 'Review required' },
        { label: 'Workload-bearing nodes', value: finalSizing.feasible ? number(finalSizing.workloadNodes) : 'N/A' },
        { label: 'CPU-only requirement', value: Number.isFinite(finalSizing.nodesIfCpuOnly) ? number(finalSizing.nodesIfCpuOnly) : 'N/A' },
        { label: 'Memory-only requirement', value: Number.isFinite(finalSizing.nodesIfMemoryOnly) ? number(finalSizing.nodesIfMemoryOnly) : 'N/A' },
        { label: 'Storage-only requirement', value: Number.isFinite(finalSizing.nodesIfStorageOnly) ? number(finalSizing.nodesIfStorageOnly) : 'N/A' },
        { label: 'Licensable cores', value: number(finalSizing.totalLicensableCores) },
        { label: 'Growth strategy', value: growthForecast.plan.strategy === 'build-now' ? 'Build forecast capacity now' : 'Phase nodes with growth' },
        { label: 'Annual growth', value: `${number(growthForecast.plan.annualGrowthPct * 100, 1)}% for ${growthForecast.plan.horizonYears} years` },
      ],
      reasoning: engagementMode === 'management-only' ? [] : [
        {
          decision: finalSizing.feasible ? `Build ${finalSizing.nodes} total nodes` : 'Revise the node design before approval',
          basis: 'Calculated',
          explanation: `CPU alone requires ${Number.isFinite(finalSizing.nodesIfCpuOnly) ? number(finalSizing.nodesIfCpuOnly) : 'more than the supported ceiling'} nodes, memory alone requires ${Number.isFinite(finalSizing.nodesIfMemoryOnly) ? number(finalSizing.nodesIfMemoryOnly) : 'more than the supported ceiling'}, and storage alone requires ${Number.isFinite(finalSizing.nodesIfStorageOnly) ? number(finalSizing.nodesIfStorageOnly) : 'more than the supported ceiling'}. The controlling result is ${finalSizing.binding}; the total includes ${platformCfg.spareNodes} reserve node${platformCfg.spareNodes === 1 ? '' : 's'}.`,
          tradeoff: `Changing a nonbinding resource may not reduce node count. To reduce a ${finalSizing.binding}-bound result, change the demand or usable capacity that actually controls that constraint and rerun the model.`,
        },
        {
          decision: growthForecast.plan.strategy === 'build-now'
            ? `Build for the Year ${growthForecast.plan.horizonYears} forecast now`
            : 'Phase node additions as demand grows',
          basis: 'User-selected',
          explanation: `The forecast compounds workload demand by ${number(growthForecast.plan.annualGrowthPct * 100, 1)}% annually for ${growthForecast.plan.horizonYears} years. ${growthForecast.plan.strategy === 'build-now' ? 'The terminal forecast point controls the initial build.' : 'Today controls the initial build and later timeline rows identify when additional nodes are required.'}`,
          tradeoff: 'The growth rate is a planning assumption, not measured demand. Reforecast at least annually and before large workload onboarding events.',
        },
      ],
      bullets: [],
      tables: engagementMode === 'management-only' ? [] : [
        {
          title: 'Per-node hardware profile',
          headers: ['Sockets', 'Cores / socket', 'Physical cores', 'Memory', 'Capacity drives', 'Cache drives'],
          rows: [[
            number(platformCfg.node.sockets),
            number(platformCfg.node.coresPerSocket),
            number(platformCfg.node.sockets * platformCfg.node.coresPerSocket),
            gib(platformCfg.node.ramGiB),
            `${platformCfg.node.capacityDrivesPerNode} x ${platformCfg.node.capacityDriveTB} TB`,
            `${platformCfg.node.cacheDrivesPerNode} x ${platformCfg.node.cacheDriveTB} TB`,
          ]],
        },
        {
          title: 'Node growth timeline',
          headers: ['Timeline', 'Demand multiplier', 'Nodes required', 'Binding constraint', 'Deployment action'],
          rows: growthForecast.points.map((point, index) => {
            const action = !point.result.feasible
              ? point.result.sanCapacityTiB !== null && point.result.requiredSanTiB > point.result.sanCapacityTiB
                ? `Expand SAN effective capacity by ${number(point.result.requiredSanTiB - point.result.sanCapacityTiB, 1)} TiB`
                : 'Review node density or split into multiple clusters'
              : growthForecast.plan.strategy === 'build-now'
                ? index === 0
                  ? `Build ${growthForecast.plannedNodesToday ?? 'N/A'} nodes now`
                  : `Covered by initial ${growthForecast.plannedNodesToday ?? 'N/A'}-node build`
                : index === 0
                  ? `Initial build: ${point.result.nodes} nodes`
                  : point.additionalNodes && point.additionalNodes > 0
                    ? `Add ${point.additionalNodes} node${point.additionalNodes === 1 ? '' : 's'}`
                    : 'No node addition'
            return [
              point.year === 0 ? 'Today' : `Year ${point.year}`,
              `${number(point.demandFactor, 2)}x`,
              point.result.feasible ? number(point.result.nodes) : 'Review required',
              point.result.binding,
              action,
            ]
          }),
        },
      ],
    },
    {
      id: 'existing',
      title: 'Existing capacity and fit',
      paragraphs: engagementMode === 'management-only' ? [
        'No existing-hardware profile is part of this management-only engagement.',
      ] : [
        engagementMode === 'existing-capacity'
          ? 'This section describes the capacity envelope of the hardware already owned or quoted. Inventory-specific consumption is shown only when workloads were supplied.'
          : engagementMode === 'fit-gap'
            ? 'This section combines the existing-hardware profile with the workload inventory to produce the fit, deficit, and same-spec expansion decision.'
            : 'Existing-hardware analysis is retained as an independent workspace and does not change the proposed new-platform design.',
      ],
      metrics: engagementMode === 'management-only' ? [
        { label: 'Existing hardware', value: 'Not assessed' },
      ] : [
        { label: 'Existing nodes', value: number(existingNodes) },
        { label: 'Workload-bearing nodes', value: number(fitGap.reverse.workloadNodes) },
        { label: 'Usable physical cores', value: number(fitGap.reverse.availablePCores, 1) },
        { label: 'Usable memory', value: gib(fitGap.reverse.availableRamGiB) },
        { label: 'Usable storage', value: tib(fitGap.reverse.availableStorageTiB) },
        { label: 'Assessed workloads', value: number(fitGap.assessedVms) },
        { label: 'Fit decision', value: fitGap.fits === null ? 'Not assessed' : fitGap.fits ? 'Fits' : 'Does not fit' },
        { label: 'Same-spec nodes required', value: fitGap.requiredNodesAtSameSpec === null ? 'Not resolved' : number(fitGap.requiredNodesAtSameSpec) },
        { label: 'Additional nodes', value: fitGap.additionalNodes === null ? 'Cannot resolve with nodes alone' : number(fitGap.additionalNodes) },
      ],
      reasoning: engagementMode === 'management-only' ? [] : [
        {
          decision: fitGap.fits === null ? 'Do not assert workload fit' : fitGap.fits ? 'The included workloads fit the entered estate' : 'The included workloads do not fit the entered estate',
          basis: fitGap.fits === null ? 'Validation requirement' : 'Calculated',
          explanation: fitGap.fits === null
            ? 'A hardware envelope was entered, but there is not enough included workload evidence to make an inventory-specific fit decision.'
            : `The fit test compares workload demand with ${existingNodes} entered nodes after host reserves and failure capacity. The current deficits are ${number(fitGap.deficits.physicalCores, 1)} physical cores, ${number(fitGap.deficits.ramGiB, 1)} GiB memory, ${number(fitGap.deficits.s2dTiB, 1)} TiB S2D, and ${number(fitGap.deficits.sanTiB, 1)} TiB SAN.`,
          tradeoff: fitGap.additionalNodes === null
            ? 'A storage or hard platform constraint cannot be solved by adding identical nodes alone; revise that constraint directly.'
            : `At the entered node specification, the model requires ${fitGap.requiredNodesAtSameSpec ?? 'an unresolved number of'} total nodes, or ${fitGap.additionalNodes} additional nodes beyond the current estate.`,
        },
      ],
      bullets: engagementMode === 'management-only' ? [] : fitGap.recommendations,
      tables: engagementMode === 'management-only' ? [] : [{
        title: 'Current resource gaps',
        headers: ['Resource', 'Deficit', 'Unit'],
        rows: [
          ['CPU', number(fitGap.deficits.physicalCores, 1), 'physical cores'],
          ['Memory', number(fitGap.deficits.ramGiB, 1), 'GiB'],
          ['S2D', number(fitGap.deficits.s2dTiB, 1), 'usable TiB'],
          ['SAN', number(fitGap.deficits.sanTiB, 1), 'effective TiB'],
        ],
      }],
    },
    {
      id: 'deployment',
      title: 'Multi-cluster implementation plan',
      paragraphs: engagementMode === 'management-only'
        ? ['The management bill of materials is included below. Platform placement and cluster node counts require a new-platform or existing-hardware profile.']
        : [placementPlan.feasible
        ? `The selected placement policy distributes the estate across ${placementPlan.clusters.length} target cluster(s) using ${placementPlan.totalNodes} total nodes.`
        : 'The selected placement constraints cannot place the full estate. Revise the cluster ceiling, hardware density, or grouping rules before implementation.'],
      metrics: engagementMode === 'management-only' ? [
        { label: 'Platform placement', value: 'Not assessed' },
        { label: 'Management instances', value: managementDecision === 'design' ? number(managementPlan.totalInstances) : 'Not calculated' },
      ] : [
        { label: 'Target clusters', value: number(placementPlan.clusters.length) },
        { label: 'Total nodes', value: placementPlan.feasible ? number(placementPlan.totalNodes) : 'Review required' },
        { label: 'Workload-bearing nodes', value: placementPlan.feasible ? number(placementPlan.totalWorkloadNodes) : 'Review required' },
        { label: 'Placement status', value: placementPlan.feasible ? 'Feasible' : 'Needs revision' },
        { label: 'Embedded management VMs', value: number(placementPlan.clusters.reduce((sum, cluster) => sum + cluster.managementVmCount, 0)) },
        { label: 'Dedicated management nodes', value: dedicatedManagementSizing ? dedicatedManagementSizing.feasible ? number(dedicatedManagementSizing.nodes) : 'Review required' : 'Not selected' },
      ],
      reasoning: engagementMode === 'management-only' ? [
        {
          decision: 'Do not infer platform cluster placement',
          basis: 'Validation requirement',
          explanation: 'The engagement supplies a management topology but no workload-platform hardware profile, so Surveyor reports management component instances without inventing target cluster counts or host capacity.',
        },
      ] : [
        {
          decision: placementPlan.feasible
            ? `Distribute workloads across ${placementPlan.clusters.length} target cluster${placementPlan.clusters.length === 1 ? '' : 's'}`
            : 'Revise the multi-cluster placement policy',
          basis: 'Calculated',
          explanation: `The planner adds clusters until every cluster fits within ${placementInputs.maxNodesPerCluster} nodes and ${placementInputs.targetVmsPerCluster} VMs, up to ${placementInputs.maxClusters} clusters. Database-tier separation is ${placementInputs.separateDatabaseTier ? 'enabled' : 'disabled'} and source-cluster preservation is ${placementInputs.preserveSourceClusters ? 'enabled' : 'disabled'}.`,
          tradeoff: 'This is deterministic capacity placement, not application-affinity discovery. Validate application dependencies, maintenance domains, licensing, network locality, and operational ownership before assigning individual VMs.',
        },
        ...(managementDecision === 'design' ? [{
          decision: `Place management components on ${managementInputs.managementPlacement.replace(/-/g, ' ')}`,
          basis: 'User-selected' as const,
          explanation: managementInputs.managementPlacement === 'workload-cluster'
            ? 'Management VMs share the target workload platform and are added to its capacity calculation.'
            : managementInputs.managementPlacement === 'dedicated-management-cluster'
              ? 'Management VMs are isolated on a separately sized management cluster.'
              : 'Management VMs remain on an external virtualization fabric and are excluded from target-platform node sizing.',
          tradeoff: managementInputs.managementPlacement === 'workload-cluster'
            ? 'Shared placement is simpler but creates a bootstrap and failure-domain dependency that must be covered by recovery procedures.'
            : 'Separate placement improves isolation but requires independent capacity, lifecycle, backup, and recovery ownership.',
        }] : []),
      ],
      bullets: engagementMode === 'management-only' ? [] : [
        ...placementPlan.warnings,
        ...(managementDecision === 'design' && managementInputs.managementPlacement === 'external-fabric' ? ['Management VMs are placed on an external virtualization fabric and excluded from target-cluster capacity.'] : []),
      ],
      tables: engagementMode !== 'management-only' && placementPlan.clusters.length ? [{
        title: 'Target cluster plan',
        headers: ['Cluster', 'Purpose', 'Workload VMs', 'Management VMs', 'Nodes', 'Binding constraint', 'Source clusters', 'Data confidence'],
        rows: placementPlan.clusters.map((cluster) => [
          cluster.name,
          cluster.purpose,
          number(cluster.vms.length - cluster.managementVmCount),
          number(cluster.managementVmCount),
          cluster.result.feasible ? number(cluster.result.nodes) : 'Review',
          cluster.result.binding,
          cluster.sourceClusters.join(', ') || 'Mixed / not provided',
          `${cluster.result.performanceAssessment.confidence.replace('-', ' ')} (${cluster.result.performanceAssessment.score}/100)`,
        ]),
      }] : [],
    },
    {
      id: 'workloads',
      title: 'Workload summary',
      paragraphs: [engagementMode === 'management-only'
        ? 'Workload records remain in the project but are not used to size a platform in this management-only engagement.'
        : 'Only workloads marked Include are represented in demand and inventory totals.'],
      metrics: [
        { label: 'VMs', value: number(includedVms.length) },
        { label: 'Allocated vCPU', value: number(workloadTotals.vCpu) },
        { label: 'Allocated memory', value: gib(workloadTotals.ramGiB) },
        { label: 'Consumed storage', value: tib(workloadTotals.storageGiB / 1024) },
        { label: 'Provisioned storage', value: tib(workloadTotals.provisionedGiB / 1024) },
      ],
      reasoning: [{
        decision: `Size from ${includedVms.length.toLocaleString()} included workload records`,
        basis: 'Derived from inputs',
        explanation: 'Only VMs whose Include flag is enabled contribute to the demand totals, tier summary, placement plan, and detailed inventory. Excluded records remain in the project but do not consume calculated capacity.',
        tradeoff: 'The Include flag and tier classification are design inputs. Review excluded, auto-classified, template, placeholder, and powered-off records before approval.',
      }],
      bullets: [],
      tables: [{ title: 'Workloads by tier', headers: ['Tier', 'VMs', 'vCPU', 'Memory', 'Consumed storage'], rows: tierRows }],
    },
    {
      id: 'data-quality',
      title: 'Sizing evidence and confidence',
      paragraphs: engagementMode === 'management-only' ? [
        'Platform workload-sizing evidence was not assessed for this management-only engagement.',
      ] : [
        finalSizing.performanceAssessment.basis === 'measured-p95'
          ? `CPU and memory use per-VM P95 measurements where available, multiplied by a ${number(platformCfg.performanceComfortFactor ?? 1.25, 2)}x comfort factor. A ${number(platformCfg.cpuPerformanceFactor ?? 1, 2)}x target/source per-core benchmark factor is applied to CPU. Missing measurements fall back to the tier allocation policy; a measured resource does not also receive the tier right-sizing factor.`
          : 'CPU and memory are sized from allocation. Imported performance data is informational until measured P95 sizing is selected.',
      ],
      metrics: engagementMode === 'management-only' ? [
        { label: 'Platform sizing evidence', value: 'Not assessed' },
      ] : [
        { label: 'Sizing basis', value: finalSizing.performanceAssessment.basis === 'measured-p95' ? 'Measured P95 with fallback' : 'Allocation' },
        { label: 'Confidence', value: `${finalSizing.performanceAssessment.confidence.replace('-', ' ')} (${finalSizing.performanceAssessment.score}/100)` },
        { label: 'CPU P95 coverage', value: `${number(finalSizing.performanceAssessment.cpuCoveragePct, 1)}%` },
        { label: 'Memory P95 coverage', value: `${number(finalSizing.performanceAssessment.memoryCoveragePct, 1)}%` },
        { label: 'Storage performance coverage', value: `${number(finalSizing.performanceAssessment.storagePerformanceCoveragePct, 1)}%` },
        { label: '7+ day observation coverage', value: `${number(finalSizing.performanceAssessment.observationCoveragePct, 1)}%` },
      ],
      reasoning: engagementMode === 'management-only' ? [] : [{
        decision: finalSizing.performanceAssessment.basis === 'measured-p95' ? 'Use measured P95 sizing with allocation fallback' : 'Use allocation-based sizing',
        basis: 'User-selected',
        explanation: finalSizing.performanceAssessment.basis === 'measured-p95'
          ? `Measured CPU and memory values use the entered ${number(platformCfg.performanceComfortFactor ?? 1.25, 2)}x comfort factor. Missing measurements fall back to tier policy so a VM is never treated as zero demand.`
          : 'Allocated vCPU and memory are converted through the tier policies because no measured sizing mode was selected. This is intentionally conservative and can overstate demand.',
        tradeoff: `The calculated confidence is ${finalSizing.performanceAssessment.confidence.replace('-', ' ')} (${finalSizing.performanceAssessment.score}/100). Improve coverage and observation duration before using the result as a procurement ceiling.`,
      }],
      bullets: engagementMode === 'management-only' ? [] : finalSizing.performanceAssessment.notes,
      tables: input.dataSources?.length ? [{
        title: 'Imported data sources',
        headers: ['Type', 'File', 'Imported', 'Rows'],
        rows: input.dataSources.map((source) => [source.kind, source.fileName, source.importedAt ? new Date(source.importedAt).toLocaleString() : '', number(source.rows)]),
      }] : [],
    },
    {
      id: 'readiness',
      title: 'Migration readiness',
      paragraphs: [engagementMode === 'management-only' ? 'Workload migration readiness was not assessed.' : 'Readiness uses the source metadata available in the imported inventory. Application-owner validation, test migration, backup verification, and cluster validation remain required.'],
      metrics: engagementMode === 'management-only' ? [
        { label: 'Migration readiness', value: 'Not assessed' },
      ] : [
        { label: 'Ready', value: number(readiness.ready) },
        { label: 'Review', value: number(readiness.review) },
        { label: 'Blocked', value: number(readiness.blocked) },
        { label: 'Assessed', value: number(readiness.assessed) },
      ],
      reasoning: engagementMode === 'management-only' ? [] : [{
        decision: `${readiness.ready} ready, ${readiness.review} requiring review, and ${readiness.blocked} blocked`,
        basis: 'Derived from inputs',
        explanation: 'The readiness status is derived from the source metadata present for each included VM and the known target-platform checks. It is an exception screen, not proof that an application is migration-ready.',
        tradeoff: 'Application-owner approval, dependency discovery, backup verification, a representative migration pilot, and post-migration testing remain required regardless of the calculated status.',
      }],
      bullets: [],
      tables: engagementMode === 'management-only' ? [] : [{
        title: 'Readiness exceptions',
        headers: ['VM', 'Status', 'Category', 'Finding', 'Required action'],
        rows: readiness.findings.map((finding) => [finding.vmName, finding.status, finding.category, finding.finding, finding.action]),
      }],
    },
    {
      id: 'storage',
      title: 'Storage and CSV plan',
      paragraphs: engagementMode === 'management-only' ? [
        'Platform storage capacity, protection, performance, and CSV/LUN layout were not assessed.',
      ] : [
        'Capacity values use consumed workload storage after the selected immediate-headroom and growth strategy, followed by the configured resiliency or SAN efficiency assumptions.',
        `The storage-object plan is logical: a SAN row represents a 1:1 CSV/LUN, while an S2D row represents an S2D volume/CSV with no SAN LUN. SAN layout mode is ${platformCfg.sanCsvLayoutMode ?? 'balanced'}; Balanced and Custom treat editable tier recovery targets as an alternative, while Granular enforces them. S2D applies its recovery targets and the cluster-wide one-volume-per-node floor.`,
        finalSizing.storagePerformance.validated
          ? `Storage performance is validated against the entered sustainable IOPS and throughput capabilities with ${number(finalSizing.storagePerformance.measuredVmCoveragePct, 1)}% VM coverage.`
          : `Storage performance is not fully validated. Matched IOPS/throughput coverage is ${number(finalSizing.storagePerformance.measuredVmCoveragePct, 1)}%; enter sustainable capabilities for each active domain and validate peak concurrency before approval.`,
      ],
      metrics: engagementMode === 'management-only' ? [
        { label: 'Platform storage design', value: 'Not assessed' },
      ] : [
        { label: 'Required storage', value: tib(finalSizing.requiredStorageTiB) },
        { label: 'Required on S2D', value: tib(finalSizing.requiredS2dTiB) },
        { label: 'Required on SAN', value: tib(finalSizing.requiredSanTiB) },
        { label: 'S2D usable capacity', value: finalSizing.capacity ? tib(finalSizing.capacity.usableTiB) : 'Not applicable' },
        { label: 'SAN available capacity', value: tib(finalSizing.sanCapacityTiB) },
        { label: 'Planned logical storage objects', value: number(finalSizing.totalCsvs) },
        { label: 'Performance validation', value: finalSizing.storagePerformance.validated ? 'Validated' : 'Incomplete' },
      ],
      reasoning: engagementMode === 'management-only' ? [] : [
        {
          decision: `Provide ${tib(finalSizing.requiredStorageTiB)} of modeled workload storage`,
          basis: 'Calculated',
          explanation: `Surveyor starts with consumed storage for included workloads, applies the selected immediate headroom and growth strategy, then applies the protection or SAN-efficiency inputs for the active storage domain. The result is ${tib(finalSizing.requiredS2dTiB)} on S2D and ${tib(finalSizing.requiredSanTiB)} on SAN.`,
          tradeoff: 'Snapshot reserve, backup repositories, replica history, array metadata, and vendor-specific free-space requirements must be confirmed separately unless explicitly represented in the entered usable capacity.',
        },
        {
          decision: `Create ${finalSizing.totalCsvs} logical storage object${finalSizing.totalCsvs === 1 ? '' : 's'}`,
          basis: 'Calculated',
          explanation: `Each tier is evaluated against capacity per object, VM recovery grouping, the selected SAN layout mode, and the S2D one-volume-per-node floor where applicable. The table identifies the controlling rule for every tier instead of assigning one CSV per VM or per arbitrary workload group.`,
          tradeoff: 'This is a starting layout. Override it when backup concurrency, restore blast radius, array limits, application isolation, ownership, or operational standards require a different grouping.',
        },
        {
          decision: finalSizing.storagePerformance.validated ? 'Accept the entered storage performance envelope' : 'Treat storage performance as unvalidated',
          basis: finalSizing.storagePerformance.validated ? 'Calculated' : 'Validation requirement',
          explanation: finalSizing.storagePerformance.validated
            ? 'Measured workload coverage meets the tool threshold and sustainable IOPS and throughput were entered for every active storage domain.'
            : `Matched workload coverage is ${number(finalSizing.storagePerformance.measuredVmCoveragePct, 1)}%, or one or more active storage domains lacks an entered sustainable IOPS/throughput capability. Capacity feasibility alone therefore does not prove performance feasibility.`,
          tradeoff: 'Validate peak concurrency, latency, cache behavior, rebuild or resync load, and the exact target configuration with vendor tooling or a proof of concept.',
        },
      ],
      bullets: [],
      tables: engagementMode === 'management-only' ? [] : [
        {
          title: 'Storage performance',
          headers: ['Domain', 'Required IOPS', 'Available IOPS', 'Required MB/s', 'Available MB/s'],
          rows: [
            ...(platformCfg.architecture === 's2d' || platformCfg.architecture === 'hybrid' ? [[
              'S2D', number(finalSizing.storagePerformance.requiredS2dIops), finalSizing.storagePerformance.availableS2dIops === null ? 'Not entered' : number(finalSizing.storagePerformance.availableS2dIops), number(finalSizing.storagePerformance.requiredS2dThroughputMBps), finalSizing.storagePerformance.availableS2dThroughputMBps === null ? 'Not entered' : number(finalSizing.storagePerformance.availableS2dThroughputMBps),
            ]] : []),
            ...(platformCfg.architecture === 'san' || platformCfg.architecture === 'hybrid' ? [[
              'SAN', number(finalSizing.storagePerformance.requiredSanIops), finalSizing.storagePerformance.availableSanIops === null ? 'Not entered' : number(finalSizing.storagePerformance.availableSanIops), number(finalSizing.storagePerformance.requiredSanThroughputMBps), finalSizing.storagePerformance.availableSanThroughputMBps === null ? 'Not entered' : number(finalSizing.storagePerformance.availableSanThroughputMBps),
            ]] : []),
          ],
        },
        {
          title: platformCfg.architecture === 'san'
            ? 'SAN CSV / LUN plan'
            : platformCfg.architecture === 's2d' ? 'S2D volume / CSV plan' : 'Hybrid storage volume plan',
          headers: ['Tier', 'Storage object', 'Planned demand', 'Count by size', 'VM grouping', 'Granular alternative', 'Recommended layout', 'Controlling rule'],
          rows: finalSizing.csvPlans.map((plan) => [
            platformTiers[plan.tier].label,
            `${plan.domain === 'san' ? 'SAN CSV / LUN' : 'S2D volume / CSV'} (${plan.filesystem})`,
            `${tib(plan.totalTiB)} / ${number(plan.plannedVms)} planned VMs`,
            `ceil(${number(plan.totalTiB, 1)} / ${number(plan.maxSizeTiB, 1)}) = ${number(plan.countByCapacity)}`,
            `ceil(${number(plan.plannedVms)} / ${number(plan.maxVmsPerCsv)}) = ${number(plan.countByVmLimit)}${plan.recoveryGroupingApplied ? '' : ' (advisory)'}`,
            number(plan.granularAdvisoryCount),
            `${number(plan.count)} × ${tib(plan.sizeTiB)}; up to ${number(plan.vmsPerCsv)} VMs each`,
            plan.driver === 'node-count' ? 'S2D node ownership' : plan.driver === 'operational-balance' ? 'Operational balance' : plan.driver === 'custom-target' ? 'Custom target' : plan.driver === 'vm-count' ? 'VM recovery grouping' : plan.driver === 'both' ? 'Both requirements' : 'Volume-size requirement',
          ]),
        },
      ],
    },
    {
      id: 'network',
      title: 'Network design',
      paragraphs: [engagementMode === 'management-only' ? 'Host networking was not assessed because no platform hardware profile was supplied.' : 'The host-network design separates management, compute, live migration, and storage intent while identifying switch and RDMA dependencies that must be validated against the physical fabric.'],
      metrics: engagementMode === 'management-only' ? [
        { label: 'Host network design', value: 'Not assessed' },
      ] : [
        { label: 'Adapters / node', value: number((input.networkDesignInputs ?? DEFAULT_NETWORK_INPUTS).adaptersPerNode) },
        { label: 'Adapter speed', value: `${number((input.networkDesignInputs ?? DEFAULT_NETWORK_INPUTS).adapterSpeedGbps)} Gbps` },
        { label: 'Aggregate / node', value: `${number(network.aggregateGbpsPerNode)} Gbps` },
        { label: 'Host switch ports', value: number(network.totalHostPorts) },
        { label: 'RDMA', value: (input.networkDesignInputs ?? DEFAULT_NETWORK_INPUTS).rdmaProtocol.toUpperCase() },
      ],
      reasoning: engagementMode === 'management-only' ? [] : [{
        decision: `Use ${networkInputs.adaptersPerNode} × ${networkInputs.adapterSpeedGbps} Gbps host adapters with ${networkInputs.rdmaProtocol.toUpperCase()}`,
        basis: 'User-selected',
        explanation: `The entered host profile provides ${number(network.aggregateGbpsPerNode)} Gbps aggregate link rate per node and ${number(network.totalHostPorts)} host-facing switch ports across the design. Management, compute, live migration, and storage intents are separated in the generated plan.`,
        tradeoff: 'Aggregate link rate is not guaranteed usable throughput. Validate switch redundancy, oversubscription, QoS, VLANs, RDMA configuration, SAN paths, cabling, and failure behavior against the final physical topology.',
      }],
      bullets: engagementMode === 'management-only' ? [] : network.findings.map((finding) => `${finding.severity.toUpperCase()}: ${finding.message}`),
      tables: engagementMode === 'management-only' ? [] : [{ title: 'Network intents', headers: ['Intent'], rows: network.intentSummary.map((intent) => [intent]) }],
    },
    {
      id: 'recovery',
      title: 'Backup and disaster recovery',
      paragraphs: [engagementMode === 'management-only' ? 'Workload backup and disaster recovery were not assessed.' : 'Cluster high availability protects against selected local failures; the recovery design separately addresses site loss, corruption, and restoration objectives. Replication bandwidth remains an estimate until measured changed-block data is available.'],
      metrics: engagementMode === 'management-only' ? [
        { label: 'Workload recovery design', value: 'Not assessed' },
      ] : [
        { label: 'Strategy', value: (input.drDesignInputs ?? DEFAULT_DR_INPUTS).strategy },
        { label: 'Protected VMs', value: number(recovery.protectedVms) },
        { label: 'Protected storage', value: tib(recovery.protectedStorageTiB) },
        { label: 'Secondary storage', value: tib(recovery.secondaryStorageTiB) },
        { label: 'Estimated burst WAN', value: `${number(recovery.estimatedBurstMbps, 1)} Mbps`, detail: recovery.bandwidthPasses ? 'Within entered WAN capacity' : 'Above entered WAN capacity' },
        { label: 'RPO / RTO', value: `${number((input.drDesignInputs ?? DEFAULT_DR_INPUTS).rpoMinutes, 1)} min / ${number((input.drDesignInputs ?? DEFAULT_DR_INPUTS).rtoHours, 1)} hr` },
      ],
      reasoning: engagementMode === 'management-only' ? [] : [
        {
          decision: `Use ${recoveryInputs.strategy} for ${number(recoveryInputs.protectedWorkloadPct, 1)}% of workloads`,
          basis: 'User-selected',
          explanation: `The selected protection scope covers ${recovery.protectedVms} VMs and ${tib(recovery.protectedStorageTiB)} of modeled storage with a target RPO/RTO of ${number(recoveryInputs.rpoMinutes, 1)} minutes / ${number(recoveryInputs.rtoHours, 1)} hours.`,
          tradeoff: 'Cluster HA handles local component failures; it does not replace backup, immutable recovery, application consistency, or site-loss protection.',
        },
        {
          decision: recovery.bandwidthPasses ? 'The entered WAN passes the planning estimate' : 'The entered WAN does not pass the planning estimate',
          basis: 'Calculated',
          explanation: `The bandwidth estimate applies a ${number(recoveryInputs.dailyChangeRatePct, 1)}% daily change rate and ${number(recoveryInputs.burstFactor, 1)}x burst factor to protected consumed storage, producing ${number(recovery.estimatedBurstMbps, 1)} Mbps against ${number(recoveryInputs.availableWanMbps, 1)} Mbps entered capacity.`,
          tradeoff: 'This estimate is not measured changed-block telemetry. Measure real write-change patterns and test failover and failback before committing bandwidth or RPO claims.',
        },
      ],
      bullets: engagementMode === 'management-only' ? [] : recovery.findings.map((finding) => `${finding.severity.toUpperCase()}: ${finding.message}`),
      tables: [],
    },
    {
      id: 'management',
      title: 'Management plane',
      paragraphs: managementDecision === 'design' ? [
        managementLabel(managementInputs),
        `The management design is sized for ${managementInputs.managedHosts.toLocaleString()} hosts, ${managementInputs.managedVms.toLocaleString()} workload VMs, and ${managementInputs.managedClusters.toLocaleString()} clusters.`,
        `Management components are placed on ${managementInputs.managementPlacement.replace(/-/g, ' ')}.`,
      ] : [managementDecision === 'existing'
        ? 'An existing management solution was recorded for this engagement. Its topology, capacity, lifecycle, and licensing were not reassessed by Surveyor.'
        : managementDecision === 'deferred'
          ? 'The management-plane decision is intentionally deferred and remains an open design item.'
          : 'The management plane was not assessed. This must not be interpreted as a decision that no management solution is required.'],
      metrics: managementDecision === 'design' ? [
        { label: 'Management instances', value: number(managementPlan.totalInstances) },
        { label: 'Management vCPU', value: number(managementPlan.totalVCpu) },
        { label: 'Management memory', value: gib(managementPlan.totalRamGiB) },
        { label: 'Management disk', value: gib(managementPlan.totalDiskGiB) },
        { label: 'Workload-cluster impact', value: managementInputs.managementPlacement !== 'workload-cluster' ? 'Separate capacity domain' : engagementMode === 'management-only' ? 'Platform not supplied' : managementHostDelta === null ? 'Could not compare' : managementHostDelta > 0 ? `+${managementHostDelta} nodes` : 'No additional nodes' },
        { label: 'Azure Arc services', value: managementInputs.includeArc ? `Core + ${managementInputs.arcServices.length} add-on${managementInputs.arcServices.length === 1 ? '' : 's'}` : 'Not selected' },
        { label: 'Arc connectivity', value: managementInputs.includeArc ? `${managementInputs.arcConnectivity} · ${managementInputs.arcRegion}` : 'Not applicable' },
        { label: 'Arc guest scope', value: managementInputs.includeArc ? `${number(managementInputs.arcGuestScopePct, 1)}% of managed VMs` : 'Not applicable' },
        { label: 'SCOM collection', value: managementInputs.monitoring === 'scom' ? `${number(managementInputs.scomDailyDataGiB, 1)} GiB/day · ${managementInputs.scomWarehouseRetentionDays} warehouse days` : 'Not selected' },
      ] : [{ label: 'Management decision', value: managementDecisionLabel }],
      reasoning: managementDecision === 'design' ? [
        {
          decision: managementInputs.foundation === 'scvmm' ? 'Use SCVMM 2025 as the fabric foundation' : 'Use Classic Hyper-V tools as the fabric foundation',
          basis: 'User-selected',
          explanation: managementInputs.foundation === 'scvmm'
            ? 'The saved deployment design selects a centralized VMM fabric and therefore includes VMM management, SQL, library, and supporting components according to the selected availability model.'
            : 'The saved deployment design uses Hyper-V Manager, Failover Cluster Manager, PowerShell, and RSAT without adding a central VMM fabric service.',
          tradeoff: managementInputs.foundation === 'scvmm'
            ? 'SCVMM adds centralized fabric capabilities but also adds licensing, SQL, library, certificate, backup, patching, and upgrade responsibilities.'
            : 'Classic tools reduce platform overhead but do not supply VMM private clouds, tenant quotas, central templates, array-aware fabric orchestration, or Dynamic Optimization.',
        },
        ...(managementInputs.wac !== 'none' ? [{
          decision: `Add ${managementInputs.wac === 'wac-virtual' ? 'WAC Virtualization Mode' : 'WAC Administration Mode'}`,
          basis: 'User-selected' as const,
          explanation: managementInputs.wac === 'wac-virtual'
            ? 'The selected WAC experience is the stateful, virtualization-focused mode intended for larger fabric operations.'
            : 'The selected WAC experience provides browser-based day-two administration for individual servers and clusters and complements the fabric foundation.',
          tradeoff: managementInputs.wac === 'wac-virtual'
            ? 'vMode is currently Preview and must be revalidated for GA status, HA, certificates, software-defined fabric coverage, and partner integrations before production approval.'
            : 'aMode is connection-oriented rather than a tenant fabric manager and is typically positioned for smaller-scale direct administration.',
        }] : []),
        ...(managementInputs.includeArc ? [{
          decision: 'Add Azure Arc-enabled SCVMM',
          basis: 'User-selected' as const,
          explanation: `Arc projects the SCVMM-managed fabric into Azure and adds the resource bridge plus the selected guest-service scope. The selected connection method is ${managementInputs.arcConnectivity} in ${managementInputs.arcRegion}.`,
          tradeoff: 'Arc does not replace SCVMM. It requires the underlying VMM fabric, an on-premises resource bridge appliance, Azure identity and subscription ownership, DNS, and ongoing outbound connectivity.',
        }] : []),
        ...(managementInputs.monitoring === 'scom' ? [{
          decision: `Add SCOM 2025 with ${managementInputs.scomHighAvailability ? 'high availability' : 'a standalone management server'}`,
          basis: 'User-selected' as const,
          explanation: managementInputs.scomHighAvailability
            ? `The design adds redundant SCOM management capacity and places its databases ${managementInputs.scomSqlPlacement === 'shared-vmm' && managementInputs.foundation === 'scvmm' ? 'on the shared VMM SQL availability infrastructure' : 'on dedicated SQL infrastructure'}.`
            : 'The design consolidates SCOM roles for a smaller footprint and relies on documented recovery rather than redundant management servers.',
          tradeoff: managementInputs.scomSqlPlacement === 'shared-vmm' && managementInputs.foundation === 'scvmm'
            ? 'Sharing SQL infrastructure reduces VM count but couples VMM and SCOM database maintenance, performance, and failure domains; validate instance isolation, capacity, backup, and supportability.'
            : 'Dedicated SQL improves isolation but adds VM, licensing, patching, backup, and HA overhead.',
        }] : []),
        {
          decision: `Place management VMs on ${managementInputs.managementPlacement.replace(/-/g, ' ')}`,
          basis: 'User-selected',
          explanation: managementInputs.managementPlacement === 'workload-cluster'
            ? 'The management stack runs with the workloads and is included in workload-platform sizing when that option is enabled.'
            : managementInputs.managementPlacement === 'dedicated-management-cluster'
              ? 'The management stack is isolated on its own cluster and sized as a separate capacity domain.'
              : 'The management stack remains on another virtualization platform and does not consume the proposed workload-cluster capacity.',
          tradeoff: managementInputs.managementPlacement === 'workload-cluster'
            ? 'Document cold-start order and recovery access so a workload-cluster outage does not prevent operators from restoring its management services.'
            : 'Separate placement must have its own availability, capacity, backup, monitoring, and recovery design.',
        },
      ] : [{
        decision: managementDecisionLabel,
        basis: managementDecision === 'unassessed' ? 'Validation requirement' : 'User-selected',
        explanation: managementDecision === 'existing'
          ? 'An existing management solution was recorded, but its topology and fitness were not assessed by this report.'
          : managementDecision === 'deferred'
            ? 'The management decision was explicitly deferred and remains an implementation dependency.'
            : 'No management-plane assessment was completed, so the report cannot explain or size a management topology.',
      }],
      bullets: managementDecision === 'design' ? [...managementPlan.dependencies.map((item) => `Dependency: ${item}`), ...managementPlan.cautions.map((item) => `Caution: ${item}`)] : [],
      tables: managementDecision === 'design' ? [
        {
          title: 'Management-plane bill of materials',
          headers: ['Component', 'Qty', 'Availability', 'vCPU each', 'RAM each', 'Disk each', 'Basis'],
          rows: managementPlan.components.map((component) => [
            component.name,
            number(component.count),
            component.availability,
            component.resourceType === 'vm' ? number(component.vCpu) : 'N/A',
            component.resourceType === 'vm' ? gib(component.ramGiB) : 'N/A',
            gib(component.diskGiB),
            component.basis,
          ]),
        },
        ...(managementPlan.arcServices.length ? [{
          title: 'Selected Azure Arc services',
          headers: ['Service', 'Type', 'Billing basis', 'Deployment requirement'],
          rows: managementPlan.arcServices.map((service) => [service.name, service.category, service.billing, service.requirement]),
        }] : []),
      ] : [],
    },
    {
      id: 'assumptions',
      title: 'Assumptions and policies',
      paragraphs: [engagementMode === 'management-only' ? 'Platform sizing assumptions were not applied. Management component sizing bases are listed with the management bill of materials.' : 'Values marked as planning assumptions should be validated against measured workload behavior and the final hardware bill of materials.'],
      metrics: engagementMode === 'management-only' ? [
        { label: 'Platform assumptions', value: 'Not applied' },
      ] : [
        { label: 'Immediate headroom', value: `${number(growthForecast.plan.immediateHeadroomPct, 1)}%` },
        { label: 'Annual workload growth', value: `${number(growthForecast.plan.annualGrowthPct * 100, 1)}% compounded` },
        { label: 'Growth horizon', value: `${growthForecast.plan.horizonYears} years` },
        { label: 'Growth deployment', value: growthForecast.plan.strategy === 'build-now' ? 'Build terminal forecast now' : 'Add nodes as thresholds are crossed' },
        { label: 'SMT factor', value: number(platformCfg.smtFactor, 2) },
        { label: 'Host core reserve', value: `${number(platformCfg.hostCoreReservePct * 100, 1)}%` },
        {
          label: 'Host RAM reserve',
          value: `Greater of ${gib(platformCfg.hostRamReserveGiB)} or ${number(platformCfg.hostRamReservePct * 100, 1)}%`,
          detail: 'The larger value is reserved per host; the two values are not added together.',
        },
        { label: 'Backup method', value: platformCfg.backupMethod },
        { label: 'Quorum witness', value: platformCfg.witnessType ?? 'Not selected' },
        { label: 'Sizing evidence', value: finalSizing.performanceAssessment.basis === 'measured-p95' ? `Measured P95 × ${number(platformCfg.performanceComfortFactor ?? 1.25, 2)}` : 'Allocation' },
        { label: 'CPU benchmark factor', value: finalSizing.performanceAssessment.basis === 'measured-p95' ? `${number(platformCfg.cpuPerformanceFactor ?? 1, 2)}x target/source per core` : 'Not applied' },
      ],
      reasoning: engagementMode === 'management-only' ? [{
        decision: 'Apply management-component sizing bases only',
        basis: 'Derived from inputs',
        explanation: 'No workload-platform design was requested. Each management component therefore carries its own Microsoft requirement, Microsoft recommendation, or visible Surveyor planning basis in the management bill of materials.',
      }] : [
        {
          decision: `Reserve ${number(platformCfg.hostCoreReservePct * 100, 1)}% host CPU and the greater of ${gib(platformCfg.hostRamReserveGiB)} or ${number(platformCfg.hostRamReservePct * 100, 1)}% host memory`,
          basis: 'User-selected',
          explanation: 'Host reserves remove capacity before workload demand is placed. For memory, Surveyor uses the larger fixed or percentage value; it does not add them together.',
          tradeoff: 'These are transparent planning policies rather than universal Microsoft mandates. Validate them against host services, security tooling, backup activity, driver overhead, and operational standards.',
        },
        {
          decision: 'Apply per-tier right-sizing and vCPU:pCore policies',
          basis: 'User-selected',
          explanation: 'Each included VM inherits the policy of its assigned workload tier. Those policies translate allocated or fallback demand into required physical CPU, memory behavior, storage placement, and recovery grouping.',
          tradeoff: 'Auto-classification is only a starting point. Incorrect tier assignment or aggressive right-sizing changes the node result, so application-owner review and measured evidence should override defaults.',
        },
      ],
      bullets: [],
      tables: engagementMode === 'management-only' ? [] : [{
        title: 'Tier policies',
        headers: ['Tier', 'vCPU:pCore', 'Right-size factor', 'Dynamic memory policy', 'Storage tier', 'Hybrid placement', 'Target VMs / recovery unit', 'Max recovery-unit size'],
        rows: (Object.keys(platformTiers) as TierId[]).map((tierId) => {
          const tier = platformTiers[tierId]
          return [tier.label, `${tier.oversubscription}:1`, number(tier.rightSizingFactor, 2), yesNo(tier.allowDynamicMemory), tier.storageTier, tier.hybridPlacement ?? (tier.storageTier === 'performance' ? 's2d' : 'san'), number(tier.maxVmsPerCsv), `${tier.blastRadiusTiB} TiB`]
        }),
      }],
    },
    {
      id: 'findings',
      title: 'Findings and cautions',
      paragraphs: [],
      metrics: engagementMode === 'management-only' ? [
        { label: 'Platform findings', value: 'Not assessed' },
      ] : [
        { label: 'Errors', value: number(finalSizing.findings.filter((item) => item.severity === 'error').length) },
        { label: 'Warnings', value: number(finalSizing.findings.filter((item) => item.severity === 'warning').length) },
        { label: 'Information', value: number(finalSizing.findings.filter((item) => item.severity === 'info').length) },
      ],
      reasoning: engagementMode === 'management-only' ? [] : [{
        decision: finalSizing.findings.some((item) => item.severity === 'error') ? 'Do not approve the design until errors are resolved' : 'No hard validation error blocks the calculated result',
        basis: 'Validation requirement',
        explanation: 'Errors represent hard conflicts with the entered configuration or platform rules. Warnings identify risk or missing evidence, while informational findings document guidance and follow-up items.',
        tradeoff: 'A feasible calculation is not the same as an implementation-ready design. Owners must disposition material warnings and retain evidence for any accepted exception.',
      }],
      bullets: [],
      tables: engagementMode === 'management-only' ? [] : [{
        headers: ['Severity', 'Basis', 'Finding'],
        rows: finalSizing.findings.map((finding) => [finding.severity.toUpperCase(), finding.basis, finding.message]),
      }],
    },
    {
      id: 'inventory',
      title: 'VM inventory',
      paragraphs: [`${includedVms.length.toLocaleString()} included workload records. The detailed inventory is intentionally placed near the end of the report, immediately before sources and methodology.`],
      metrics: [],
      reasoning: [],
      bullets: [],
      tables: [{
        headers: ['VM', 'Tier', 'vCPU', 'Memory', 'Consumed', 'Provisioned', 'CPU P95', 'Memory P95', 'Source cluster', 'Power state', 'Guest OS'],
        rows: includedVms.map((vm) => [
          vm.name,
          platformTiers[vm.tier].label,
          number(vm.vCpu),
          gib(vm.ramGiB),
          gib(vm.storageGiB),
          gib(vm.provisionedGiB),
          vm.performance?.cpuP95Pct === undefined ? '' : `${number(vm.performance.cpuP95Pct, 1)}%`,
          vm.performance?.memoryP95Pct === undefined ? '' : `${number(vm.performance.memoryP95Pct, 1)}%`,
          vm.sourceCluster ?? '',
          vm.powerState,
          vm.guestOs ?? '',
        ]),
      }],
    },
    {
      id: 'sources',
      title: 'Sources and methodology',
      paragraphs: [
        engagementMode === 'management-only'
          ? 'Hyper-V Surveyor builds the management bill of materials from the selected VMM, WAC, SCOM, SQL, Azure Arc, availability, scale, and placement inputs. It does not infer a workload-platform design without hardware evidence.'
          : 'Hyper-V Surveyor computes workload demand from included VMs, applies visible tier and host-reserve assumptions, evaluates CPU, memory, and storage independently, and selects the first node count satisfying all constraints.',
        `Microsoft hard limits and recommendations are identified separately from Surveyor planning profiles. This report was produced by calculation engine ${ENGINE_VERSION}. Commercial terms and product support statements should be reverified before quotation or implementation.`,
      ],
      metrics: [],
      reasoning: [],
      bullets: [],
      tables: [
        ...(input.dataSources?.length ? [{ title: 'Project data sources', headers: ['Type', 'File', 'Imported', 'Rows'], rows: input.dataSources.map((source) => [source.kind, source.fileName, source.importedAt ? new Date(source.importedAt).toLocaleString() : '', number(source.rows)]) }] : []),
        { title: 'Technical references', headers: ['Used for', 'Source'], rows: [...sourceMap.entries()].map(([source, description]) => [description, source]) },
      ],
    },
  ]

  return {
    schemaVersion: 3,
    title: `${input.customerName || 'Hyper-V'} solution report`,
    customerName: input.customerName || 'Untitled design',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    selectedArchitecture: selectedPlatformLabel,
    metadata,
    sections,
  }
}

export function selectedReportSections(
  report: SolutionReport,
  selection: ReportSelection,
  options: ReportOutputOptions = DEFAULT_REPORT_OUTPUT_OPTIONS,
) {
  return report.sections
    .filter((section) => selection[section.id])
    .map((section) => options.includeDecisionReasoning ? section : { ...section, reasoning: [] })
}

export function managementPlaneName(id: PlaneId) {
  return MANAGEMENT_PLANES.find((plane) => plane.id === id)?.name ?? id
}
