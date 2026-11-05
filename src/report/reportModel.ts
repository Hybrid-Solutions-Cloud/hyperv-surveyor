import { DECISION_QUESTIONS, MANAGEMENT_PLANES, type AdvisorAnswers, type PlaneId } from '../data/managementPlane'
import { excludedWorkloadCounts, OUTLIER_CHOICE_LABELS } from '../engine/dataQuality'
import { advisorMatchSentence } from '../engine/managementAdvisor'
import {
  normalizeManagementDeploymentInputs,
  type ManagementDeploymentInputs,
} from '../engine/managementDeployment'
import { solveForward } from '../engine/solve'
import { resolvePlatformDesign, singleClusterNodesLabel } from '../engine/platformDesign'
import { resolveGrowthPlan } from '../engine/growth'
import type { ImportSummary } from '../io/rvtools'
import { RESILIENCY } from '../engine/rules'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'
import { DEFAULT_PLACEMENT_INPUTS, type PlacementInputs } from '../engine/deploymentPlanning'
import { assessStorageDecision, STORAGE_DECISION_QUESTIONS, STORAGE_FAMILY_LABELS, type StorageDecisionAnswers } from '../engine/storageDecision'
import { assessMigrationReadiness } from '../engine/readiness'
import { DEFAULT_NETWORK_INPUTS, designNetwork, type NetworkDesignInputs } from '../engine/networkDesign'
import { DEFAULT_DR_INPUTS, designDisasterRecovery, type DrDesignInputs } from '../engine/drDesign'
import { DEFAULT_REPORT_METADATA, ENGINE_VERSION, type ProjectDataSource, type ReportMetadata } from '../state/project'
import { fitGapAdditionalLabel, fitGapRequiredLabel } from '../engine/fitGap'
import { DEFAULT_CONFIG, defaultTiers } from '../state/defaults'
import { ENGAGEMENT_LABELS, type EngagementMode, type ManagementDecision } from '../state/journey'

export const REPORT_SECTION_DEFINITIONS = [
  { id: 'executive', label: 'Executive summary' },
  { id: 'architecture', label: 'Solution architecture' },
  { id: 'bill-of-materials', label: 'What to buy' },
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
  /** Management Plane Advisor answers, recorded in the report with the recommended stack. */
  managementAdvisorAnswers?: AdvisorAnswers
  generatedAt?: string
  placementInputs?: PlacementInputs
  storageDecisionAnswers?: StorageDecisionAnswers
  networkDesignInputs?: NetworkDesignInputs
  drDesignInputs?: DrDesignInputs
  reportMetadata?: ReportMetadata
  dataSources?: ProjectDataSource[]
  existingCapacityCfg?: ClusterConfig
  existingCapacityTiers?: Record<TierId, TierPolicy>
  existingCapacityNodes?: number
  /** The last inventory import, for excluded-record counts and import warnings. */
  lastImport?: ImportSummary | null
}

