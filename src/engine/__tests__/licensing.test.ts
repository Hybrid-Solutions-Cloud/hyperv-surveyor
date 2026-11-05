/**
 * Phase 7: cost and licensing (audit E1 to E13) and the optional report section. Synthetic data only.
 */
import { describe, expect, it } from 'vitest'
import {
  breakEvenVmsPerHost, countVms, decideEdition, DEFAULT_COST_MODEL_INPUTS, DESIGN_DOES_NOT_FIT, estimateLicensing,
  guestOsFamily, licensingQuantities, normalizeCostModelInputs, type CostModelInputs, type LicensingQuantities,
} from '../licensing'
import { calculateProviderEconomics } from '../managementCost'
import { blankCluster, blankExistingHardware, type ExistingCluster, type ExistingHardware } from '../existingHardware'
import { resolvePlatformDesign } from '../platformDesign'
import { PRICE_BOOK, PRICE_ENTRIES } from '../../data/priceBook'
import { MANAGEMENT_WORKBOOK } from '../../data/managementWorkbook.generated'
import { DEFAULT_CONFIG, DEFAULT_PROPOSED_CONFIG, defaultTiers, newVm } from '../../state/defaults'
import { platformDesignInputs } from '../../state/usePlatformDesign'
import { DEFAULT_REPORT_METADATA, createProject, parseProject, type ProjectPayload } from '../../state/project'
import { migratePersistedState, useSurveyorStore } from '../../state/store'
import { readSharedLink, toUrl } from '../../state/urlState'
import { DEFAULT_PLACEMENT_INPUTS } from '../deploymentPlanning'
import { DEFAULT_NETWORK_INPUTS } from '../networkDesign'
import { DEFAULT_DR_INPUTS } from '../drDesign'
import type { ManagementDeploymentInputs } from '../managementDeployment'
import type { ClusterConfig, Vm } from '../types'
import { buildSolutionReport, defaultReportSelection } from '../../report/reportModel'
import { reportToHtml, reportToJson, reportToMarkdown, reportToPdfBlob, reportToWordBlob } from '../../report/exportReport'
import { designWorkbookSheets, existingWorkbookSheets } from '../../io/exportXlsx'
import { LICENSING_SECTION_TITLE } from '../../report/licensingReport'

const fleet = (count: number, partial: Partial<Vm> = {}, prefix = 'SYN') => Array.from({ length: count }, (_, i) => newVm({ name: `${prefix}${i}`, vCpu: 4, ramGiB: 32, storageGiB: 200, provisionedGiB: 400, guestOs: 'Microsoft Windows Server 2022 (64-bit)', ...partial }))

const scvmmScom: ManagementDeploymentInputs = {
  stackSource: 'user', foundation: 'scvmm', wac: 'wac-admin', includeArc: false, monitoring: 'scom', highAvailability: true,
  fabricHighAvailability: true, scomHighAvailability: true, scomSqlPlacement: 'dedicated', arcServices: [],
  managedHosts: 8, managedVms: 50, managedClusters: 1, libraryContentGiB: 500, includeIdentityServices: false,
}

function cluster(name: string, groups: Array<[number, number, number, number]>, patch: Partial<ExistingCluster> = {}): ExistingCluster {
  return blankCluster(name, {
    hostGroups: groups.map(([count, sockets, coresPerSocket, ramGiB], index) => ({ id: `${name}-g${index}`, count, sockets, coresPerSocket, ramGiB, cpuVendor: 'intel' })),
    spareNodes: 1,
    san: { usableTiB: 500, drr: 1, thinProvisioningSavings: 0, maxIops: 0, maxThroughputMBps: 0 },
    ...patch,
  })
}
const hardware = (clusters: ExistingCluster[]): ExistingHardware => ({ ...blankExistingHardware(), confirmed: true, clusters })

function payload(overrides: Partial<ProjectPayload> = {}): ProjectPayload {
  return {
    engagementMode: 'new-platform',
    managementDecision: 'unassessed',
    customerName: 'Synthetic Co',
    vms: fleet(120),
    cfg: structuredClone(DEFAULT_PROPOSED_CONFIG),
    tiers: defaultTiers(),
    chosenKey: 'san',
    existingCapacityCfg: structuredClone(DEFAULT_CONFIG),
    existingCapacityTiers: defaultTiers(),
    existingCapacityNodes: 8,
    existingHardware: blankExistingHardware(),
    managementDeploymentInputs: null,
    includeManagementInSizing: true,
    placementInputs: structuredClone(DEFAULT_PLACEMENT_INPUTS),
    networkDesignInputs: structuredClone(DEFAULT_NETWORK_INPUTS),
    drDesignInputs: structuredClone(DEFAULT_DR_INPUTS),
    reportMetadata: structuredClone(DEFAULT_REPORT_METADATA),
    dataSources: [],
    storageDecisionAnswers: {},
    ...overrides,
  }
}
const designOf = (overrides: Partial<ProjectPayload> = {}) => {
  const p = payload(overrides)
  return { design: resolvePlatformDesign(platformDesignInputs(p)), vms: p.vms }
}
const inputs = (patch: Partial<CostModelInputs> = {}): CostModelInputs => ({ ...structuredClone(DEFAULT_COST_MODEL_INPUTS), ...patch })

