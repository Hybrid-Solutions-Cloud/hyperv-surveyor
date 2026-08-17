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
    id: 'wac-admin',
    name: 'Windows Admin Center — Administration Mode',
    shortName: 'WAC aMode',
    status: 'Production ready',
    role: 'Modern day-two browser interface for individual servers and clusters.',
    bestFor: 'A day-two interface alongside SCVMM, or the primary GUI for small dedicated environments.',
    watchFor: 'Not a tenant fabric manager; permissions and operations remain connection-oriented.',
  },
  {
    id: 'wac-virtual',
    name: 'Windows Admin Center — Virtualization Mode',
    shortName: 'WAC vMode',
    status: 'Preview — verify before use',
    role: 'Stateful, agent-based fleet management direction for larger Hyper-V estates.',
    bestFor: 'Evaluation labs and strategic tracking while production requirements mature.',
    watchFor: 'Preview limitations, high availability, certificates, storage profiles, and partner integrations.',
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
  why: string
}

export const DECISION_QUESTIONS: DecisionQuestion[] = [
  {
    id: 'airGap',
    question: 'Does the tenant require an air-gapped or sovereign environment?',
    why: 'A persistent Azure connection becomes an architectural stop, not merely a preference.',
  },
  {
    id: 'bareMetal',
    question: 'Do you need repeatable bare-metal host provisioning through BMC and PXE?',
    why: 'This immediately raises the requirement from a cluster tool to a fabric-management workflow.',
  },
  {
    id: 'tenantSelfService',
    question: 'Do tenants need self-service, quotas, delegation, or a portal?',
    why: 'Local administrator access and connection-level roles are not a tenant operating model.',
  },
  {
    id: 'pureIntegration',
    question: 'Do you need array-aware Pure Storage placement or SAN-copy provisioning?',
    why: 'Visibility and array-aware placement are different integration levels.',
  },
  {
    id: 'drs',
    question: 'Do you require automatic workload balancing comparable to DRS?',
    why: 'Native node fairness is useful but is not the same operational capability as fabric optimization.',
  },
  {
    id: 'migration',
    question: 'Is VMware-to-Hyper-V conversion part of this engagement?',
    why: 'Migration tooling is a separate purchasing and delivery decision even when it is temporary.',
  },
  {
    id: 'largeFabric',
    question: 'Will the managed fabric exceed roughly 50 hosts?',
    why: 'The size of the operating surface changes the value of inventory, templates, and parallel operations.',
  },
  {
    id: 'smallEdge',
    question: 'Is this only a two-to-four-node edge or dedicated stack?',
    why: 'Management licensing and SQL overhead can be disproportionate at this size.',
  },
  {
    id: 'azureReady',
    question: 'Does the tenant already operate in Azure and accept an Azure dependency?',
    why: 'Arc is most useful as an optional service layer for an Azure-aligned tenant.',
  },
  {
    id: 'productionSoon',
    question: 'Must the design enter production before mid-2027?',
    why: 'Preview products must be revalidated against production readiness before they enter a signed design.',
  },
]

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
  const stack: PlaneId[] = smallOnly ? ['classic', 'wac-admin'] : ['scvmm', 'wac-admin']

  if (answers.azureReady === true && answers.airGap !== true && !smallOnly) stack.push('arc-scvmm')

  const rationale: string[] = []
  if (smallOnly) rationale.push('The small dedicated footprint does not currently justify a full fabric-management layer.')
  if (answers.bareMetal) rationale.push('Repeatable bare-metal provisioning makes SCVMM the fabric anchor.')
  if (answers.tenantSelfService) rationale.push('Tenant delegation and quotas require a real fabric or Azure control plane.')
  if (answers.pureIntegration) rationale.push('Array-aware Pure Storage workflows favor SCVMM, with WAC retained for day-two visibility.')
  if (answers.drs) rationale.push('Dynamic optimization requirements favor SCVMM over native node fairness.')
  if (answers.migration) rationale.push('The VMware conversion path must be included in the project plan and cost model.')
  if (answers.largeFabric) rationale.push('A larger estate benefits from centralized inventory, templates, and governed operations.')
  if (answers.azureReady && answers.airGap !== true) rationale.push('Arc can be offered as an additive tenant service layer, not a replacement for SCVMM.')
  if (rationale.length === 0) rationale.push('The current answers do not introduce a hard requirement beyond the core operating tools.')

  const cautions: string[] = []
  if (answers.airGap) cautions.push('Exclude Arc-enabled SCVMM because the tenant cannot accept its outbound Azure dependency.')
  if (answers.productionSoon) cautions.push('Keep WAC Virtualization Mode on the evaluation track until its production requirements are reverified.')
  if (answers.smallEdge && requiresScvmm) cautions.push('The footprint is small, but one or more required capabilities still justify SCVMM; price the overhead explicitly.')

  return {
    headline: smallOnly
      ? 'Use Classic Hyper-V tools with WAC Administration Mode.'
      : stack.includes('arc-scvmm')
        ? 'Use SCVMM as the fabric, WAC for day two, and Arc as an optional tenant layer.'
        : 'Use SCVMM as the fabric of record with WAC Administration Mode alongside it.',
    stack,
    rationale,
    cautions,
  }
}

export interface CapabilityRow {
  category: string
  capability: string
  values: Record<PlaneId, string>
}

export const CAPABILITIES: CapabilityRow[] = [
  { category: 'Fabric', capability: 'Central inventory', values: { classic: 'None', scvmm: 'Full', 'wac-admin': 'Partial', 'wac-virtual': 'Full', 'arc-scvmm': 'Full' } },
  { category: 'Fabric', capability: 'Bare-metal host provisioning', values: { classic: 'None', scvmm: 'Full', 'wac-admin': 'None', 'wac-virtual': 'None', 'arc-scvmm': 'None' } },
  { category: 'Tenant', capability: 'Self-service and quotas', values: { classic: 'None', scvmm: 'Full', 'wac-admin': 'None', 'wac-virtual': 'None', 'arc-scvmm': 'Full' } },
  { category: 'Operations', capability: 'Automatic load balancing', values: { classic: 'Basic', scvmm: 'Full', 'wac-admin': 'None', 'wac-virtual': 'Partial', 'arc-scvmm': 'Via SCVMM' } },
  { category: 'Migration', capability: 'Native VMware conversion path', values: { classic: 'None', scvmm: 'Full', 'wac-admin': 'Preview extension', 'wac-virtual': 'None', 'arc-scvmm': 'Azure path' } },
  { category: 'Storage', capability: 'Pure Storage integration', values: { classic: 'SDK only', scvmm: 'Array-aware', 'wac-admin': 'Visibility', 'wac-virtual': 'Not yet', 'arc-scvmm': 'Via SCVMM' } },
  { category: 'Security', capability: 'Air-gap capable', values: { classic: 'Yes', scvmm: 'Yes', 'wac-admin': 'Yes', 'wac-virtual': 'Yes', 'arc-scvmm': 'No' } },
  { category: 'Platform', capability: 'Production-ready posture', values: { classic: 'Yes', scvmm: 'Yes', 'wac-admin': 'Yes', 'wac-virtual': 'Reverify', 'arc-scvmm': 'Yes' } },
]

export const PRICE_BOOK = {
  windowsPerTwoCorePack: 846.38,
  windowsSplaPerTwoCorePackMonth: 25,
  systemCenterPerTwoCorePack: 496,
  systemCenterSplaPerTwoCorePackMonth: 21,
  sqlStandardPerCore: 1_859,
  softwareAssuranceAnnualRate: 0.25,
  azureServicesPerVmMonth: 19.2,
}