export function defaultReportSelection(engagementMode?: EngagementMode | null): ReportSelection {
  const selection = Object.fromEntries(REPORT_SECTION_DEFINITIONS.map(({ id }) => [id, true])) as ReportSelection
  if (engagementMode === 'new-platform') selection.existing = false
  if (engagementMode === 'existing-capacity' || engagementMode === 'fit-gap') selection['bill-of-materials'] = false
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
  const monitoring = inputs.monitoring === 'scom-features' && inputs.foundation !== 'scvmm'
    ? 'SCOM for features only not planned, because it needs SCVMM'
    : inputs.monitoring !== 'none'
    ? inputs.monitoring === 'scom-features'
      ? `SCOM 2025 for reporting and forecasting only${resolved.scomHighAvailability ? ' (HA)' : ' (single server)'}`
      : resolved.scomHighAvailability
      ? `SCOM 2025 HA${resolved.scomSqlPlacement === 'shared-vmm' && inputs.foundation === 'scvmm' ? ' on shared VMM SQL infrastructure' : ''}`
      : 'SCOM 2025 single-server management group'
    : 'Existing / no monitoring platform'
  const arc = inputs.includeArc
    ? `; Azure Arc-enabled servers${resolved.arcServices.length ? ` + ${resolved.arcServices.length} add-on${resolved.arcServices.length === 1 ? '' : 's'}` : ' only'}`
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

/** Excluded workload records by reason. One function, shared with the Data check page. */
export { excludedWorkloadCounts }

export function buildSolutionReport(input: SolutionReportInputs): SolutionReport {
  const includedVms = input.vms.filter((vm) => vm.include)
  const engagementMode = input.engagementMode ?? 'new-platform'
  const placementInputs = input.placementInputs ?? DEFAULT_PLACEMENT_INPUTS
  // One design for every surface: the report reads the same resolved platform as the pages.
  const design = resolvePlatformDesign({
    engagementMode,
    cfg: input.cfg,
    tiers: input.tiers,
    vms: input.vms,
    chosenKey: input.chosenKey,
    existingCapacityCfg: input.existingCapacityCfg ?? structuredClone(DEFAULT_CONFIG),
    existingCapacityTiers: input.existingCapacityTiers ?? defaultTiers(),
    existingCapacityNodes: input.existingCapacityNodes ?? 8,
    placementInputs,
    managementDecision: input.managementDecision,
    managementDeploymentInputs: input.managementDeploymentInputs,
    includeManagementInSizing: input.includeManagementInSizing,
    managementAdvisorAnswers: input.managementAdvisorAnswers,
  })
  const managementOnly = design.path === 'management-only'
  const usesExistingHardware = design.path === 'existing'
  const isNewPlatform = design.path === 'new-platform'
  const options = design.options
  const chosenKey = design.chosen?.key ?? input.chosenKey
  const chosenLabel = design.chosen?.label ?? design.platformLabel
  // The selected design is always reported, because the rest of the report describes it.
  const architectureKeys = input.reportMetadata?.architectureKeys
  const reportedOptions = options.filter((option) => !architectureKeys || option.key === chosenKey || architectureKeys.includes(option.key))
  const managementDecision = design.management.decision
  const platformVms = managementOnly ? [] : input.vms
  const platformCfg = design.cfg
  const platformTiers = design.tiers
  const existingNodes = usesExistingHardware ? design.totalNodes ?? 0 : 0
  const selectedPlatformLabel = design.platformLabel
  const managementInputs = design.management.inputs
  const managementPlan = design.management.plan
  const managementConsumesPlatform = design.management.counted
  const advisor = design.management.advisor
  const advisorSentence = advisorMatchSentence(design.management.source, advisor)
  const advisorAnswerRows = DECISION_QUESTIONS
    .filter((question) => advisor.answers[question.id] !== undefined)
    .map((question) => [question.question, advisor.answers[question.id] ? 'Yes' : 'No'])
  const stackSourceLabel = design.management.source === 'saved'
    ? 'Chosen on the Deployment design tab'
    : design.management.source === 'advisor'
      ? 'Follows the advisor recommendation'
      : 'Starting point, not a recommendation'
  // Management-only has no platform; an empty sizing keeps the shared wording code simple.
  const finalSizing = design.sizing ?? solveForward(platformCfg, [], platformTiers)
  const growth = design.growth
  const growthPlan = growth?.plan ?? resolveGrowthPlan(platformCfg)
  const storage = design.storage
  const fitGap = design.fitGap
  const designFails = design.feasible === false
  const split = design.status === 'split'
  const readiness = assessMigrationReadiness(platformVms, platformCfg)
  const networkInputs = input.networkDesignInputs ?? DEFAULT_NETWORK_INPUTS
  const network = design.network.nodes === null ? null : designNetwork(platformCfg, design.network.nodes, networkInputs)
  const metadata = { ...DEFAULT_REPORT_METADATA, ...input.reportMetadata }
  const recoveryInputs = input.drDesignInputs ?? DEFAULT_DR_INPUTS
  const recovery = designDisasterRecovery(platformVms, finalSizing, recoveryInputs)
  const storageGuide = assessStorageDecision(input.storageDecisionAnswers ?? {}, options)
  const binding = usesExistingHardware && fitGap ? fitGap.reverse.binding : finalSizing.binding
  const findingsList = design.findings
  const errorCount = findingsList.filter((item) => item.severity === 'error').length + (design.status === 'split-failed' ? 1 : 0)
  const usesSan = platformCfg.architecture === 'san' || platformCfg.architecture === 'hybrid'

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
  const excluded = excludedWorkloadCounts(input.vms, input.lastImport)
  const excludedRows = [
    ['Powered off or suspended', number(excluded.poweredOff), 'In the inventory, excluded by default. Tick Include to size them.'],
    ['No vCPU or memory value', number(excluded.zeroSpec), 'Cannot be sized until corrected.'],
    ['Storage outlier excluded by your choice', number(excluded.storageOutlier), 'Chosen on the Data check page.'],
    ['Excluded by hand', number(excluded.other), 'Include turned off in the inventory.'],
    ...(input.lastImport ? [
      ['Templates (not imported)', number(excluded.templates), 'Skipped at import.'],
      ['SRM placeholders (not imported)', number(excluded.placeholders), 'Skipped at import.'],
      ['vCLS system VMs (not imported)', number(excluded.vcls), 'Skipped at import.'],
    ] : []),
  ]

  const outlierRows = input.vms.filter((vm) => vm.outlierDecision).map((vm) => [
    vm.name,
    vm.outlierDecision!.choice === 'cap' ? `${OUTLIER_CHOICE_LABELS.cap} at ${gib(vm.outlierDecision!.capGiB ?? vm.storageGiB)}` : OUTLIER_CHOICE_LABELS[vm.outlierDecision!.choice],
    gib(vm.outlierDecision!.originalStorageGiB),
    vm.include ? gib(vm.storageGiB) : 'Not counted',
  ])
  const bom = design.bom

  const sourceMap = new Map<string, string>()
  if (!managementOnly) {
    findingsList.forEach((finding) => {
      if (finding.source) sourceMap.set(finding.source, finding.message)
    })
  }
  if (managementDecision === 'design') {
    managementPlan.components.forEach((component) => {
      if (component.source) sourceMap.set(component.source, component.name)
    })
    managementPlan.arcServices.forEach((service) => sourceMap.set(service.source, service.name))
  }
  if (!managementOnly) {
    network?.findings.forEach((finding) => { if (finding.source) sourceMap.set(finding.source, finding.message) })
    recovery.findings.forEach((finding) => { if (finding.source) sourceMap.set(finding.source, finding.message) })
  }

  const customer = input.customerName || 'This solution'
  const spare = platformCfg.spareNodes
  const newPlatformOutcome = () => {
    switch (design.status) {
      case 'split': return `The selected layout splits the design into ${design.clusters.length} clusters using ${design.totalNodes} total nodes, with ${spare} spare nodes in each cluster.`
      case 'feasible': return `The calculated design requires ${design.totalNodes} nodes, including ${spare} spare nodes.`
      case 'over-limit': return 'The selected design does not fit one cluster within the platform limits, and no split has been selected.'
      case 'split-failed': return 'The selected split cannot place the workload under the chosen limits, so no node count is reported.'
      case 'no-workload': return 'No workloads are included, so no platform is sized.'
      default: return 'The selected design is blocked by the findings below, and adding nodes does not resolve them.'
    }
  }
  const fitSentence = fitGap?.fits === null || !fitGap
    ? 'No workload inventory was supplied, so estate-specific utilization is not asserted.'
    : fitGap.fits ? 'The complete included estate fits.' : 'The complete included estate does not fit under the entered assumptions.'
  const engagementOutcome = engagementMode === 'new-platform'
    ? `${customer} is sized on ${chosenLabel}. ${newPlatformOutcome()}`
    : engagementMode === 'existing-capacity'
      ? `${customer} assesses an existing ${existingNodes}-node ${platformCfg.architecture.toUpperCase()} estate. ${includedVms.length > 0 ? `${includedVms.length.toLocaleString()} included workloads are applied to the capacity envelope. ${fitSentence}` : fitSentence}`
      : engagementMode === 'fit-gap'
        ? `${customer} tests ${includedVms.length.toLocaleString()} included workloads against an existing ${existingNodes}-node ${platformCfg.architecture.toUpperCase()} estate. ${fitGap?.fits === null || !fitGap ? 'A fit decision requires workload evidence.' : fitSentence}`
        : managementDecision === 'design'
          ? `${customer} is a management-only engagement. Platform hardware sizing was not requested; the report documents the management topology, virtual-machine bill of materials, dependencies, and operating-model decisions.`
          : `${customer} is a management-only engagement. No management design is saved, so the report records the management status only and does not describe a topology.`
  const managementDecisionLabel = managementDecision === 'design'
    ? 'Management design included'
    : managementDecision === 'existing'
      ? 'Existing solution recorded'
      : managementDecision === 'deferred'
        ? 'Decision deferred'
        : 'Not assessed'
  const managementSizingSentence = managementConsumesPlatform
    ? `${design.management.countedVms.length} management VM instances are included in ${usesExistingHardware ? 'the fit test on the entered hosts' : 'workload-cluster capacity'} (${design.management.impactLabel.toLowerCase()}).`
    : managementDecision === 'design' && !managementOnly
      ? `Management infrastructure does not consume workload-cluster capacity in this result: ${design.management.impactLabel.toLowerCase()}.`
      : 'Management infrastructure does not consume workload-cluster capacity in this result.'
  const architectureAlternatives = reportedOptions
    .filter((option) => option.key !== chosenKey)
    .map((option) => `${option.label}: ${option.result.feasible ? `${option.result.nodes} nodes` : 'not feasible in one cluster'}`)
    .join('; ')
  const nodesOnly = (value: number) => Number.isFinite(value) ? number(value) : 'more than the supported ceiling'
  const nodesDecision = usesExistingHardware
    ? fitGap?.fits === null ? `Describe the capacity of the ${existingNodes} entered nodes` : fitGap?.fits ? `Use the ${existingNodes} entered nodes` : `The ${existingNodes} entered nodes do not carry this workload`
    : split ? `Build ${design.totalNodes} total nodes across ${design.clusters.length} clusters`
      : design.status === 'feasible' ? `Build ${design.totalNodes} total nodes` : 'Revise the node design before approval'
  const sanMetrics: ReportMetric[] = !storage || !storage.sanMode ? [] : storage.sanMode === 'calculated'
    ? [
        { label: 'SAN usable capacity to buy', value: storage.sanToBuyUsableTiB === null ? 'Not calculated: the design does not fit' : tib(storage.sanToBuyUsableTiB), detail: `Usable capacity at ${storage.sanDrr}:1 data reduction, keeping ${number((storage.sanFreeSpaceTargetPct ?? 0) * 100)}% free.` },
        { label: 'SAN effective capacity to buy', value: storage.sanToBuyEffectiveTiB === null ? 'Not calculated' : tib(storage.sanToBuyEffectiveTiB), detail: 'Effective is usable × the data reduction ratio.' },
      ]
    : [
        { label: 'SAN usable capacity (entered)', value: tib(storage.sanUsableTiB) },
        { label: 'SAN effective capacity', value: tib(storage.sanEffectiveTiB), detail: `Usable × ${storage.sanDrr}:1 data reduction.` },
      ]
  const growthHasSan = !!growth?.points.some((point) => point.sanToBuyUsableTiB !== null)

  const sections: ReportSection[] = [
    {
      id: 'executive',
      title: 'Executive summary',
      paragraphs: [
        engagementOutcome,
        `Management status: ${managementDecisionLabel}. ${managementSizingSentence}`,
        ...(design.management.contextNote && (managementOnly || managementDecision === 'design') ? [design.management.contextNote] : []),
      ],
      metrics: [
        { label: 'Engagement', value: ENGAGEMENT_LABELS[engagementMode] },
        { label: 'Platform context', value: selectedPlatformLabel },
        { label: usesExistingHardware ? 'Existing nodes' : managementOnly ? 'Platform sizing' : 'Required nodes', value: managementOnly ? 'Not requested' : design.nodesLabel, detail: managementOnly ? undefined : design.explanation },
        ...(usesExistingHardware ? [{ label: 'Fit decision', value: fitGap?.fits === null || !fitGap ? 'Not assessed' : fitGap.fits ? 'Fits' : 'Does not fit' }] : []),
        ...(isNewPlatform && storage?.sanMode === 'calculated' ? [{ label: 'SAN to buy', value: storage.sanToBuyUsableTiB === null ? 'Not calculated' : `${tib(storage.sanToBuyUsableTiB)} usable`, detail: storage.sanToBuyEffectiveTiB === null ? undefined : `${tib(storage.sanToBuyEffectiveTiB)} effective at ${storage.sanDrr}:1` }] : []),
        { label: 'Workload VMs', value: number(includedVms.length) },
        { label: 'Management decision', value: managementDecisionLabel },
        { label: 'Management VMs', value: managementDecision === 'design' ? number(managementPlan.totalInstances) : 'Not calculated', detail: managementConsumesPlatform ? 'Included in sizing' : managementDecision === 'design' ? design.management.impactLabel : 'Separate from workload-cluster sizing' },
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
        ...(designFails ? design.errors : []),
      ],
      tables: [],
    },
    {
      id: 'architecture',
      title: 'Solution architecture',
      paragraphs: [
        managementOnly ? 'No platform architecture was assessed in this management-only engagement.' : design.explanation,
        ...(isNewPlatform && storageGuide.answered > 0
          ? [`Storage decision guidance: ${storageGuide.headline}${storageGuide.excluded.length ? ` Ruled out by the answers: ${storageGuide.excluded.map((family) => STORAGE_FAMILY_LABELS[family]).join(', ')}.` : ''} This guidance is a tool judgment; the selected design is ${chosenLabel}.`]
          : []),
      ],
      metrics: [
        { label: 'Architecture', value: selectedPlatformLabel },
        ...(managementOnly ? [] : [storageProtectionMetric(platformCfg)]),
        { label: 'Failure reserve', value: managementOnly ? 'Not assessed' : `N+${spare}` },
        { label: 'Binding constraint', value: managementOnly ? 'Not assessed' : binding },
      ],
      reasoning: managementOnly ? [] : [
        {
          decision: `Use ${selectedPlatformLabel}`,
          basis: 'User-selected',
          explanation: usesExistingHardware
            ? `This is the hardware entered under Existing hardware & fit. Surveyor tests the workload against the ${existingNodes} entered nodes and does not propose new hardware. ${fitSentence}`
            : `This is the option you selected on the Options or Shortlist page. Surveyor ranks and validates options and calculates the node count, but it never chooses the architecture for you. The selected result is ${split ? `split by user choice into ${design.clusters.length} clusters using ${design.totalNodes} nodes` : design.status === 'feasible' ? `feasible at ${design.totalNodes} nodes` : design.status === 'split-failed' ? 'a split that cannot place the workload' : 'not currently feasible in one cluster'} and is ${binding}-bound.`,
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
            ? 'The selected architecture stores workload data on the external array. Surveyor models SAN usable and effective capacity but does not apply an S2D mirror or parity setting to SAN data.'
            : platformCfg.architecture === 'hybrid'
              ? `The ${RESILIENCY[platformCfg.resiliency].label} setting applies only to S2D-hosted data; SAN protection remains array-managed.`
              : `The selected S2D resiliency controls usable-capacity efficiency and local fault tolerance for S2D-hosted data.`,
          tradeoff: usesSan
            ? 'Array RAID, snapshots, replication, and failure-domain behavior must be confirmed in the storage design because they are not inferred here.'
            : 'More protective S2D layouts consume more raw capacity; the final design must also satisfy the platform minimum-node rules.',
        },
        {
          decision: `Reserve N+${spare} host capacity`,
          basis: 'User-selected',
          explanation: `${spare} node${spare === 1 ? '' : 's'} are withheld from normal workload capacity so the design can absorb the selected host-failure reserve.${split ? ' Each split cluster keeps its own reserve.' : ''}`,
          tradeoff: 'This is a capacity reserve, not a complete availability design; storage, network, witness, backup, and management-plane failure domains are evaluated separately.',
        },
      ],
      bullets: [],
      tables: isNewPlatform ? [{
        title: 'Storage design comparison',
        headers: ['Option', 'Selected', 'Fits one cluster', 'Nodes', 'Binding constraint', 'Required storage', 'S2D usable', 'SAN usable to buy', 'Licensable cores'],
        rows: reportedOptions.map((option) => [
          option.label,
          yesNo(option.key === chosenKey),
          yesNo(option.result.feasible),
          singleClusterNodesLabel(option.result),
          option.result.binding,
          tib(option.result.requiredStorageTiB),
          option.result.feasible && option.result.capacity ? tib(option.result.capacity.usableTiB) : 'N/A',
          option.result.feasible && option.result.sanSizing ? tib(option.result.sanSizing.usableToBuyTiB) : 'N/A',
          option.result.feasible ? number(option.result.totalLicensableCores) : 'N/A',
        ]),
      }, ...(storageGuide.answered > 0 ? [{
        title: 'Storage decision answers',
        headers: ['Question', 'Answer', 'Why it matters'],
        rows: STORAGE_DECISION_QUESTIONS
          .filter((question) => input.storageDecisionAnswers?.[question.id] !== undefined)
          .map((question) => [question.question, yesNo(input.storageDecisionAnswers![question.id]!), question.why]),
      }] : [])] : [],
    },
    {
      id: 'bill-of-materials',
      title: 'What to buy',
      paragraphs: bom.available
        ? [
          `Class-level bill of materials for ${design.platformLabel}. Recommended starting points: validate with your vendor and the Windows Server Catalog.`,
          `SAN connectivity: ${bom.sanConnectivity.note}`,
        ]
        : [bom.reason ?? 'Not available.'],
      metrics: [],
      reasoning: [],
      bullets: bom.available ? bom.caveats : [],
      tables: bom.available ? [{
        title: 'Bill of materials',
        headers: ['Category', 'Item', 'Quantity', 'Detail', 'Basis'],
        rows: bom.lines.map((line) => [line.category, line.item, line.quantity, line.detail, line.basis]),
      }] : [],
    },
    {
      id: 'nodes',
      title: 'Node requirements',
      paragraphs: managementOnly ? [
        'Platform node sizing was not requested for this management-only engagement. Add a new-platform or existing-hardware profile before using this report to make host-capacity decisions.',
      ] : [
        design.explanation,
        ...(growth ? [growthPlan.strategy === 'build-now'
          ? `The ${usesExistingHardware ? 'fit test' : 'current design'} includes the full Year ${growthPlan.horizonYears} forecast at ${(growthPlan.annualGrowthPct * 100).toFixed(1)}% compounded annual workload growth.`
          : `The ${usesExistingHardware ? 'fit test' : 'current design'} is sized for today's demand; the timeline ${usesExistingHardware ? 'shows when the entered nodes run out' : 'phases node additions'} over ${growthPlan.horizonYears} years at ${(growthPlan.annualGrowthPct * 100).toFixed(1)}% compounded annual workload growth.`] : []),
      ],
      metrics: managementOnly ? [
        { label: 'Platform node sizing', value: 'Not assessed' },
      ] : [
        { label: usesExistingHardware ? 'Existing nodes' : 'Total nodes', value: design.totalNodes === null ? design.nodesLabel : number(design.totalNodes) },
        { label: 'Workload-bearing nodes', value: design.workloadNodes === null ? 'N/A' : number(design.workloadNodes) },
        ...(usesExistingHardware && fitGap ? [{ label: 'Same-spec nodes required', value: String(fitGapRequiredLabel(fitGap)) }] : []),
        { label: 'CPU-only requirement', value: Number.isFinite(finalSizing.nodesIfCpuOnly) ? number(finalSizing.nodesIfCpuOnly) : 'N/A' },
        { label: 'Memory-only requirement', value: Number.isFinite(finalSizing.nodesIfMemoryOnly) ? number(finalSizing.nodesIfMemoryOnly) : 'N/A' },
        { label: 'Storage-only requirement', value: Number.isFinite(finalSizing.nodesIfStorageOnly) ? number(finalSizing.nodesIfStorageOnly) : 'N/A' },
        { label: usesExistingHardware ? 'Licensable cores (entered hosts)' : 'Licensable cores', value: design.licensableCores === null ? 'Not calculated' : number(design.licensableCores), detail: design.licensableCoresDetail },
        { label: 'Growth strategy', value: growthPlan.strategy === 'build-now' ? 'Build forecast capacity now' : 'Phase nodes with growth' },
        { label: 'Annual growth', value: `${number(growthPlan.annualGrowthPct * 100, 1)}% for ${growthPlan.horizonYears} years` },
      ],
      reasoning: managementOnly ? [] : [
        {
          decision: nodesDecision,
          basis: 'Calculated',
          explanation: `CPU alone requires ${nodesOnly(finalSizing.nodesIfCpuOnly)} nodes, memory alone requires ${nodesOnly(finalSizing.nodesIfMemoryOnly)}, and storage alone requires ${nodesOnly(finalSizing.nodesIfStorageOnly)}. The controlling result is ${binding}; ${usesExistingHardware ? `the ${existingNodes} entered nodes include` : 'the total includes'} ${spare} reserve node${spare === 1 ? '' : 's'}.`,
          tradeoff: `Changing a nonbinding resource may not reduce node count. To reduce a ${binding}-bound result, change the demand or usable capacity that actually controls that constraint and rerun the model.`,
        },
        {
          decision: growthPlan.strategy === 'build-now'
            ? `Plan for the Year ${growthPlan.horizonYears} forecast now`
            : 'Phase node additions as demand grows',
          basis: 'User-selected',
          explanation: `The forecast compounds workload demand by ${number(growthPlan.annualGrowthPct * 100, 1)}% annually for ${growthPlan.horizonYears} years. ${growth ? `It describes ${growth.scopeLabel.toLowerCase()}.` : ''}`,
          tradeoff: 'The growth rate is a planning assumption, not measured demand. Reforecast at least annually and before large workload onboarding events.',
        },
      ],
      bullets: [],
      tables: managementOnly ? [] : [
        storage?.showLocalDrives === false ? {
          title: 'Per-node hardware profile',
          headers: ['Sockets', 'Cores / socket', 'Physical cores', 'Memory', 'Local drives'],
          rows: [[
            number(platformCfg.node.sockets),
            number(platformCfg.node.coresPerSocket),
            number(platformCfg.node.sockets * platformCfg.node.coresPerSocket),
            gib(platformCfg.node.ramGiB),
            'Not used: workload data is on the SAN',
          ]],
        } : {
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
        ...(growth ? [{
          title: 'Node growth timeline',
          headers: ['Timeline', 'Demand multiplier', 'Nodes required', 'Binding constraint', ...(growthHasSan ? ['SAN usable to buy'] : []), 'Deployment action'],
          rows: growth.points.map((point) => [
            point.year === 0 ? 'Today' : `Year ${point.year}`,
            `${number(point.demandFactor, 2)}x`,
            point.nodesLabel,
            point.binding,
            ...(growthHasSan ? [point.sanToBuyUsableTiB === null ? 'Not calculated' : tib(point.sanToBuyUsableTiB)] : []),
            point.action,
          ]),
        }] : []),
      ],
    },
    {
      id: 'existing',
      title: 'Existing capacity and fit',
      paragraphs: managementOnly ? [
        'No existing-hardware profile is part of this management-only engagement.',
      ] : !usesExistingHardware ? [
        'Existing hardware is not part of this planning path, so no fit result is reported against it.',
      ] : [
        engagementMode === 'existing-capacity'
          ? 'This section describes the capacity envelope of the hardware already owned or quoted. Inventory-specific consumption is shown only when workloads were supplied.'
          : 'This section combines the existing-hardware profile with the workload inventory to produce the fit, deficit, and same-spec expansion decision.',
      ],
      metrics: !usesExistingHardware || !fitGap ? [
        { label: 'Existing hardware', value: 'Not assessed' },
      ] : [
        { label: 'Existing nodes', value: number(existingNodes) },
        { label: 'Workload-bearing nodes', value: number(fitGap.reverse.workloadNodes) },
        { label: 'Usable physical cores', value: number(fitGap.reverse.availablePCores, 1) },
        { label: 'Usable memory', value: gib(fitGap.reverse.availableRamGiB) },
        ...(fitGap.reverse.capacity ? [{ label: 'S2D usable capacity', value: tib(fitGap.reverse.capacity.usableTiB) }] : []),
        ...(usesSan ? [
          { label: 'SAN usable capacity (entered)', value: tib(platformCfg.san.usableTiB) },
          { label: 'SAN effective capacity', value: tib(storage?.sanEffectiveTiB ?? null), detail: `Usable × ${Math.max(1, platformCfg.san.drr)}:1 data reduction.` },
        ] : []),
        { label: 'Assessed workloads', value: number(fitGap.assessedVms) },
        { label: 'Management VMs counted', value: number(fitGap.managementVms) },
        { label: 'Fit decision', value: fitGap.fits === null ? 'Not assessed' : fitGap.fits ? 'Fits' : 'Does not fit' },
        { label: 'Same-spec nodes required', value: String(fitGapRequiredLabel(fitGap)) },
        { label: 'Additional nodes', value: String(fitGapAdditionalLabel(fitGap)) },
      ],
      reasoning: !usesExistingHardware || !fitGap ? [] : [
        {
          decision: fitGap.fits === null ? 'Do not assert workload fit' : fitGap.fits ? 'The included workloads fit the entered estate' : 'The included workloads do not fit the entered estate',
          basis: fitGap.fits === null ? 'Validation requirement' : 'Calculated',
          explanation: fitGap.fits === null
            ? 'A hardware envelope was entered, but there is not enough included workload evidence to make an inventory-specific fit decision.'
            : `The fit test compares workload demand with ${existingNodes} entered nodes after host reserves and failure capacity. The current deficits are ${number(fitGap.deficits.physicalCores, 1)} physical cores, ${number(fitGap.deficits.ramGiB, 1)} GiB memory, ${number(fitGap.deficits.s2dTiB, 1)} TiB S2D usable, and ${number(fitGap.deficits.sanTiB, 1)} TiB SAN effective.`,
          tradeoff: fitGap.additionalNodes === null
            ? `A storage or hard platform constraint cannot be solved by adding identical nodes alone; revise that constraint directly.${fitGap.requiredNodesForCompute === null ? '' : ` Compute alone needs ${number(fitGap.requiredNodesForCompute)} total nodes.`}`
            : `At the entered node specification, the model requires ${fitGap.requiredNodesAtSameSpec ?? 'an unresolved number of'} total nodes, or ${fitGap.additionalNodes} additional nodes beyond the current estate.`,
        },
      ],
      bullets: !usesExistingHardware || !fitGap ? [] : fitGap.recommendations,
      tables: !usesExistingHardware || !fitGap ? [] : [{
        title: 'Current resource gaps',
        headers: ['Resource', 'Deficit', 'Unit'],
        rows: [
          ['CPU', number(fitGap.deficits.physicalCores, 1), 'physical cores'],
          ['Memory', number(fitGap.deficits.ramGiB, 1), 'GiB'],
          ['S2D', number(fitGap.deficits.s2dTiB, 1), 'usable TiB'],
          ['SAN', number(fitGap.deficits.sanTiB, 1), 'effective TiB'],
        ],
      }, ...(fitGap.fits !== null ? [{
        title: 'How many more VMs fit',
        headers: ['Tier', 'Additional VMs'],
        rows: (Object.keys(platformTiers) as TierId[]).map((tierId) => [platformTiers[tierId].label, Number.isFinite(fitGap.reverse.additionalVmsByTier[tierId]) ? number(fitGap.reverse.additionalVmsByTier[tierId]) : 'Not limited']),
      }] : [])],
    },
    {
      id: 'deployment',
      title: 'Multi-cluster implementation plan',
      paragraphs: managementOnly
        ? ['The management bill of materials is included below. Platform placement and cluster node counts require a new-platform or existing-hardware profile.']
        : [usesExistingHardware
          ? `Placement uses the ${existingNodes} entered nodes. ${fitSentence}`
          : design.feasible === true
            ? `The selected placement policy distributes the estate across ${design.clusters.length} target cluster(s) using ${design.totalNodes} total nodes.`
            : placementInputs.clusterLayout === 'single'
              ? 'The estate does not fit one cluster and no split has been selected. Change the server size, storage type, or cluster layout before implementation.'
              : 'The selected placement constraints cannot place the full estate. Revise the cluster ceiling, hardware density, or grouping rules before implementation.'],
      metrics: managementOnly ? [
        { label: 'Platform placement', value: 'Not assessed' },
        { label: 'Management instances', value: managementDecision === 'design' ? number(managementPlan.totalInstances) : 'Not calculated' },
        ...(design.management.dedicated ? [{ label: 'Dedicated management nodes', value: design.management.dedicated.nodes === null ? 'Not calculated' : number(design.management.dedicated.nodes), detail: design.management.dedicated.basis ?? design.management.dedicated.reason ?? undefined }] : []),
      ] : [
        { label: 'Target clusters', value: number(design.clusters.length) },
        { label: usesExistingHardware ? 'Entered nodes' : 'Total nodes', value: design.totalNodes === null ? 'Not calculated' : number(design.totalNodes) },
        { label: 'Workload-bearing nodes', value: design.workloadNodes === null ? 'Not calculated' : number(design.workloadNodes) },
        { label: 'Placement status', value: design.feasible === true ? usesExistingHardware ? 'Fits' : 'Feasible' : design.feasible === false ? usesExistingHardware ? 'Does not fit' : 'Needs revision' : 'Not assessed' },
        { label: 'Embedded management VMs', value: number(design.clusters.reduce((sum, cluster) => sum + cluster.managementVms, 0)) },
        { label: 'Dedicated management nodes', value: design.management.dedicated ? design.management.dedicated.nodes === null ? 'Not calculated' : number(design.management.dedicated.nodes) : 'Not selected', detail: design.management.dedicated?.reason ?? undefined },
      ],
      reasoning: managementOnly ? [
        {
          decision: 'Do not infer platform cluster placement',
          basis: 'Validation requirement',
          explanation: 'The engagement supplies a management topology but no workload-platform hardware profile, so Surveyor reports management component instances without inventing target cluster counts or host capacity.',
        },
      ] : [
        {
          decision: usesExistingHardware
            ? `Place workloads on the ${existingNodes} entered nodes`
            : placementInputs.clusterLayout === 'single'
              ? design.feasible === true ? 'Keep all workloads in one cluster' : 'Resolve the design, which does not fit one cluster'
              : design.feasible === true
                ? `Split workloads across ${design.clusters.length} target cluster${design.clusters.length === 1 ? '' : 's'}`
                : 'Revise the multi-cluster placement policy',
          basis: 'User-selected',
          explanation: usesExistingHardware
            ? 'The existing estate is one cluster of the entered hosts. Surveyor does not add or split clusters on this path.'
            : placementInputs.clusterLayout === 'single'
              ? 'The selected layout is one cluster. Surveyor does not split a design unless the user selects that layout.'
              : `The user selected a split. The planner adds clusters until every cluster fits within ${placementInputs.maxNodesPerCluster} nodes and ${placementInputs.targetVmsPerCluster} VMs, up to ${placementInputs.maxClusters} clusters. Database-tier separation is ${placementInputs.separateDatabaseTier ? 'enabled' : 'disabled'} and source-cluster preservation is ${placementInputs.preserveSourceClusters ? 'enabled' : 'disabled'}.`,
          tradeoff: 'This is deterministic capacity placement, not application-affinity discovery. Validate application dependencies, maintenance domains, licensing, network locality, and operational ownership before assigning individual VMs.',
        },
        ...(managementDecision === 'design' ? [{
          decision: `Place management components on ${managementInputs.managementPlacement.replace(/-/g, ' ')}`,
          basis: 'User-selected' as const,
          explanation: managementInputs.managementPlacement === 'workload-cluster'
            ? `Management VMs share the target workload platform. ${managementSizingSentence}`
            : managementInputs.managementPlacement === 'dedicated-management-cluster'
              ? 'Management VMs are isolated on a separately sized management cluster.'
              : 'Management VMs remain on an external virtualization fabric and are excluded from target-platform node sizing.',
          tradeoff: managementInputs.managementPlacement === 'workload-cluster'
            ? 'Shared placement is simpler but creates a bootstrap and failure-domain dependency that must be covered by recovery procedures.'
            : 'Separate placement improves isolation but requires independent capacity, lifecycle, backup, and recovery ownership.',
        }] : []),
      ],
      bullets: managementOnly ? [] : [
        ...(design.placement?.warnings ?? []),
        ...(managementDecision === 'design' && managementInputs.managementPlacement === 'external-fabric' ? ['Management VMs are placed on an external virtualization fabric and excluded from target-cluster capacity.'] : []),
      ],
      tables: !managementOnly && design.clusters.length ? [{
        title: 'Target cluster plan',
        headers: ['Cluster', 'Purpose', 'Workload VMs', 'Management VMs', 'Nodes', 'Binding constraint', 'Required storage', 'Source clusters', 'Data confidence'],
        rows: design.clusters.map((cluster) => [
          cluster.name,
          cluster.purpose,
          number(cluster.workloadVms),
          number(cluster.managementVms),
          cluster.feasible && cluster.nodes !== null ? number(cluster.nodes) : cluster.nodesLabel,
          cluster.binding,
          tib(cluster.requiredStorageTiB),
          cluster.sourceClusters.join(', ') || 'Mixed / not provided',
          cluster.confidence,
        ]),
      }] : [],
    },
    {
      id: 'workloads',
      title: 'Workload summary',
      paragraphs: [
        managementOnly
          ? 'Workload records remain in the project but are not used to size a platform in this management-only engagement.'
          : 'Only workloads marked Include are represented in demand and inventory totals.',
        `${number(input.vms.length - includedVms.length)} workload record${input.vms.length - includedVms.length === 1 ? ' is' : 's are'} excluded from sizing; the reasons are listed below.`,
        ...(input.lastImport ? [`Last import: ${input.lastImport.fileName}, ${number(input.lastImport.totalRows)} rows read, ${number(input.lastImport.importedVms)} VMs imported.`] : []),
      ],
      metrics: [
        { label: 'VMs', value: number(includedVms.length) },
        { label: 'Excluded records', value: number(input.vms.length - includedVms.length) },
        { label: 'Allocated vCPU', value: number(workloadTotals.vCpu) },
        { label: 'Allocated memory', value: gib(workloadTotals.ramGiB) },
        { label: 'Consumed storage', value: tib(workloadTotals.storageGiB / 1024) },
        { label: 'Provisioned storage (not sized)', value: tib(workloadTotals.provisionedGiB / 1024) },
      ],
      reasoning: [{
        decision: `Size from ${includedVms.length.toLocaleString()} included workload records`,
        basis: 'Derived from inputs',
        explanation: 'Only VMs whose Include flag is enabled contribute to the demand totals, tier summary, placement plan, and detailed inventory. Excluded records remain in the project but do not consume calculated capacity.',
        tradeoff: 'The Include flag and tier classification are design inputs. Review excluded, auto-classified, template, placeholder, and powered-off records before approval.',
      }],
      bullets: (input.lastImport?.warnings ?? []).map((warning) => `Import warning: ${warning}`),
      tables: [
        { title: 'Workloads by tier', headers: ['Tier', 'VMs', 'vCPU', 'Memory', 'Consumed storage'], rows: tierRows },
        { title: 'Excluded workload records', headers: ['Reason', 'Count', 'Note'], rows: excludedRows },
        ...(outlierRows.length ? [{ title: 'Data check: storage outlier choices', headers: ['VM', 'Your choice', 'Imported storage', 'Counted in sizing'], rows: outlierRows }] : []),
      ],
    },
    {
      id: 'data-quality',
      title: 'Sizing evidence and confidence',
      paragraphs: managementOnly ? [
        'Platform workload-sizing evidence was not assessed for this management-only engagement.',
      ] : [
        finalSizing.performanceAssessment.basis === 'measured-p95'
          ? `CPU and memory use per-VM P95 measurements where available, multiplied by a ${number(platformCfg.performanceComfortFactor ?? 1.25, 2)}x comfort factor. A measured CPU is actual use, so the tier vCPU-to-core ratio is not applied to it. A ${number(platformCfg.cpuPerformanceFactor ?? 1, 2)}x target/source per-core benchmark factor is applied to CPU. Missing measurements fall back to the tier allocation policy; a measured resource does not also receive the tier right-sizing factor.`
          : 'CPU and memory are sized from allocation. Imported performance data is informational until measured P95 sizing is selected.',
      ],
      metrics: managementOnly ? [
        { label: 'Platform sizing evidence', value: 'Not assessed' },
      ] : [
        { label: 'Sizing basis', value: finalSizing.performanceAssessment.basis === 'measured-p95' ? 'Measured P95 with fallback' : 'Allocation' },
        { label: 'Confidence', value: `${finalSizing.performanceAssessment.confidence.replace('-', ' ')} (${finalSizing.performanceAssessment.score}/100)` },
        { label: 'CPU P95 coverage', value: `${number(finalSizing.performanceAssessment.cpuCoveragePct, 1)}%` },
        { label: 'Memory P95 coverage', value: `${number(finalSizing.performanceAssessment.memoryCoveragePct, 1)}%` },
        { label: 'Storage performance coverage', value: `${number(finalSizing.performanceAssessment.storagePerformanceCoveragePct, 1)}%` },
        { label: '7+ day observation coverage', value: `${number(finalSizing.performanceAssessment.observationCoveragePct, 1)}%` },
      ],
      reasoning: managementOnly ? [] : [{
        decision: finalSizing.performanceAssessment.basis === 'measured-p95' ? 'Use measured P95 sizing with allocation fallback' : 'Use allocation-based sizing',
        basis: 'User-selected',
        explanation: finalSizing.performanceAssessment.basis === 'measured-p95'
          ? `Measured CPU and memory values use the entered ${number(platformCfg.performanceComfortFactor ?? 1.25, 2)}x comfort factor. Missing measurements fall back to tier policy so a VM is never treated as zero demand.`
          : 'Allocated vCPU and memory are converted through the tier policies because no measured sizing mode was selected. This is intentionally conservative and can overstate demand.',
        tradeoff: `The calculated confidence is ${finalSizing.performanceAssessment.confidence.replace('-', ' ')} (${finalSizing.performanceAssessment.score}/100). Improve coverage and observation duration before using the result as a procurement ceiling.`,
      }],
      bullets: managementOnly ? [] : finalSizing.performanceAssessment.notes,
      tables: input.dataSources?.length ? [{
        title: 'Imported data sources',
        headers: ['Type', 'File', 'Imported', 'Rows'],
        rows: input.dataSources.map((source) => [source.kind, source.fileName, source.importedAt ? new Date(source.importedAt).toLocaleString() : '', number(source.rows)]),
      }] : [],
    },
    {
      id: 'readiness',
      title: 'Migration readiness',
      paragraphs: [managementOnly ? 'Workload migration readiness was not assessed.' : 'Readiness uses the source metadata available in the imported inventory. Application-owner validation, test migration, backup verification, and cluster validation remain required.'],
      metrics: managementOnly ? [
        { label: 'Migration readiness', value: 'Not assessed' },
      ] : [
        { label: 'Ready', value: number(readiness.ready) },
        { label: 'Review', value: number(readiness.review) },
        { label: 'Blocked', value: number(readiness.blocked) },
        { label: 'Assessed', value: number(readiness.assessed) },
      ],
      reasoning: managementOnly ? [] : [{
        decision: `${readiness.ready} ready, ${readiness.review} requiring review, and ${readiness.blocked} blocked`,
        basis: 'Derived from inputs',
        explanation: 'The readiness status is derived from the source metadata present for each included VM and the known target-platform checks. It is an exception screen, not proof that an application is migration-ready.',
        tradeoff: 'Application-owner approval, dependency discovery, backup verification, a representative migration pilot, and post-migration testing remain required regardless of the calculated status.',
      }],
      bullets: [],
      tables: managementOnly ? [] : [{
        title: 'Readiness exceptions',
        headers: ['VM', 'Status', 'Category', 'Finding', 'Required action'],
        rows: readiness.findings.map((finding) => [finding.vmName, finding.status, finding.category, finding.finding, finding.action]),
      }],
    },
    {
      id: 'storage',
      title: 'Storage and CSV plan',
      paragraphs: managementOnly || !storage ? [
        managementOnly ? 'Platform storage capacity, protection, performance, and CSV/LUN layout were not assessed.' : 'Storage is not sized until workloads are included.',
      ] : [
        'Capacity values use consumed workload storage after the selected immediate-headroom and growth strategy, followed by the configured resiliency or SAN efficiency assumptions.',
        ...(usesSan ? [`SAN figures are labelled usable (what the array provides before data reduction) or effective (usable × the ${storage.sanDrr}:1 data reduction ratio). Data reduction is a planning assumption and must be confirmed with the array vendor.`] : []),
        `The storage-object plan is logical: a SAN row represents a 1:1 CSV/LUN, while an S2D row represents an S2D volume/CSV with no SAN LUN. SAN layout mode is ${platformCfg.sanCsvLayoutMode ?? 'balanced'}; Balanced and Custom treat editable tier recovery targets as an alternative, while Granular enforces them. S2D applies its recovery targets and the cluster-wide one-volume-per-node floor.${storage.perCluster ? ' The split design lists storage objects per cluster.' : ''}`,
        ...(storage.csvNotCalculatedReason ? [storage.csvNotCalculatedReason] : []),
        finalSizing.storagePerformance.validated
          ? `Storage performance is validated against the entered sustainable IOPS and throughput capabilities with ${number(finalSizing.storagePerformance.measuredVmCoveragePct, 1)}% VM coverage.`
          : `Storage performance is not fully validated. Matched IOPS/throughput coverage is ${number(finalSizing.storagePerformance.measuredVmCoveragePct, 1)}%; enter sustainable capabilities for each active domain and validate peak concurrency before approval.`,
      ],
      metrics: managementOnly || !storage ? [
        { label: 'Platform storage design', value: 'Not assessed' },
      ] : [
        { label: 'Required storage', value: tib(storage.requiredTiB) },
        { label: 'Required on S2D', value: tib(storage.requiredS2dTiB) },
        { label: 'Required on SAN', value: tib(storage.requiredSanTiB) },
        { label: 'S2D usable capacity', value: platformCfg.architecture === 'san' ? 'Not applicable' : storage.s2dUsableTiB === null ? 'Not calculated: the design does not fit' : tib(storage.s2dUsableTiB) },
        ...sanMetrics,
        { label: 'Planned logical storage objects', value: storage.totalCsvs === null ? 'Not calculated' : number(storage.totalCsvs) },
        { label: 'Performance validation', value: finalSizing.storagePerformance.validated ? 'Validated' : 'Incomplete' },
      ],
      reasoning: managementOnly || !storage ? [] : [
        {
          decision: `Provide ${tib(storage.requiredTiB)} of modeled workload storage`,
          basis: 'Calculated',
          explanation: `Surveyor starts with consumed storage for included workloads, applies the selected immediate headroom and growth strategy, then applies the protection or SAN-efficiency inputs for the active storage domain. The result is ${tib(storage.requiredS2dTiB)} on S2D and ${tib(storage.requiredSanTiB)} on SAN.`,
          tradeoff: 'Snapshot reserve, backup repositories, replica history, array metadata, and vendor-specific free-space requirements must be confirmed separately unless explicitly represented in the entered usable capacity.',
        },
        storage.totalCsvs === null ? {
          decision: 'Do not plan storage objects yet',
          basis: 'Validation requirement',
          explanation: storage.csvNotCalculatedReason ?? 'The design does not fit.',
        } : {
          decision: `Create ${storage.totalCsvs} logical storage object${storage.totalCsvs === 1 ? '' : 's'}`,
          basis: 'Calculated',
          explanation: 'Each tier is evaluated against capacity per object, VM recovery grouping, the selected SAN layout mode, and the S2D one-volume-per-node floor where applicable. The table identifies the controlling rule for every tier instead of assigning one CSV per VM or per arbitrary workload group.',
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
      tables: managementOnly || !storage ? [] : [
        {
          title: 'Storage performance',
          headers: ['Domain', 'Required IOPS', 'Available IOPS', 'Required MB/s', 'Available MB/s'],
          rows: [
            ...(platformCfg.architecture === 's2d' || platformCfg.architecture === 'hybrid' ? [[
              'S2D', number(finalSizing.storagePerformance.requiredS2dIops), finalSizing.storagePerformance.availableS2dIops === null ? 'Not entered' : number(finalSizing.storagePerformance.availableS2dIops), number(finalSizing.storagePerformance.requiredS2dThroughputMBps), finalSizing.storagePerformance.availableS2dThroughputMBps === null ? 'Not entered' : number(finalSizing.storagePerformance.availableS2dThroughputMBps),
            ]] : []),
            ...(usesSan ? [[
              'SAN', number(finalSizing.storagePerformance.requiredSanIops), finalSizing.storagePerformance.availableSanIops === null ? 'Not entered' : number(finalSizing.storagePerformance.availableSanIops), number(finalSizing.storagePerformance.requiredSanThroughputMBps), finalSizing.storagePerformance.availableSanThroughputMBps === null ? 'Not entered' : number(finalSizing.storagePerformance.availableSanThroughputMBps),
            ]] : []),
          ],
        },
        ...(storage.csvPlans ? [{
          title: platformCfg.architecture === 'san'
            ? 'SAN CSV / LUN plan'
            : platformCfg.architecture === 's2d' ? 'S2D volume / CSV plan' : 'Hybrid storage volume plan',
          headers: [...(storage.perCluster ? ['Cluster'] : []), 'Tier', 'Storage object', 'Planned demand', 'Count by size', 'VM grouping', 'Granular alternative', 'Recommended layout', 'Controlling rule'],
          rows: storage.csvPlans.map((plan) => [
            ...(storage.perCluster ? [plan.cluster ?? ''] : []),
            platformTiers[plan.tier].label,
            `${plan.domain === 'san' ? 'SAN CSV / LUN' : 'S2D volume / CSV'} (${plan.filesystem})`,
            `${tib(plan.totalTiB)} / ${number(plan.plannedVms)} planned VMs`,
            `ceil(${number(plan.totalTiB, 1)} / ${number(plan.maxSizeTiB, 1)}) = ${number(plan.countByCapacity)}`,
            `ceil(${number(plan.plannedVms)} / ${number(plan.maxVmsPerCsv)}) = ${number(plan.countByVmLimit)}${plan.recoveryGroupingApplied ? '' : ' (advisory)'}`,
            number(plan.granularAdvisoryCount),
            `${number(plan.count)} × ${tib(plan.sizeTiB)}; up to ${number(plan.vmsPerCsv)} VMs each${(plan.freeSpaceTargetPct ?? 0) > 0 ? `; size keeps ${number((plan.freeSpaceTargetPct ?? 0) * 100)}% free` : ''}`,
            plan.driver === 'node-count' ? 'S2D node ownership' : plan.driver === 'operational-balance' ? 'Operational balance' : plan.driver === 'custom-target' ? 'Custom target' : plan.driver === 'vm-count' ? 'VM recovery grouping' : plan.driver === 'both' ? 'Both requirements' : 'Volume-size requirement',
          ]),
        }] : []),
      ],
    },
    {
      id: 'network',
      title: 'Network design',
      paragraphs: [managementOnly
        ? 'Host networking was not assessed because no platform hardware profile was supplied.'
        : network
          ? `The host-network design for ${design.network.nodes} nodes separates management, compute, live migration, and storage intent while identifying switch and RDMA dependencies that must be validated against the physical fabric.`
          : design.network.reason ?? 'Host networking was not calculated.'],
      metrics: managementOnly ? [
        { label: 'Host network design', value: 'Not assessed' },
      ] : [
        { label: 'Adapters / node', value: number(networkInputs.adaptersPerNode) },
        { label: 'Adapter speed', value: `${number(networkInputs.adapterSpeedGbps)} Gbps` },
        { label: 'Aggregate / node', value: network ? `${number(network.aggregateGbpsPerNode)} Gbps` : 'Not calculated' },
        { label: 'Host switch ports', value: network ? number(network.totalHostPorts) : 'Not calculated', detail: network ? `For ${design.network.nodes} nodes` : design.network.reason ?? undefined },
        { label: 'RDMA', value: networkInputs.rdmaProtocol.toUpperCase() },
      ],
      reasoning: managementOnly || !network ? [] : [{
        decision: `Use ${networkInputs.adaptersPerNode} × ${networkInputs.adapterSpeedGbps} Gbps host adapters with ${networkInputs.rdmaProtocol.toUpperCase()}`,
        basis: 'User-selected',
        explanation: `The entered host profile provides ${number(network.aggregateGbpsPerNode)} Gbps aggregate link rate per node and ${number(network.totalHostPorts)} host-facing switch ports across ${design.network.nodes} nodes. Management, compute, live migration, and storage intents are separated in the generated plan.`,
        tradeoff: 'Aggregate link rate is not guaranteed usable throughput. Validate switch redundancy, oversubscription, QoS, VLANs, RDMA configuration, SAN paths, cabling, and failure behavior against the final physical topology.',
      }],
      bullets: managementOnly || !network ? [] : network.findings.map((finding) => `${finding.severity.toUpperCase()}: ${finding.message}`),
      tables: managementOnly || !network ? [] : [{ title: 'Network intents', headers: ['Intent'], rows: network.intentSummary.map((intent) => [intent]) }],
    },
    {
      id: 'recovery',
      title: 'Backup and disaster recovery',
      paragraphs: [managementOnly ? 'Workload backup and disaster recovery were not assessed.' : 'Cluster high availability protects against selected local failures; the recovery design separately addresses site loss, corruption, and restoration objectives. Replication bandwidth remains an estimate until measured changed-block data is available.'],
      metrics: managementOnly ? [
        { label: 'Workload recovery design', value: 'Not assessed' },
      ] : [
        { label: 'Strategy', value: recoveryInputs.strategy },
        { label: 'Protected VMs', value: number(recovery.protectedVms) },
        { label: 'Protected storage', value: tib(recovery.protectedStorageTiB) },
        { label: 'Secondary storage', value: tib(recovery.secondaryStorageTiB) },
        { label: 'Estimated burst WAN', value: `${number(recovery.estimatedBurstMbps, 1)} Mbps`, detail: recovery.bandwidthPasses ? 'Within entered WAN capacity' : 'Above entered WAN capacity' },
        { label: 'RPO / RTO', value: `${number(recoveryInputs.rpoMinutes, 1)} min / ${number(recoveryInputs.rtoHours, 1)} hr` },
      ],
      reasoning: managementOnly ? [] : [
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
      bullets: managementOnly ? [] : recovery.findings.map((finding) => `${finding.severity.toUpperCase()}: ${finding.message}`),
      tables: [],
    },
    {
      id: 'management',
      title: 'Management plane',
      paragraphs: managementDecision === 'design' ? [
        managementLabel(managementInputs),
        managementInputs.managedHosts > 0
          ? `The management design is sized for ${managementInputs.managedHosts.toLocaleString()} hosts, ${managementInputs.managedVms.toLocaleString()} workload VMs, and ${managementInputs.managedClusters.toLocaleString()} clusters.`
          : `Warning: managed hosts are not entered, so the management design is not sized for a host count. Enter the managed hosts before using this bill of materials. It covers ${managementInputs.managedVms.toLocaleString()} workload VMs.`,
        `Management components are placed on ${managementInputs.managementPlacement.replace(/-/g, ' ')}.`,
        ...(design.management.dedicated ? [design.management.dedicated.nodes !== null
          ? `The dedicated management cluster needs ${number(design.management.dedicated.nodes)} hosts.${design.management.dedicated.basis ? ` ${design.management.dedicated.basis}` : ''}`
          : design.management.dedicated.reason ?? 'The dedicated management cluster host count is not calculated.'] : []),
        ...design.management.warnings.map((warning) => `Warning: ${warning}`),
        ...design.management.errors.map((error) => `Blocking: ${error}`),
        `Management Plane Advisor: ${advisor.status === 'not-started' ? 'not answered' : advisor.status === 'ready' ? 'complete' : advisor.status}. Recommended stack: ${advisor.recommendedStack}.`,
        advisorSentence,
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
        { label: 'Workload-cluster impact', value: design.management.impactLabel, detail: design.management.impactDetail },
        { label: 'Azure Arc services', value: managementInputs.includeArc ? `Core + ${managementInputs.arcServices.length} add-on${managementInputs.arcServices.length === 1 ? '' : 's'}` : 'Not selected' },
        { label: 'Arc connectivity', value: managementInputs.includeArc ? `${managementInputs.arcConnectivity} · ${managementInputs.arcRegion}` : 'Not applicable' },
        { label: 'Arc guest scope', value: managementInputs.includeArc ? `${number(managementInputs.arcGuestScopePct, 1)}% of managed VMs` : 'Not applicable' },
        { label: 'SCOM use', value: managementInputs.monitoring === 'scom' ? 'Monitoring, reporting, and forecasting' : managementInputs.monitoring === 'scom-features' ? managementInputs.foundation === 'scvmm' ? 'Reporting and forecasting only' : 'Not planned: needs SCVMM' : 'Not selected' },
        { label: 'SCOM collection', value: managementInputs.monitoring === 'scom' || (managementInputs.monitoring === 'scom-features' && managementInputs.foundation === 'scvmm') ? `${number(managementInputs.scomDailyDataGiB, 1)} GiB/day · ${managementInputs.scomWarehouseRetentionDays} warehouse days` : 'Not selected', detail: managementPlan.scomAgentManagedComputers > 0 ? `${managementInputs.scomDailyDataUserSet ? 'Set by the user' : 'Calculated'} for ${number(managementPlan.scomAgentManagedComputers)} agent-managed computers` : undefined },
        { label: 'Dedicated management hosts', value: design.management.dedicated ? design.management.dedicated.nodes === null ? 'Not calculated' : number(design.management.dedicated.nodes) : 'Not selected', detail: design.management.dedicated?.basis ?? design.management.dedicated?.reason ?? undefined },
        { label: 'Stack source', value: stackSourceLabel },
        { label: 'Advisor recommendation', value: advisor.recommendedStack },
        { label: 'Matches the advisor', value: advisor.matches === null ? 'Not comparable: the advisor is not complete' : advisor.matches ? 'Yes' : 'No', detail: advisor.differences.join(' ') || undefined },
      ] : [{ label: 'Management decision', value: managementDecisionLabel }, ...(advisor.answeredCount > 0 ? [{ label: 'Advisor recommendation', value: advisor.recommendedStack }] : [])],
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
          decision: 'Add Azure Arc-enabled servers',
          basis: 'User-selected' as const,
          explanation: `Arc-enabled servers connect the guest operating systems in the selected scope to the chosen Azure management services. The selected connection method is ${managementInputs.arcConnectivity} in ${managementInputs.arcRegion}.`,
          tradeoff: 'Arc-enabled servers do not provide VM lifecycle operations from Azure and do not replace the management plane. They require the Connected Machine agent on each server, Azure identity and subscription ownership, and outbound connectivity. Arc-enabled SCVMM stopped new onboarding in October 2026 and retires in September 2029.',
        }] : []),
        ...(managementInputs.monitoring === 'scom-features' && managementInputs.foundation === 'scvmm' ? [{
          decision: 'Use SCOM 2025 for SCVMM reporting and forecasting, not monitoring',
          basis: 'User-selected' as const,
          explanation: 'Capacity Utilization, Host Group Forecasting, SAN Usage Forecasting, and PRO come from integrating SCVMM with SCOM. Agents are planned for the hosts and VMM servers, and operational monitoring stays with the existing platform. This is a planning choice, not a Microsoft product mode.',
          tradeoff: 'This still requires SCOM servers, databases, System Center licensing, and SQL Server Analysis Services on the reporting server for forecasting. SCOM still monitors the VMM fabric, so its alerts need an owner to avoid duplicating the monitoring platform.',
        }] : []),
        ...(managementInputs.monitoring === 'scom' || (managementInputs.monitoring === 'scom-features' && managementInputs.foundation === 'scvmm') ? [{
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
            ? `The management stack runs with the workloads. ${managementSizingSentence}`
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
      bullets: managementDecision === 'design' ? [
        ...managementPlan.dependencies.map((item) => `Dependency: ${item}`),
        ...managementPlan.cautions.map((item) => `Caution: ${item}`),
        ...advisor.recommendation.cautions.map((item) => `Advisor caution: ${item}`),
      ] : [],
      tables: [
        ...(advisorAnswerRows.length > 0 ? [{
          title: 'Management Plane Advisor answers',
          headers: ['Question', 'Answer'],
          rows: advisorAnswerRows,
        }] : []),
        ...(managementDecision === 'design' ? [
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
        ] : []),
      ],
    },
    {
      id: 'assumptions',
      title: 'Assumptions and policies',
      paragraphs: [managementOnly ? 'Platform sizing assumptions were not applied. Management component sizing bases are listed with the management bill of materials.' : 'Values marked as planning assumptions should be validated against measured workload behavior and the final hardware bill of materials.'],
      metrics: managementOnly ? [
        { label: 'Platform assumptions', value: 'Not applied' },
      ] : [
        { label: 'Immediate headroom', value: `${number(growthPlan.immediateHeadroomPct, 1)}%` },
        { label: 'Annual workload growth', value: `${number(growthPlan.annualGrowthPct * 100, 1)}% compounded` },
        { label: 'Growth horizon', value: `${growthPlan.horizonYears} years` },
        { label: 'Growth deployment', value: growthPlan.strategy === 'build-now' ? 'Build terminal forecast now' : 'Add nodes as thresholds are crossed' },
        { label: 'SMT factor', value: number(platformCfg.smtFactor, 2) },
        { label: 'Host core reserve', value: `${number(platformCfg.hostCoreReservePct * 100, 1)}%` },
        {
          label: 'Host RAM reserve',
          value: `Greater of ${gib(platformCfg.hostRamReserveGiB)} or ${number(platformCfg.hostRamReservePct * 100, 1)}%`,
          detail: 'The larger value is reserved per host; the two values are not added together.',
        },
        ...(usesSan ? [{ label: 'SAN data reduction ratio', value: `${number(Math.max(1, platformCfg.san.drr), 2)}:1`, detail: 'Effective capacity = usable × this ratio. A planning assumption; confirm with the array vendor.' }] : []),
        { label: 'Backup method', value: platformCfg.backupMethod },
        { label: 'Quorum witness', value: platformCfg.witnessType ?? 'Not selected' },
        { label: 'Sizing evidence', value: finalSizing.performanceAssessment.basis === 'measured-p95' ? `Measured P95 × ${number(platformCfg.performanceComfortFactor ?? 1.25, 2)}` : 'Allocation' },
        { label: 'CPU benchmark factor', value: finalSizing.performanceAssessment.basis === 'measured-p95' ? `${number(platformCfg.cpuPerformanceFactor ?? 1, 2)}x target/source per core` : 'Not applied' },
      ],
      reasoning: managementOnly ? [{
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
      tables: managementOnly ? [] : [{
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
      paragraphs: designFails ? [`The design is not valid as reported: ${design.headline}.`] : [],
      metrics: managementOnly ? [
        { label: 'Platform findings', value: 'Not assessed' },
      ] : [
        { label: 'Errors', value: number(errorCount) },
        { label: 'Warnings', value: number(findingsList.filter((item) => item.severity === 'warning').length) },
        { label: 'Information', value: number(findingsList.filter((item) => item.severity === 'info').length) },
      ],
      reasoning: managementOnly ? [] : [{
        decision: designFails || errorCount > 0 ? 'Do not approve the design until errors are resolved' : 'No hard validation error blocks the calculated result',
        basis: 'Validation requirement',
        explanation: 'Errors represent hard conflicts with the entered configuration or platform rules. Warnings identify risk or missing evidence, while informational findings document guidance and follow-up items.',
        tradeoff: 'A feasible calculation is not the same as an implementation-ready design. Owners must disposition material warnings and retain evidence for any accepted exception.',
      }],
      bullets: [],
      tables: managementOnly ? [] : [{
        headers: ['Severity', 'Basis', 'Finding'],
        rows: [
          ...(design.status === 'split-failed' ? (design.placement?.warnings ?? []).map((warning) => ['ERROR', 'TOOL', warning]) : []),
          ...(design.status === 'does-not-fit' && findingsList.every((item) => item.severity !== 'error') ? [['ERROR', 'TOOL', `${design.headline}. ${fitGap?.recommendations[0] ?? ''}`.trim()]] : []),
          ...findingsList.map((finding) => [finding.severity.toUpperCase(), finding.basis, finding.message]),
        ],
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
        headers: ['VM', 'Tier', 'vCPU', 'Memory', 'Consumed', 'Provisioned (not sized)', 'CPU P95', 'Memory P95', 'Source cluster', 'Power state', 'Guest OS'],
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
        managementOnly
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