/** Hand-built quantities: one SAN cluster of 4 hosts with 2 × 16 cores and the VMs given. */
function simpleQuantities(vms: Vm[], patch: Partial<LicensingQuantities['design']> = {}, hosts = 4, spare = 1): LicensingQuantities {
  const counts = countVms(vms)
  const workloadHosts = hosts - spare
  return {
    path: 'new-platform', engagementMode: 'new-platform', status: 'ready', reason: null, label: 'Test', realVms: vms.length,
    windowsClaim: true, validationNote: null,
    design: { plane: 'scvmm', systemCenter: true, scom: false, arc: false, arcMeters: { updateManager: false, defenderP2: false, machineConfig: false, changeTracking: false, logAnalytics: false }, arcGuestScopePct: 100, sqlCores: 64, ...patch },
    scopes: [{
      id: 'w', label: 'Workload cluster', role: 'workload', priced: true, architecture: 'san',
      hostLines: [{ label: '2 × 16 cores', hosts, sockets: 2, coresPerSocket: 16, physicalCoresPerHost: 32, licensableCoresPerHost: 32 }],
      hosts, spareHosts: spare, workloadHosts, physicalCores: hosts * 32, licensableCores: hosts * 32, vms: counts,
      windowsVmsPerHost: Math.ceil((counts.windows + counts.unknown) / workloadHosts), managedOsesPerHost: Math.ceil(counts.total / workloadHosts), note: null,
    }],
  }
}
const line = (estimate: ReturnType<typeof estimateLicensing>, id: string) => estimate.lines.find((item) => item.id === id)

describe('E1: SQL Server for System Center', () => {
  it('is $0 under System Center rights, citing the System Center pricing page', () => {
    const estimate = estimateLicensing(simpleQuantities(fleet(30)), inputs())
    const sql = line(estimate, 'sql')!
    expect(sql.total).toBe(0)
    expect(sql.confidence).toBe('included')
    expect(sql.note).toContain('No additional licenses are needed for management servers or SQL Server technology used in System Center')
    expect(sql.note).toContain('Product Terms')
  })

  it('is priced only when you license it separately, with the existing rate', () => {
    const estimate = estimateLicensing(simpleQuantities(fleet(30)), inputs({ sqlLicensing: 'separate', termYears: 1 }))
    expect(line(estimate, 'sql')!.total).toBeCloseTo(64 * PRICE_BOOK.sqlStandardPerCore, 2)
  })

  it('takes the SQL cores from the HA SCVMM and SCOM design, and charges nothing by default', () => {
    const { design, vms } = designOf({ managementDecision: 'design', managementDeploymentInputs: scvmmScom })
    const q = licensingQuantities(design, vms)
    expect(q.design.sqlCores).toBeGreaterThan(4)
    expect(line(estimateLicensing(q, inputs()), 'sql')!.total).toBe(0)
  })

  it('E8: SPLA SQL is monthly over the term, quote required without a sourced price', () => {
    const three = estimateLicensing(simpleQuantities(fleet(30)), inputs({ basis: 'spla', sqlLicensing: 'separate', termYears: 3, rateOverrides: { sqlStandardSplaPerTwoCorePackMonth: 100 } }))
    const six = estimateLicensing(simpleQuantities(fleet(30)), inputs({ basis: 'spla', sqlLicensing: 'separate', termYears: 6, rateOverrides: { sqlStandardSplaPerTwoCorePackMonth: 100 } }))
    expect(line(three, 'sql')!.total).toBeCloseTo(32 * 100 * 36, 2)
    expect(line(six, 'sql')!.total).toBeCloseTo(2 * line(three, 'sql')!.total, 2)
    const unpriced = estimateLicensing(simpleQuantities(fleet(30)), inputs({ basis: 'spla', sqlLicensing: 'separate' }))
    expect(line(unpriced, 'sql')!.quoteRequired).toBe(true)
  })
})

