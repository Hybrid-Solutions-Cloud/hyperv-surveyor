import { MANAGEMENT_WORKBOOK } from './managementWorkbook.generated'

export type PlaneId = 'classic' | 'scvmm' | 'wac-admin' | 'wac-virtual' | 'arc-scvmm'

export interface ManagementPlane {
  id: PlaneId
  name: string
  shortName: string
  status: string
  role: string
  bestFor: string
  watchFor: string
}

export const MANAGEMENT_PLANES: ManagementPlane[] = [
  {
    id: 'classic',
    name: 'Classic Hyper-V tools',
    shortName: 'Classic',
    status: 'Production ready',
    role: 'Hyper-V Manager, Failover Cluster Manager, PowerShell, and RSAT without a central fabric service.',
    bestFor: 'Small dedicated stacks, edge sites, labs, and the always-available break-glass path.',
    watchFor: 'No central inventory, tenant abstraction, templates, or native VMware conversion.',
  },
  {
    id: 'scvmm',
    name: 'System Center VMM 2025',
    shortName: 'SCVMM',
    status: 'Production ready',
    role: 'Central fabric manager for hosts, networks, storage, templates, tenant clouds, and placement.',
    bestFor: 'Multi-cluster and multi-tenant fabrics that need repeatable provisioning and governance.',
    watchFor: 'System Center and SQL licensing, a separate lifecycle, and a dated operator console.',
  },
  {
    id: 'wac-virtual',
    name: 'Windows Admin Center — Virtualization Mode',
    shortName: 'WAC vMode',
    status: 'Preview — verify before use',
    role: 'Stateful, agent-based fleet management direction for larger Hyper-V estates.',
    bestFor: 'Preferred future-facing experience for eligible estates; evaluate now while production requirements mature.',
    watchFor: 'Preview limitations, high availability, certificates, storage profiles, and partner integrations.',
  },
  {
    id: 'wac-admin',
    name: 'Windows Admin Center — Administration Mode',
    shortName: 'WAC aMode',
    status: 'Production ready',
    role: 'Modern day-two browser interface for individual servers and clusters.',
    bestFor: 'Production fallback when vMode readiness or capability gaps prevent adoption.',
    watchFor: 'Not a tenant fabric manager; permissions and operations remain connection-oriented.',
  },
  {
    id: 'arc-scvmm',
    name: 'Azure Arc-enabled SCVMM',
    shortName: 'Arc + SCVMM',
    status: 'Production ready',
    role: 'An additive Azure control plane projected over an existing SCVMM fabric.',
    bestFor: 'Azure-aligned tenants that want Azure RBAC, governance, security, monitoring, and API access.',
    watchFor: 'Requires SCVMM underneath, persistent outbound connectivity, and metered Azure services.',
  },
]

export interface DecisionQuestion {
  id: string
  question: string
  ifYes: string
  ifNo: string
  why: string
  sources: Array<{
    label: string
    url: string
  }>
}

export const DECISION_QUESTIONS: DecisionQuestion[] = MANAGEMENT_WORKBOOK.decisionQuestions.map((question) => ({
  ...question,
  sources: question.sources.map((source) => ({ ...source })),
}))

export type AdvisorAnswers = Record<string, boolean | undefined>

export type AdvisorStatus = 'incomplete' | 'ready' | 'conflict'

export interface AdvisorRecommendation {
  status: AdvisorStatus
  headline: string
  stack: PlaneId[]
  eligible: PlaneId[]
  excluded: Array<{
    id: PlaneId
    reason: string
  }>
  unansweredDecisionIds: string[]
  monitoring: 'none' | 'scom'
  highAvailability: boolean
  rationale: string[]
  cautions: string[]
}

