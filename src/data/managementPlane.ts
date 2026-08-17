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
}

export const DECISION_QUESTIONS: DecisionQuestion[] = MANAGEMENT_WORKBOOK.decisionQuestions.map((question) => ({ ...question }))

export type AdvisorAnswers = Record<string, boolean | undefined>

export interface AdvisorRecommendation {
  headline: string
  stack: PlaneId[]
  rationale: string[]
  cautions: string[]
}

export function recommendManagementPlane(answers: AdvisorAnswers): AdvisorRecommendation {
  const answered = Object.values(answers).filter((answer) => answer !== undefined).length
  if (answered === 0) {
    return {
      headline: 'Answer the qualifying questions to build a recommendation.',
      stack: [],
      rationale: ['The advisor recommends a management stack, not a single product winner.'],
      cautions: [],
    }
  }

  const scvmmDrivers = ['bareMetal', 'tenantSelfService', 'pureIntegration', 'drs', 'migration', 'largeFabric']
  const requiresScvmm = scvmmDrivers.some((id) => answers[id] === true)
  const smallOnly = answers.smallEdge === true && !requiresScvmm
  const preferVMode = answers.productionSoon === false && answers.pureIntegration !== true
  const wacPlane: PlaneId = preferVMode ? 'wac-virtual' : 'wac-admin'
  const stack: PlaneId[] = smallOnly ? ['classic', wacPlane] : ['scvmm', wacPlane]

  if (answers.azureReady === true && answers.airGap !== true && !smallOnly) stack.push('arc-scvmm')

  const rationale: string[] = []
  if (smallOnly) rationale.push('The small dedicated footprint does not currently justify a full fabric-management layer.')
  if (answers.bareMetal) rationale.push('Repeatable bare-metal provisioning makes SCVMM the fabric anchor.')
  if (answers.tenantSelfService) rationale.push('Tenant delegation and quotas require a real fabric or Azure control plane.')
  if (answers.pureIntegration) rationale.push('Array-aware Pure Storage workflows favor SCVMM, with WAC retained for day-two visibility.')
  if (answers.drs) rationale.push('Dynamic optimization requirements favor SCVMM over native node fairness.')
  if (answers.migration) rationale.push('The VMware conversion path must be included in the project plan and cost model.')
  if (answers.largeFabric) rationale.push('A larger estate benefits from centralized inventory, templates, and governed operations.')
  if (preferVMode) rationale.push('The delivery horizon allows vMode to be the preferred WAC experience while its production prerequisites are validated.')
  if (answers.azureReady && answers.airGap !== true) rationale.push('Arc can be offered as an additive tenant service layer, not a replacement for SCVMM.')
  if (rationale.length === 0) rationale.push('The current answers do not introduce a hard requirement beyond the core operating tools.')

  const cautions: string[] = []
  if (answers.airGap) cautions.push('Exclude Arc-enabled SCVMM because the tenant cannot accept its outbound Azure dependency.')
  if (answers.productionSoon) cautions.push('Use aMode for the production baseline and keep vMode on the evaluation track until support, HA, and certificate requirements are reverified.')
  if (answers.pureIntegration) cautions.push('Keep aMode available because the Pure extension is not supported in vMode today.')
  if (answers.smallEdge && requiresScvmm) cautions.push('The footprint is small, but one or more required capabilities still justify SCVMM; price the overhead explicitly.')

  return {
    headline: smallOnly
      ? `Use Classic Hyper-V tools with ${preferVMode ? 'WAC vMode as the preferred experience' : 'WAC Administration Mode'}.`
      : stack.includes('arc-scvmm')
        ? `Use SCVMM as the fabric, ${preferVMode ? 'WAC vMode as the preferred experience' : 'WAC aMode for day two'}, and Arc as an optional tenant layer.`
        : `Use SCVMM as the fabric of record with ${preferVMode ? 'WAC vMode preferred where its current gaps are acceptable' : 'WAC Administration Mode alongside it'}.`,
    stack,
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
  sqlStandardPerCore: 1_859,
  softwareAssuranceAnnualRate: 0.25,
  windowsPaygPerCoreMonth: 33.58,
  azureLocalPerCoreMonth: 10,
  updateManagerPerVmMonth: 5,
  defenderP2PerVmMonth: 14.6,
  guestConfigPerVmMonth: 6,
  logAnalyticsPerGb: 2.3,
}