describe('E3: Arc waiver eligibility', () => {
  const linux = fleet(10, { guestOs: 'Ubuntu Linux (64-bit)' }, 'LNX')
  const vms = [...fleet(20), ...linux]
  const arcAll = { arc: true, arcMeters: { updateManager: true, defenderP2: false, machineConfig: true, changeTracking: true, logAnalytics: false } }
  const charged = (estimate: ReturnType<typeof estimateLicensing>, id: string) => Number(line(estimate, id)!.quantity.split(' ')[0])

  it('charges every server with no entitlement (default off)', () => {
    const estimate = estimateLicensing(simpleQuantities(vms, arcAll), inputs())
    expect(charged(estimate, 'arc-updateManager')).toBe(30)
    expect(line(estimate, 'arc-updateManager')!.total).toBeCloseTo(30 * 5 * 36, 2)
  })

  it.each([
    ['Software Assurance or subscription', { windowsSaOrSubscription: true, windowsPayg: false, esu: false }],
    ['Windows Server pay-as-you-go', { windowsSaOrSubscription: false, windowsPayg: true, esu: false }],
    ['ESU enabled by Azure Arc', { windowsSaOrSubscription: false, windowsPayg: false, esu: true }],
  ])('waives Windows servers only with %s; Linux stays charged', (_name, entitlements) => {
    const estimate = estimateLicensing(simpleQuantities(vms, arcAll), inputs({ entitlements }))
    expect(charged(estimate, 'arc-updateManager')).toBe(10)
    expect(charged(estimate, 'arc-machineConfig')).toBe(10)
    expect(charged(estimate, 'arc-changeTracking')).toBe(10)
  })

  it('warns and does not waive for SPLA with a Software Assurance claim', () => {
    const estimate = estimateLicensing(simpleQuantities(vms, arcAll), inputs({ basis: 'spla', entitlements: { windowsSaOrSubscription: true, windowsPayg: false, esu: false } }))
    expect(charged(estimate, 'arc-updateManager')).toBe(30)
    expect(estimate.warnings.join(' ')).toMatch(/SPLA is not listed/)
  })

  it('Defender for Servers Plan 2 includes the services for every server, Linux too, and is not charged twice', () => {
    const estimate = estimateLicensing(simpleQuantities(vms, { ...arcAll, arcMeters: { ...arcAll.arcMeters, defenderP2: true } }), inputs())
    expect(line(estimate, 'arc-updateManager')!.total).toBe(0)
    expect(line(estimate, 'arc-machineConfig')!.total).toBe(0)
    expect(line(estimate, 'arc-defenderP2')!.total).toBeCloseTo(30 * 14.6 * 36, 2)
    expect(estimate.eligibility[0].source).toContain('update-manager-faq')
  })

  it('E12: meters hosts when you choose to, and applies 5 GB free per billing account per month', () => {
    const q = simpleQuantities(vms, { arc: true, arcMeters: { ...arcAll.arcMeters, logAnalytics: true } })
    const withHosts = estimateLicensing(q, inputs({ meterArcHosts: true }))
    expect(charged(withHosts, 'arc-updateManager')).toBe(34)
    const la = line(withHosts, 'arc-logAnalytics')!
    expect(la.total).toBeCloseTo((34 * 2 - 5) * 2.3 * 36, 2)
    expect(la.note).toContain('per billing account per month')
  })
})

describe('E4: Software Assurance years', () => {
  const windows = (years: number) => {
    const estimate = estimateLicensing(simpleQuantities(fleet(60)), inputs({ termYears: years, windowsEdition: 'datacenter' }))
    return { license: line(estimate, 'windows-w')!, sa: line(estimate, 'windows-w-sa')!, estimate }
  }
  it('applies SA from year 1: 3 years is 1.75× and 1 year is 1.25×', () => {
    const purchase = 4 * 16 * PRICE_BOOK.windowsPerTwoCorePack
    const three = windows(3)
    expect(three.license.total + three.sa.total).toBeCloseTo(purchase * 1.75, 2)
    expect(three.sa.years).toEqual([purchase * 0.25, purchase * 0.25, purchase * 0.25])
    expect(three.estimate.saMultiplier).toBeCloseTo(1.75, 6)
    const one = windows(1)
    expect(one.license.total + one.sa.total).toBeCloseTo(purchase * 1.25, 2)
    expect(one.sa.confidence).toBe('tool')
    expect(one.estimate.assumptions.join(' ')).toMatch(/TOOL assumption, not Microsoft-published/)
  })
  it('keeps SA at the unverified tool rate out of the priced total until you enter your rate', () => {
    const tool = windows(3)
    expect(tool.sa.quoteRequired).toBe(true)
    expect(tool.estimate.quoteRequired.some((item) => item.id === 'windows-w-sa')).toBe(true)
    expect(tool.estimate.pricedTotal).toBeCloseTo(tool.estimate.pricedPerYear.reduce((a, b) => a + b, 0), 6)
    expect(tool.estimate.pricedTotal).toBeLessThan(tool.estimate.total)
    const entered = estimateLicensing(simpleQuantities(fleet(60)), inputs({ termYears: 3, windowsEdition: 'datacenter', rateOverrides: { softwareAssuranceAnnualRate: 0.2 } }))
    expect(line(entered, 'windows-w-sa')!.quoteRequired).toBe(false)
  })

  it('has no SA under SPLA', () => {
    const estimate = estimateLicensing(simpleQuantities(fleet(60)), inputs({ basis: 'spla' }))
    expect(estimate.lines.some((item) => item.category === 'sa')).toBe(false)
    expect(estimate.saMultiplier).toBeNull()
  })
})