export function recommendManagementPlane(answers: AdvisorAnswers): AdvisorRecommendation {
  const answered = Object.values(answers).filter((answer) => answer !== undefined).length
  const hardScvmmDrivers = ['bareMetal', 'tenantSelfService', 'pureIntegration', 'drs'] as const
  const wacModeGates = ['gaRequired', 'managementHa', 'wacSoftwareDefinedFabric'] as const
  const hasHardScvmmDriver = hardScvmmDrivers.some((id) => answers[id] === true)
  const arcRequested = answers.delegatedPortal === true
  const arcBlocked = answers.airGap === true || answers.azureReady === false
  const preferVMode = wacModeGates.every((id) => answers[id] === false)
  const useAdministrationMode = wacModeGates.some((id) => answers[id] === true)
  const wacPlane: PlaneId | undefined = preferVMode
    ? 'wac-virtual'
    : useAdministrationMode
      ? 'wac-admin'
      : undefined

  const hardDriversResolved = hasHardScvmmDriver
    || hardScvmmDrivers.every((id) => answers[id] === false)
  const scaleResolved = answers.largeFabric !== undefined
  const foundationResolved = hasHardScvmmDriver
    || (hardDriversResolved && scaleResolved && (
      answers.largeFabric === false || wacPlane !== undefined
    ))
  const scaleNeedsScvmm = answers.largeFabric === true && wacPlane === 'wac-admin'
  const requiresScvmm = hasHardScvmmDriver || scaleNeedsScvmm
  const foundation: PlaneId | undefined = foundationResolved
    ? requiresScvmm ? 'scvmm' : 'classic'
    : undefined

  const excludedReasons = new Map<PlaneId, string[]>()
  const exclude = (id: PlaneId, reason: string) => {
    const reasons = excludedReasons.get(id) ?? []
    if (!reasons.includes(reason)) reasons.push(reason)
    excludedReasons.set(id, reasons)
  }

  if (answers.airGap === true) exclude('arc-scvmm', 'Requires an ongoing outbound Azure connection through an Arc resource bridge.')
  if (answers.azureReady === false) exclude('arc-scvmm', 'Azure subscription, identity, DNS, networking, or ownership readiness was declined.')
  if (answers.gaRequired === true) exclude('wac-virtual', 'WAC Virtualization Mode is currently Preview, not generally available.')
  if (answers.managementHa === true) exclude('wac-virtual', 'No vMode-specific high-availability design is currently documented.')
  if (answers.wacSoftwareDefinedFabric === true) exclude('wac-virtual', 'The required software-defined storage or networking capability is not currently available or complete in vMode.')

  // Azure portal or ARM VM management is a focused SCVMM + Arc requirement. Classic and
  // either WAC mode may coexist as administrative tools, but they cannot satisfy this requirement.
  if (arcRequested) {
    const reason = 'Does not provide the required Azure portal, ARM, and Azure RBAC VM control surface.'
    exclude('classic', reason)
    exclude('wac-admin', reason)
    exclude('wac-virtual', reason)
  }

  const excluded = MANAGEMENT_PLANES
    .filter((plane) => excludedReasons.has(plane.id))
    .map((plane) => ({ id: plane.id, reason: excludedReasons.get(plane.id)!.join(' ') }))
  const eligible = MANAGEMENT_PLANES
    .map((plane) => plane.id)
    .filter((id) => !excludedReasons.has(id))

  const unansweredDecisionIds: string[] = []
  if (arcRequested) {
    for (const id of ['airGap', 'azureReady']) {
      if (answers[id] === undefined) unansweredDecisionIds.push(id)
    }
  } else {
    if (answers.delegatedPortal === undefined) unansweredDecisionIds.push('delegatedPortal')
    if (!foundationResolved) {
      for (const id of [...hardScvmmDrivers, 'largeFabric']) {
        if (answers[id] === undefined) unansweredDecisionIds.push(id)
      }
    }
    if (wacPlane === undefined) {
      for (const id of wacModeGates) {
        if (answers[id] === undefined) unansweredDecisionIds.push(id)
      }
    }
  }

  const status: AdvisorStatus = arcRequested && arcBlocked
    ? 'conflict'
    : unansweredDecisionIds.length > 0
      ? 'incomplete'
      : 'ready'

  // An incomplete result contains only components that the answers have actually established.
  // In particular, Question 1 by itself must never manufacture a Classic + WAC stack.
  const nonArcStack: PlaneId[] = []
  if (foundation) nonArcStack.push(foundation)
  if (wacPlane) nonArcStack.push(wacPlane)
  const stack: PlaneId[] = arcRequested
    ? arcBlocked ? ['scvmm'] : ['scvmm', 'arc-scvmm']
    : nonArcStack
  const monitoring = answers.monitoring === true ? 'scom' : 'none'
  const highAvailability = answers.managementHa !== false

  const rationale: string[] = []
  if (answered === 0) rationale.push('The advisor recommends a management stack, not a single product winner.')
  if (answers.smallEdge && !requiresScvmm) rationale.push('The small dedicated footprint favors a Classic foundation; the WAC mode still depends on the supportability answers.')
  if (answers.bareMetal) rationale.push('SCVMM is the fabric anchor because it can install Windows Server through BMC/PXE; WAC cluster creation starts only after the host OS is present.')
  if (answers.clusterCreation) rationale.push('Prepared-host cluster creation is available through Classic tools, SCVMM, WAC aMode, and WAC vMode; it does not select a plane by itself.')
  if (answers.tenantSelfService) rationale.push('Private-cloud quotas and tenant self-service require SCVMM Clouds and self-service roles.')
  if (answers.pureIntegration) rationale.push('Array-aware Pure Storage workflows favor SCVMM, subject to a current compatibility check.')
  if (answers.drs) rationale.push('Compute, storage, or power optimization requirements favor SCVMM over native cluster load balancing.')
  if (answers.migration) rationale.push('Treat VMware conversion as a separately sized and costed migration workstream, not a permanent fabric requirement.')
  if (answers.largeFabric) rationale.push('The estate needs a centralized, governed operating experience across its scale or topology.')
  if (!arcRequested && preferVMode) rationale.push('WAC vMode is preferred over aMode because Preview, standalone operation, and its current feature gaps were explicitly accepted.')
  if (arcRequested && !arcBlocked) rationale.push('Arc-enabled SCVMM becomes the primary Azure portal and ARM operating surface; SCVMM remains the required underlying fabric.')
  if (answers.azureReady && !arcRequested) rationale.push('Arc is technically eligible, but no Azure control-plane requirement has been selected.')
  if (monitoring === 'scom') rationale.push('Add SCOM 2025 as the centralized monitoring solution and include its components in deployment sizing.')
  if (answers.automation) rationale.push('Validate every required automation workflow against the selected PowerShell, REST, and ARM surfaces.')
  if (answers.managementHa) rationale.push('Size and design the management services and their databases for the stated availability objective.')
  if (rationale.length === 0) rationale.push('The current answers narrow the candidates but have not established a component requirement yet.')

  const cautions: string[] = []
  if (answers.airGap) cautions.push('Only Arc-enabled SCVMM is excluded by the connectivity answer; Classic, SCVMM without Arc, WAC aMode, and WAC vMode remain available unless another answer rules them out.')
  if (arcRequested && arcBlocked) cautions.push('The requested Azure portal control plane is blocked by the air-gap or Azure-readiness answer; SCVMM remains required underneath if that requirement is retained.')
  if (arcRequested && !arcBlocked && status === 'incomplete') cautions.push('Confirm Azure subscription ownership, Entra/RBAC, external DNS, and persistent outbound HTTPS before approving the Arc-enabled SCVMM path.')
  if (answers.gaRequired && answers.largeFabric) cautions.push('Use SCVMM with WAC Administration Mode while WAC vMode remains Preview.')
  if (!arcRequested && preferVMode) cautions.push('WAC vMode remains Preview; reverify support status, certificates, availability, and partner integrations before approval.')
  if (answers.wacSoftwareDefinedFabric) cautions.push('WAC vMode is not selected because its documented software-defined storage/networking capabilities are not yet available or complete.')
  if (answers.pureIntegration) cautions.push('Validate the exact Pure Storage, provider, SCVMM, and WAC compatibility matrix before committing the design.')
  if (answers.migration && answers.migrationConstraints) cautions.push('SCVMM V2V alone does not meet the selected migration constraints; pilot a compatible third-party method.')
  if (answers.automation && stack.some((id) => id === 'wac-admin' || id === 'wac-virtual')) cautions.push('Do not assume WAC exposes a supported general-purpose automation API; map each workflow to PowerShell or another documented interface.')
  if (answers.operationsOwnership === false && (requiresScvmm || monitoring === 'scom')) cautions.push('The selected stack adds lifecycle responsibilities the current operations team cannot own; assign them to a managed service or simplify the design.')
  if (answers.smallEdge && requiresScvmm) cautions.push('The footprint is small, but one or more required capabilities still justify SCVMM; price the overhead explicitly.')

  const headline = answered === 0
    ? 'Answer the qualifying questions to build a recommendation.'
    : status === 'conflict'
      ? 'No valid stack satisfies the current answers: Azure portal or ARM management requires Arc-enabled SCVMM, but Arc has been excluded.'
      : status === 'incomplete'
        ? answers.airGap === true && stack.length === 0
          ? 'Arc-enabled SCVMM is excluded. Classic, SCVMM without Arc, WAC aMode, and WAC vMode remain available.'
          : arcRequested
            ? 'Arc-enabled SCVMM is the required direction; complete the Azure readiness gates before approval.'
            : stack.length > 0
              ? 'Some components are confirmed, but the remaining decision gates must be answered before the stack is final.'
              : 'These answers narrow the options but do not yet select a management stack.'
        : stack.includes('arc-scvmm')
          ? 'Use Arc-enabled SCVMM: SCVMM as the fabric and Azure Arc as the operator or tenant VM control surface.'
          : foundation === 'scvmm'
            ? `Use SCVMM as the fabric of record with ${wacPlane === 'wac-virtual' ? 'WAC vMode where its current gaps are acceptable' : 'WAC Administration Mode alongside it'}.`
            : `Use Classic Hyper-V tools with ${wacPlane === 'wac-virtual' ? 'WAC vMode as the preferred evaluation experience' : 'WAC Administration Mode'}.`

  return {
    status,
    headline,
    stack,
    eligible,
    excluded,
    unansweredDecisionIds,
    monitoring,
    highAvailability,
    rationale,
    cautions,
  }
}

export interface CapabilityRow {
  category: string
  capability: string
  values: Record<PlaneId, string>
  vmwareVsphere8: string
  vmwareVcf9: string
  note: string
}

export const CAPABILITIES: CapabilityRow[] = MANAGEMENT_WORKBOOK.featureMatrix.map((row) => ({
  ...row,
  values: { ...row.values },
}))

export const PRICE_BOOK = {
  windowsPerTwoCorePack: 846.38,
  windowsSplaPerTwoCorePackMonth: 25,
  systemCenterPerTwoCorePack: 496,
  systemCenterSplaPerTwoCorePackMonth: 21,
  systemCenterStandardCspOneYearPerTwoCorePack: 57,
  systemCenterStandardCspThreeYearPerTwoCorePack: 143,
  sqlStandardPerCore: 1_859,
  rdsSalPerUserMonth: 6.5,
  rdsCalPerUser: 129.99,
  softwareAssuranceAnnualRate: 0.25,
  windowsPaygPerCoreMonth: 33.58,
  azureLocalPerCoreMonth: 10,
  updateManagerPerVmMonth: 5,
  defenderP2PerVmMonth: 14.6,
  guestConfigPerVmMonth: 6,
  logAnalyticsPerGb: 2.3,
}
