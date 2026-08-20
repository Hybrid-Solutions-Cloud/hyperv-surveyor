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

export interface AdvisorRecommendation {
  headline: string
  stack: PlaneId[]
  monitoring: 'none' | 'scom'
  highAvailability: boolean
  rationale: string[]
  cautions: string[]
}

export function recommendManagementPlane(answers: AdvisorAnswers): AdvisorRecommendation {
  const answered = Object.values(answers).filter((answer) => answer !== undefined).length
  if (answered === 0) {
    return {
      headline: 'Answer the qualifying questions to build a recommendation.',
      stack: [],
      monitoring: 'none',
      highAvailability: true,
      rationale: ['The advisor recommends a management stack, not a single product winner.'],
      cautions: [],
    }
  }

  const hardScvmmDrivers = ['bareMetal', 'tenantSelfService', 'pureIntegration', 'drs']
  const hasHardScvmmDriver = hardScvmmDrivers.some((id) => answers[id] === true)
  const arcRequested = answers.delegatedPortal === true
  const arcEligible = answers.airGap !== true && answers.azureReady === true
  const preferVMode = answers.largeFabric === true
    && answers.gaRequired === false
    && answers.managementHa === false
    && answers.pureIntegration !== true
  const scaleNeedsGaFabric = answers.largeFabric === true && !preferVMode
  const requiresScvmm = hasHardScvmmDriver || arcRequested || scaleNeedsGaFabric
  const foundation: PlaneId = requiresScvmm ? 'scvmm' : 'classic'
  const wacPlane: PlaneId = preferVMode ? 'wac-virtual' : 'wac-admin'
  const stack: PlaneId[] = [foundation, wacPlane]
  const monitoring = answers.monitoring === true ? 'scom' : 'none'
  const highAvailability = answers.managementHa !== false

  if (arcRequested && arcEligible) stack.push('arc-scvmm')

  const rationale: string[] = []
  if (answers.smallEdge && !requiresScvmm) rationale.push('The small dedicated footprint favors Classic tools with WAC unless a hard fabric requirement emerges.')
  if (answers.bareMetal) rationale.push('Repeatable bare-metal provisioning makes SCVMM the fabric anchor.')
  if (answers.tenantSelfService) rationale.push('Private-cloud quotas and tenant self-service require SCVMM Clouds and self-service roles.')
  if (answers.pureIntegration) rationale.push('Array-aware Pure Storage workflows favor SCVMM, subject to a current compatibility check.')
  if (answers.drs) rationale.push('Compute, storage, or power optimization requirements favor SCVMM over native cluster load balancing.')
  if (answers.migration) rationale.push('Treat VMware conversion as a separately sized and costed migration workstream, not a permanent fabric requirement.')
  if (answers.largeFabric) rationale.push('The estate needs a centralized, governed operating experience across its scale or topology.')
  if (preferVMode) rationale.push('WAC vMode is an evaluation candidate because Preview status and a standalone management service are acceptable.')
  if (arcRequested && arcEligible) rationale.push('Azure portal and ARM management require Arc as an additive layer over SCVMM.')
  if (answers.azureReady && !arcRequested) rationale.push('Arc is technically eligible, but no Azure control-plane requirement has been selected.')
  if (monitoring === 'scom') rationale.push('Add SCOM 2025 as the centralized monitoring solution and include its components in deployment sizing.')
  if (answers.automation) rationale.push('Validate every required automation workflow against the selected PowerShell, REST, and ARM surfaces.')
  if (answers.managementHa) rationale.push('Size and design the management services and their databases for the stated availability objective.')
  if (rationale.length === 0) rationale.push('The current answers do not introduce a hard requirement beyond the core operating tools.')

  const cautions: string[] = []
  if (answers.airGap) cautions.push('Exclude Arc-enabled SCVMM because the environment cannot accept its ongoing outbound Azure dependency.')
  if (arcRequested && !arcEligible) cautions.push('The requested Azure portal control plane is blocked until Azure ownership and connectivity are explicitly accepted.')
  if (answers.gaRequired && answers.largeFabric) cautions.push('Use SCVMM with WAC Administration Mode while WAC vMode remains Preview.')
  if (preferVMode) cautions.push('WAC vMode remains Preview; reverify support status, certificates, availability, and partner integrations before approval.')
  if (answers.pureIntegration) cautions.push('Validate the exact Pure Storage, provider, SCVMM, and WAC compatibility matrix before committing the design.')
  if (answers.migrationConstraints) cautions.push('SCVMM V2V alone does not meet the selected migration constraints; pilot a compatible third-party method.')
  if (answers.operationsOwnership === false && (requiresScvmm || monitoring === 'scom')) cautions.push('The selected stack adds lifecycle responsibilities the current operations team cannot own; assign them to a managed service or simplify the design.')
  if (answers.smallEdge && requiresScvmm) cautions.push('The footprint is small, but one or more required capabilities still justify SCVMM; price the overhead explicitly.')

  return {
    headline: stack.includes('arc-scvmm')
      ? `Use SCVMM as the fabric, ${preferVMode ? 'WAC vMode as the preferred experience' : 'WAC aMode for day two'}, and Arc as the Azure control layer.`
      : foundation === 'scvmm'
        ? `Use SCVMM as the fabric of record with ${preferVMode ? 'WAC vMode where its current gaps are acceptable' : 'WAC Administration Mode alongside it'}.`
        : `Use Classic Hyper-V tools with ${preferVMode ? 'WAC vMode as an evaluation experience' : 'WAC Administration Mode'}.`,
    stack,
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