describe('E5: Windows Server pay-as-you-go reference', () => {
  it('licenses the hosts and each VM by its cores, with no core floor', () => {
    const vms = fleet(10, { vCpu: 1 })
    const estimate = estimateLicensing(simpleQuantities(vms), inputs({ termYears: 1 }))
    const payg = estimate.alternatives.find((item) => item.label.includes('pay-as-you-go'))!
    expect(payg.perYear).toBeCloseTo((4 * 32 + 10 * 1) * 33.58 * 12, 2)
    expect(payg.detail).toMatch(/Each VM needs its own license, with no core minimum/)
    expect(estimate.total).not.toBeCloseTo(estimate.total + payg.total)
  })
  it('E12: the Azure Local reference uses physical cores without Windows floors', () => {
    const q = simpleQuantities(fleet(4))
    q.scopes[0].hostLines[0] = { ...q.scopes[0].hostLines[0], coresPerSocket: 4, physicalCoresPerHost: 8, licensableCoresPerHost: 16 }
    q.scopes[0].physicalCores = 32
    const local = estimateLicensing(q, inputs({ termYears: 1 })).alternatives.find((item) => item.label.includes('Azure Local'))!
    expect(local.perYear).toBeCloseTo(32 * 10 * 12, 2)
  })
})

describe('E6: Windows Server and System Center editions', () => {
  it('finds the Standard vs Datacenter break-even from the verified prices', () => {
    expect(breakEvenVmsPerHost(PRICE_BOOK.windowsPerTwoCorePack, PRICE_BOOK.windowsStandardPerTwoCorePack)).toBe(11)
    const at = (vms: number) => decideEdition({ product: 'windows', choice: 'auto', architecture: 'san', osesPerHost: vms, licensableCoresPerHost: 32, datacenterRate: PRICE_BOOK.windowsPerTwoCorePack, standardRate: PRICE_BOOK.windowsStandardPerTwoCorePack })
    expect(at(10).edition).toBe('standard')
    expect(at(10).standardPerHost).toBeCloseTo(16 * 147 * 5, 2)
    expect(at(11).edition).toBe('datacenter')
    expect(at(2).reason).toMatch(/Standard costs less up to 10 Windows VMs per host; Datacenter from 11/)
  })

  it('forces Datacenter for Storage Spaces Direct and hybrid, even when you choose Standard', () => {
    for (const architecture of ['s2d', 'hybrid'] as const) {
      const decision = decideEdition({ product: 'windows', choice: 'standard', architecture, osesPerHost: 2, licensableCoresPerHost: 32, datacenterRate: 846, standardRate: 147 })
      expect(decision.edition).toBe('datacenter')
      expect(decision.forced).toBe(true)
      expect(decision.reason).toContain('editions-comparison')
    }
  })

  it('prices stacked Standard on a sparse SAN design and Datacenter on S2D', () => {
    const sparse = estimateLicensing(simpleQuantities(fleet(6)), inputs({ termYears: 1 }))
    expect(line(sparse, 'windows-w')!.product).toBe('Windows Server Standard')
    const { design, vms } = designOf({ chosenKey: 's2d-3wm' })
    const s2d = estimateLicensing(licensingQuantities(design, vms), inputs())
    expect(s2d.editions[0].windows!.edition).toBe('datacenter')
  })

  it('counts every OSE for System Center Standard, Linux included', () => {
    const vms = [...fleet(3), ...fleet(3, { guestOs: 'Red Hat Enterprise Linux 9' }, 'L')]
    const q = simpleQuantities(vms, {}, 4, 1)
    expect(q.scopes[0].managedOsesPerHost).toBe(2)
    expect(q.scopes[0].windowsVmsPerHost).toBe(1)
    expect(estimateLicensing(q, inputs()).editions[0].systemCenter!.edition).toBe('standard')
  })
})

describe('E7: CAL and RDS quantities', () => {
  it('shows Windows Server CALs as quote required with no sourced price, and RDS only when in scope', () => {
    const estimate = estimateLicensing(simpleQuantities(fleet(10)), inputs({ windowsCals: { count: 200, kind: 'device' }, rds: { inScope: false, users: 50 } }))
    const cal = line(estimate, 'windows-cal')!
    expect(cal.quoteRequired).toBe(true)
    expect(cal.unitPrice).toBeNull()
    expect(cal.note).toMatch(/pay-as-you-go needs no CALs/)
    expect(line(estimate, 'rds')).toBeUndefined()
    const rds = line(estimateLicensing(simpleQuantities(fleet(10)), inputs({ rds: { inScope: true, users: 50 } })), 'rds')!
    expect(rds.note).toMatch(/RDS CALs are still required with Windows Server pay-as-you-go/)
  })
  it('prices CALs when you enter your quoted rate', () => {
    const cal = line(estimateLicensing(simpleQuantities(fleet(10)), inputs({ windowsCals: { count: 100, kind: 'user' }, rateOverrides: { windowsCalPerUnit: 40 } })), 'windows-cal')!
    expect(cal.quoteRequired).toBe(false)
    expect(cal.total).toBe(4_000)
  })
})

describe('E9: CSP basis and motion', () => {
  it('marks CSP license lines quote required and keeps them out of the priced total', () => {
    const estimate = estimateLicensing(simpleQuantities(fleet(30)), inputs({ basis: 'csp' }))
    expect(line(estimate, 'windows-w')!.quoteRequired).toBe(true)
    expect(line(estimate, 'system-center-w')!.quoteRequired).toBe(true)
    expect(estimate.pricedTotal).toBe(0)
    expect(estimate.warnings.join(' ')).toMatch(/no sourced CSP price/)
  })
  it('defaults to Internal and warns on Internal with SPLA', () => {
    expect(DEFAULT_COST_MODEL_INPUTS.commercial.motion).toBe('internal')
    expect(DEFAULT_COST_MODEL_INPUTS.basis).toBe('perpetual-sa')
    expect(estimateLicensing(simpleQuantities(fleet(30)), inputs({ basis: 'spla' })).warnings.join(' ')).toMatch(/Internal platform with SPLA/)
  })
  it('E11: SPLA rates are unverified, so they are quote required in the report totals', () => {
    const estimate = estimateLicensing(simpleQuantities(fleet(30)), inputs({ basis: 'spla' }))
    expect(line(estimate, 'windows-w')!.quoteRequired).toBe(true)
    expect(estimate.total).toBeGreaterThan(estimate.pricedTotal)
  })
})

describe('E10: per-VM cost uses real VMs', () => {
  it('divides by the entered VMs, not a spare-adjusted count', () => {
    const vms = fleet(320)
    const q = simpleQuantities(vms, {}, 9, 1)
    const estimate = estimateLicensing(q, inputs())
    expect(estimate.realVms).toBe(320)
    expect(estimate.perVmMonth).toBeCloseTo(estimate.total / 320 / 36, 6)
    const economics = calculateProviderEconomics('scvmm', estimate, inputs())
    expect(economics.totalProviderCost).toBeGreaterThan(0)
  })
  it('excludes management VMs from the denominator', () => {
    const { design, vms } = designOf({ managementDecision: 'design', managementDeploymentInputs: scvmmScom })
    expect(licensingQuantities(design, vms).realVms).toBe(120)
  })
})

describe('E2: quantities follow the design on every path', () => {
  it('new platform, one cluster: hosts including spares and licensable cores', () => {
    const { design, vms } = designOf()
    const q = licensingQuantities(design, vms)
    expect(q.status).toBe('ready')
    expect(q.scopes.reduce((sum, item) => sum + item.hosts, 0)).toBe(design.totalNodes)
    expect(q.scopes.reduce((sum, item) => sum + item.licensableCores, 0)).toBe(design.licensableCores)
    expect(q.scopes[0].spareHosts).toBe(design.cfg.spareNodes)
  })

  it('new platform, split by your choice: one scope per cluster, same totals', () => {
    const { design, vms } = designOf({ vms: fleet(3000), placementInputs: { ...DEFAULT_PLACEMENT_INPUTS, clusterLayout: 'split', maxNodesPerCluster: 16 } })
    expect(design.status).toBe('split')
    const q = licensingQuantities(design, vms)
    expect(q.scopes).toHaveLength(design.clusters.length)
    expect(q.scopes.reduce((sum, item) => sum + item.hosts, 0)).toBe(design.totalNodes)
    expect(q.scopes.reduce((sum, item) => sum + item.licensableCores, 0)).toBe(design.licensableCores)
    expect(q.scopes.reduce((sum, item) => sum + item.vms.total, 0)).toBe(3000)
  })

  it('new platform, split: management VMs on a cluster are counted once, as on one cluster', () => {
    const management = { managementDecision: 'design' as const, managementDeploymentInputs: scvmmScom }
    const total = (q: LicensingQuantities) => q.scopes.reduce((sum, item) => sum + item.vms.total, 0)
    const one = designOf(management)
    const managementVms = one.design.management.countedVms.length
    expect(managementVms).toBeGreaterThan(0)
    expect(total(licensingQuantities(one.design, one.vms))).toBe(120 + managementVms)
    const split = designOf({ ...management, vms: fleet(3000), placementInputs: { ...DEFAULT_PLACEMENT_INPUTS, clusterLayout: 'split', maxNodesPerCluster: 16 } })
    expect(split.design.status).toBe('split')
    expect(total(licensingQuantities(split.design, split.vms))).toBe(3000 + split.design.management.countedVms.length)
  })

  it('new platform that does not fit: nothing is priced', () => {
    const { design, vms } = designOf({ vms: fleet(3000) })
    expect(design.feasible).toBe(false)
    const q = licensingQuantities(design, vms)
    expect(q.status).toBe('not-calculated')
    expect(q.reason).toBe(DESIGN_DOES_NOT_FIT)
    const estimate = estimateLicensing(q, inputs())
    expect(estimate.total).toBe(0)
    expect(estimate.lines).toHaveLength(0)
  })

  it('new platform with a dedicated management cluster licenses those hosts too', () => {
    const { design, vms } = designOf({ managementDecision: 'design', managementDeploymentInputs: { ...scvmmScom, managementPlacement: 'dedicated-management-cluster' } })
    const q = licensingQuantities(design, vms)
    const management = q.scopes.find((item) => item.role === 'management')!
    expect(management.hosts).toBe(design.management.dedicated!.nodes)
    expect(management.vms.windows).toBe(design.management.vms.length)
  })

  it('existing capacity: your entered host groups, summed per host, labelled not validated', () => {
    const hw = hardware([cluster('Prod', [[4, 2, 24, 1024], [2, 1, 4, 256]])])
    const { design, vms } = designOf({ engagementMode: 'existing-capacity', existingHardware: hw, vms: fleet(40) })
    const q = licensingQuantities(design, vms)
    expect(q.validationNote).toMatch(/Current licensing not validated/)
    expect(q.scopes[0].hosts).toBe(6)
    expect(q.scopes[0].licensableCores).toBe(4 * 48 + 2 * 16)
    expect(q.scopes[0].licensableCores).toBe(design.licensableCores)
    expect(q.scopes[0].priced).toBe(true)
  })

  it('fit: current hosts are reference only; only the hosts to add are priced', () => {
    const hw = hardware([cluster('Prod', [[2, 2, 8, 256]])])
    const { design, vms } = designOf({ engagementMode: 'fit-gap', existingHardware: hw, vms: fleet(80) })
    const q = licensingQuantities(design, vms)
    expect(q.scopes[0].priced).toBe(false)
    const additions = q.scopes.filter((item) => item.role === 'addition')
    const toAdd = design.existing!.remedies.compute.reduce((sum, item) => sum + item.hostsToAdd, 0)
    expect(toAdd).toBeGreaterThan(0)
    expect(additions.reduce((sum, item) => sum + item.hosts, 0)).toBe(toAdd)
    const estimate = estimateLicensing(q, inputs())
    expect(estimate.lines.filter((item) => item.category === 'windows').every((item) => item.scope.startsWith('Hosts to add'))).toBe(true)
  })

  it('existing paths with no hardware are not calculated', () => {
    const { design, vms } = designOf({ engagementMode: 'existing-capacity' })
    expect(licensingQuantities(design, vms).status).toBe('not-calculated')
  })

  it('management-only: System Center for the managed hosts with entered cores, no Windows claim', () => {
    const management: ManagementDeploymentInputs = { ...scvmmScom, managedHosts: 10, managedVms: 200, managedHostSockets: 2, managedHostCoresPerSocket: 32 }
    const { design, vms } = designOf({ engagementMode: 'management-only', managementDecision: 'design', managementDeploymentInputs: management })
    const q = licensingQuantities(design, vms)
    expect(q.windowsClaim).toBe(false)
    expect(q.scopes[0].hosts).toBe(10)
    expect(q.scopes[0].licensableCores).toBe(640)
    const estimate = estimateLicensing(q, inputs())
    expect(estimate.lines.some((item) => item.category === 'windows')).toBe(false)
    expect(line(estimate, 'system-center-managed')!.product).toBe('System Center Datacenter')
    expect(estimate.realVms).toBe(200)
    const missing = designOf({ engagementMode: 'management-only', managementDecision: 'design', managementDeploymentInputs: { ...management, managedHostCoresPerSocket: undefined } })
    expect(licensingQuantities(missing.design, missing.vms).status).toBe('not-calculated')
  })
})

describe('E11: price metadata', () => {
  it('gives every price a date, an https source and a confidence', () => {
    for (const [key, entry] of Object.entries(PRICE_ENTRIES)) {
      expect(entry.checked, key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.source, key).toMatch(/^https:\/\//)
      expect(['verified', 'unverified'], key).toContain(entry.confidence)
      expect(entry.note.length, key).toBeGreaterThan(0)
    }
  })

  it('agrees with the SKU catalog where they overlap', () => {
    for (const [key, entry] of Object.entries(PRICE_ENTRIES)) {
      if (!entry.skuRef) continue
      const sku = MANAGEMENT_WORKBOOK.skuReference.find((row) => row.ref === entry.skuRef)
      expect(sku, key).toBeDefined()
      const catalog = Number(sku!.price.replace(/[$,%]/g, ''))
      expect(catalog / (entry.skuDivisor ?? 1), key).toBeCloseTo(entry.value, 2)
    }
  })

  it('keeps the verified 2026-11-05 list prices', () => {
    expect(PRICE_ENTRIES.windowsPerTwoCorePack.value * 8).toBe(6_771)
    expect(PRICE_ENTRIES.windowsStandardPerTwoCorePack.value * 8).toBe(1_176)
    expect(PRICE_ENTRIES.systemCenterPerTwoCorePack.value * 8).toBe(3_968)
    expect(PRICE_ENTRIES.systemCenterStandardPerTwoCorePack.value * 8).toBe(1_455)
    expect(PRICE_ENTRIES.windowsPaygPerCoreMonth.value).toBe(33.58)
    expect(PRICE_ENTRIES.defenderP2PerVmMonth.value).toBeCloseTo(14.6, 6)
    expect(PRICE_ENTRIES.sqlStandardPerCore.confidence).toBe('unverified')
    expect(PRICE_ENTRIES.softwareAssuranceAnnualRate.confidence).toBe('unverified')
  })

  it('reads guest OS families from the inventory text', () => {
    expect(guestOsFamily({ guestOs: 'Microsoft Windows Server 2019 (64-bit)' })).toBe('windows')
    expect(guestOsFamily({ guestOs: 'SUSE Linux Enterprise 15' })).toBe('linux')
    expect(guestOsFamily({ guestOs: '' })).toBe('unknown')
  })
})

describe('Cost Model inputs persist', () => {
  const custom = inputs({ basis: 'spla', termYears: 5, includeInReport: true, entitlements: { windowsSaOrSubscription: true, windowsPayg: false, esu: false }, rateOverrides: { windowsCalPerUnit: 38 } })

  it('defaults anything missing and drops malformed values', () => {
    expect(normalizeCostModelInputs(undefined)).toEqual(DEFAULT_COST_MODEL_INPUTS)
    const odd = normalizeCostModelInputs({ basis: 'free', termYears: -4, rateOverrides: { windowsCalPerUnit: -1, nope: 5 }, selectedPlane: 'other' })
    expect(odd.basis).toBe('perpetual-sa')
    expect(odd.termYears).toBe(1)
    expect(odd.rateOverrides).toEqual({})
    expect(odd.selectedPlane).toBeNull()
  })

  it('round-trips through a project file; an older file carries no Cost Model', () => {
    const project = parseProject(JSON.stringify(createProject({ ...payload(), costModel: custom })))
    expect(project.payload.costModel).toEqual(custom)
    const old = { kind: 'hyperv-surveyor-project', schemaVersion: 7, payload: payload() }
    expect(parseProject(JSON.stringify(old)).payload.costModel).toBeUndefined()
  })

  it('a project file or share link with no Cost Model keeps your current one', () => {
    useSurveyorStore.getState().setCostModel(custom)
    const old = parseProject(JSON.stringify({ kind: 'hyperv-surveyor-project', schemaVersion: 7, payload: payload() }))
    useSurveyorStore.getState().loadProject(old.payload)
    expect(useSurveyorStore.getState().costModel).toEqual(custom)
    const link = readSharedLink(toUrl(payload(), '/report', 'http://localhost/'))!
    expect(link.scenario.costModel).toBeUndefined()
    useSurveyorStore.getState().loadScenario(link.scenario)
    expect(useSurveyorStore.getState().costModel).toEqual(custom)
    // A file that does carry one replaces it.
    useSurveyorStore.getState().loadProject({ ...payload(), costModel: structuredClone(DEFAULT_COST_MODEL_INPUTS) })
    expect(useSurveyorStore.getState().costModel).toEqual(DEFAULT_COST_MODEL_INPUTS)
  })

  it('travels in share links and migrates older browser state', () => {
    const link = readSharedLink(toUrl({ ...payload(), costModel: custom }, '/report', 'http://localhost/'))
    expect(link!.scenario.costModel).toEqual(custom)
    expect(migratePersistedState({ cfg: DEFAULT_PROPOSED_CONFIG }).costModel).toEqual(DEFAULT_COST_MODEL_INPUTS)
    expect(migratePersistedState({ costModel: custom }).costModel).toEqual(custom)
  })
})

describe('report section "Licensing (estimate, not a quote)"', () => {
  const build = (overrides: Partial<ProjectPayload> = {}, costModel: CostModelInputs = inputs({ includeInReport: true })) => {
    const p = payload({ managementDecision: 'design', managementDeploymentInputs: scvmmScom, ...overrides })
    return buildSolutionReport({ ...p, generatedAt: '2026-11-05T00:00:00.000Z', costModel })
  }
  const on = { ...defaultReportSelection('new-platform'), licensing: true }
  const off = defaultReportSelection('new-platform')

  it('is off by default on every path', () => {
    for (const mode of ['new-platform', 'existing-capacity', 'fit-gap', 'management-only'] as const) expect(defaultReportSelection(mode).licensing).toBe(false)
  })

  it('puts quantities first and lists what needs a quote, with no sell prices or margins', () => {
    const section = build().sections.find((item) => item.id === 'licensing')!
    const titles = section.tables.map((table) => table.title)
    expect(titles[0]).toBe('Quantities')
    expect(titles.indexOf('Products')).toBeGreaterThan(titles.indexOf('Edition and why'))
    expect(titles.indexOf('Pricing model and date')).toBeGreaterThan(titles.indexOf('Products'))
    expect(titles.indexOf('Assumptions')).toBeGreaterThan(titles.indexOf('Totals (priced lines only)'))
    expect(titles[titles.length - 1]).toBe('Quote required')
    const text = JSON.stringify(section)
    expect(text).not.toMatch(/margin|revenue|markup|sell price/i)
    expect(text).toContain('2026-11-05')
  })

  it('appears in every export format only when on', async () => {
    const report = build()
    expect(reportToMarkdown(report, on)).toContain(LICENSING_SECTION_TITLE)
    expect(reportToMarkdown(report, off)).not.toContain(LICENSING_SECTION_TITLE)
    expect(reportToJson(report, on)).toContain(LICENSING_SECTION_TITLE)
    expect(reportToJson(report, off)).not.toContain(LICENSING_SECTION_TITLE)
    expect(reportToHtml(report, on)).toContain(LICENSING_SECTION_TITLE)
    expect(reportToHtml(report, off)).not.toContain(LICENSING_SECTION_TITLE)
    const only = (licensing: boolean) => Object.fromEntries(Object.keys(on).map((id) => [id, id === 'executive' || (licensing && id === 'licensing')])) as typeof on
    const [wordOn, wordOff] = [await reportToWordBlob(report, only(true)), await reportToWordBlob(report, only(false))]
    expect(wordOn.size).toBeGreaterThan(wordOff.size)
    expect(reportToPdfBlob(report, only(true)).size).toBeGreaterThan(reportToPdfBlob(report, only(false)).size)
  })

  it('adds a Licensing sheet to the workbooks only when on', () => {
    const { design, vms } = designOf()
    expect(designWorkbookSheets(design, vms, undefined, inputs({ includeInReport: true })).map((sheet) => sheet.name)).toContain('Licensing')
    expect(designWorkbookSheets(design, vms, undefined, inputs()).map((sheet) => sheet.name)).not.toContain('Licensing')
    const existing = designOf({ engagementMode: 'existing-capacity', existingHardware: hardware([cluster('Prod', [[4, 2, 24, 1024]])]) })
    const sheets = existingWorkbookSheets(existing.design, existing.vms, undefined, inputs({ includeInReport: true }))
    const sheet = sheets.find((item) => item.name === 'Licensing')!
    expect(JSON.stringify(sheet.rows)).toContain('Current licensing not validated')
  })

  it('says what each path covers', () => {
    const infeasible = build({ vms: fleet(3000) }).sections.find((item) => item.id === 'licensing')!
    expect(infeasible.paragraphs.join(' ')).toContain(DESIGN_DOES_NOT_FIT)
    const mo = build({ engagementMode: 'management-only', managementDeploymentInputs: { ...scvmmScom, managedHostSockets: 2, managedHostCoresPerSocket: 16 } }).sections.find((item) => item.id === 'licensing')!
    expect(mo.paragraphs.join(' ')).toMatch(/No Windows Server licensing is claimed/)
    expect(JSON.stringify(mo.tables)).not.toContain('Windows Server Datacenter')
    const fit = build({ engagementMode: 'fit-gap', existingHardware: hardware([cluster('Prod', [[2, 2, 8, 256]])]), vms: fleet(80) }).sections.find((item) => item.id === 'licensing')!
    expect(fit.paragraphs.join(' ')).toMatch(/only the hosts you would add are priced/)
    const unverified = build({}, inputs({ includeInReport: true, basis: 'spla' })).sections.find((item) => item.id === 'licensing')!
    expect(JSON.stringify(unverified.tables)).toContain('Quote required')
  })
})

describe('E13: licensing floor wording', () => {
  it('names both editions and System Center and the real unused cores', async () => {
    const { solveForward } = await import('../solve')
    const cfg: ClusterConfig = { ...structuredClone(DEFAULT_CONFIG), architecture: 'san', node: { ...DEFAULT_CONFIG.node, sockets: 4, coresPerSocket: 3, ramGiB: 1024 } }
    const message = solveForward(cfg, fleet(1), defaultTiers()).findings.find((item) => item.code === 'LICENSE_FLOOR')!.message
    expect(message).toContain('4 × 3 = 12 physical cores')
    expect(message).toContain('Windows Server (Standard and Datacenter) and System Center')
    expect(message).toContain('20 unused cores per host')
  })
})
