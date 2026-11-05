/**
 * Cross-surface consistency. For the same planning state, the Results data, the report, the
 * workbook rows, the Implementation plan numbers and the Project comparison must agree. Every
 * surface reads resolvePlatformDesign, and these tests hold them to it on all four paths.
 * Synthetic data only.
 */
import { describe, expect, it } from 'vitest'
import { buildSolutionReport, type SolutionReport } from './reportModel'
import { reportToJson, reportToPdfBlob, pdfNeedsTransliteration, wordSafeText } from './exportReport'
import { defaultReportSelection } from './reportModel'
import { resolvePlatformDesign, type PlatformDesign } from '../engine/platformDesign'
import { designWorkbookSheets, existingWorkbookSheets, type WorkbookSheet } from '../io/exportXlsx'
import { compareScenario } from '../state/scenarioComparison'
import { platformDesignInputs } from '../state/usePlatformDesign'
import { designDisasterRecovery, DEFAULT_DR_INPUTS } from '../engine/drDesign'
import { DEFAULT_NETWORK_INPUTS, designNetwork } from '../engine/networkDesign'
import { DEFAULT_CONFIG, DEFAULT_PROPOSED_CONFIG, defaultTiers, newVm } from '../state/defaults'
import { DEFAULT_PLACEMENT_INPUTS } from '../engine/deploymentPlanning'
import { DEFAULT_REPORT_METADATA, type ProjectPayload } from '../state/project'
import { navGroupsFor } from '../components/Layout'
import type { ManagementDeploymentInputs } from '../engine/managementDeployment'
import type { Vm } from '../engine/types'

const management = {
  foundation: 'scvmm', wac: 'wac-admin', includeArc: false, monitoring: 'scom', highAvailability: true,
  fabricHighAvailability: true, scomHighAvailability: true, scomSqlPlacement: 'dedicated', arcServices: [],
  managedHosts: 8, managedVms: 50, managedClusters: 1, libraryContentGiB: 500, includeIdentityServices: false,
} as unknown as ManagementDeploymentInputs

const fleet = (count: number, partial: Partial<Vm> = {}) => Array.from({ length: count }, (_, i) => newVm({ name: `SYN${i}`, vCpu: 4, ramGiB: 32, storageGiB: 200, provisionedGiB: 400, ...partial }))
const splitPlacement = { ...DEFAULT_PLACEMENT_INPUTS, clusterLayout: 'split' as const, maxNodesPerCluster: 32 }

function state(overrides: Partial<ProjectPayload> = {}): ProjectPayload {
  return {
    engagementMode: 'new-platform',
    managementDecision: 'design',
    customerName: 'Synthetic Co',
    vms: fleet(50),
    cfg: structuredClone(DEFAULT_PROPOSED_CONFIG),
    tiers: defaultTiers(),
    chosenKey: 'san',
    existingCapacityCfg: structuredClone(DEFAULT_CONFIG),
    existingCapacityTiers: defaultTiers(),
    existingCapacityNodes: 8,
    managementDeploymentInputs: management,
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

interface Surfaces {
  design: PlatformDesign
  report: SolutionReport
  sheets: WorkbookSheet[]
  project: ReturnType<typeof compareScenario>
}

function surfaces(payload: ProjectPayload): Surfaces {
  const design = resolvePlatformDesign(platformDesignInputs(payload))
  const report = buildSolutionReport({ ...payload, generatedAt: '2026-11-05T00:00:00.000Z' })
  const sheets = design.path === 'existing' ? existingWorkbookSheets(design, payload.vms, '2026-11-05T00:00:00.000Z') : designWorkbookSheets(design, payload.vms, '2026-11-05T00:00:00.000Z')
  return { design, report, sheets, project: compareScenario(payload) }
}

const section = (report: SolutionReport, id: string) => report.sections.find((item) => item.id === id)!
const metric = (report: SolutionReport, id: string, label: string) => section(report, id).metrics.find((item) => item.label === label)
const sheetRow = (sheets: WorkbookSheet[], sheet: string, label: string) => sheets.find((item) => item.name === sheet)?.rows.find((row) => row[0] === label)
const allText = (report: SolutionReport) => JSON.stringify(report.sections)
const num = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 0 })

/** The checks every new-platform state must pass, whatever its status. */
function expectNewPlatformAgreement({ design, report, sheets, project }: Surfaces, payload: ProjectPayload) {
  // Results data and the report headline.
  expect(metric(report, 'executive', 'Required nodes')?.value).toBe(design.nodesLabel)
  expect(metric(report, 'nodes', 'Total nodes')?.value).toBe(design.totalNodes === null ? design.nodesLabel : num(design.totalNodes))
  // Workbook rows.
  expect(sheetRow(sheets, 'Summary', 'Total nodes')?.[1]).toBe(design.totalNodes ?? design.nodesLabel)
  expect(sheetRow(sheets, 'Summary', 'Management VMs counted in sizing')?.[1]).toBe(design.management.countedVms.length)
  expect(sheetRow(sheets, 'Summary', 'Licensable cores')?.[1]).toBe(design.licensableCores ?? design.licensableCoresDetail)
  // Implementation plan: cluster rows, network and recovery.
  const clusterTable = section(report, 'deployment').tables.find((table) => table.title === 'Target cluster plan')
  expect(clusterTable?.rows.length ?? 0).toBe(design.clusters.length)
  design.clusters.forEach((cluster, index) => {
    expect(clusterTable!.rows[index][4]).toBe(cluster.feasible && cluster.nodes !== null ? num(cluster.nodes) : cluster.nodesLabel)
    expect(clusterTable!.rows[index][3]).toBe(num(cluster.managementVms))
  })
  expect(metric(report, 'deployment', 'Total nodes')?.value).toBe(design.totalNodes === null ? 'Not calculated' : num(design.totalNodes))
  const ports = metric(report, 'network', 'Host switch ports')?.value
  if (design.network.nodes === null) expect(ports).toBe('Not calculated')
  else expect(ports).toBe(num(designNetwork(design.cfg, design.network.nodes, payload.networkDesignInputs).totalHostPorts))
  if (design.sizing) {
    const dr = designDisasterRecovery(payload.vms, design.sizing, payload.drDesignInputs)
    expect(metric(report, 'recovery', 'Protected storage')?.value).toBe(`${dr.protectedStorageTiB.toLocaleString('en-US', { maximumFractionDigits: 2 })} TiB`)
  }
  // Project comparison.
  expect(project.nodes).toBe(design.nodesLabel)
  expect(project.design.totalNodes).toBe(design.totalNodes)
  // Growth: the report and the workbook show the same forecast as the design.
  const timeline = section(report, 'nodes').tables.find((table) => table.title === 'Node growth timeline')
  const growthRows = sheets.find((sheet) => sheet.name === 'Growth Plan')!.rows
  if (design.growth) {
    expect(timeline?.rows.map((row) => row[2])).toEqual(design.growth.points.map((point) => point.nodesLabel))
    const firstPoint = growthRows.findIndex((row) => row[0] === 'Today')
    expect(growthRows.slice(firstPoint).map((row) => row[2])).toEqual(design.growth.points.map((point) => point.nodes ?? point.nodesLabel))
  }
  // A design that does not fit never claims to be clean.
  const findingsDecision = section(report, 'findings').reasoning[0]?.decision
  if (design.feasible === false) expect(findingsDecision).not.toBe('No hard validation error blocks the calculated result')
}

describe('one cluster, new platform', () => {
  for (const [name, include] of [['management included', true], ['management excluded', false]] as const) {
    it(`agrees on every surface (${name})`, () => {
      const payload = state({ includeManagementInSizing: include })
      const all = surfaces(payload)
      expect(all.design.status).toBe('feasible')
      expect(all.design.management.counted).toBe(include)
      expectNewPlatformAgreement(all, payload)
      // The Results headline includes management when it is counted.
      const withoutManagement = resolvePlatformDesign(platformDesignInputs({ ...payload, includeManagementInSizing: false }))
      if (include) expect(all.design.totalNodes!).toBeGreaterThanOrEqual(withoutManagement.totalNodes!)
      expect(metric(all.report, 'management', 'Workload-cluster impact')?.value).toBe(all.design.management.impactLabel)
      expect(sheetRow(all.sheets, 'Summary', 'Management host impact')?.[1]).toBe(all.design.management.impactLabel)
    })
  }

  it('says management was excluded by choice, not that it could not compare', () => {
    const { report } = surfaces(state({ includeManagementInSizing: false }))
    expect(metric(report, 'management', 'Workload-cluster impact')?.value).toBe('Excluded from sizing by choice')
  })

  it('never attributes extra nodes to management when there are no management VMs', () => {
    const design = resolvePlatformDesign(platformDesignInputs(state({ managementDecision: 'deferred' })))
    expect(design.management.counted).toBe(false)
    expect(design.management.hostDelta).toBeNull()
    expect(design.management.impactLabel).not.toMatch(/^\+/)
  })

  it('reports SAN to buy in the summary and per year, and lists no local drives on SAN', () => {
    const payload = state({ cfg: { ...structuredClone(DEFAULT_PROPOSED_CONFIG), annualGrowthPct: 0.1, growthHorizonYears: 3 } })
    const { design, report, sheets } = surfaces(payload)
    expect(design.storage?.sanToBuyUsableTiB).not.toBeNull()
    expect(metric(report, 'executive', 'SAN to buy')?.value).toContain('usable')
    const timeline = section(report, 'nodes').tables.find((table) => table.title === 'Node growth timeline')!
    expect(timeline.headers).toContain('SAN usable to buy')
    expect(sheets.find((sheet) => sheet.name === 'Growth Plan')!.rows.some((row) => row.includes('SAN usable to buy (TiB)'))).toBe(true)
    const profile = section(report, 'nodes').tables.find((table) => table.title === 'Per-node hardware profile')!
    expect(profile.headers).not.toContain('Capacity drives')
    expect(sheetRow(sheets, 'Summary', 'Capacity drives per node')).toBeUndefined()
    expect(sheetRow(sheets, 'Summary', 'Storage protection')?.[1]).toMatch(/External SAN/)
  })

  it('labels fixed SAN capacity as usable and effective and discloses the data reduction ratio', () => {
    const cfg = { ...structuredClone(DEFAULT_PROPOSED_CONFIG), sanSizingMode: 'fixed' as const, san: { ...DEFAULT_PROPOSED_CONFIG.san, usableTiB: 500, drr: 2.5 } }
    const { report, design } = surfaces(state({ cfg }))
    expect(design.storage?.sanUsableTiB).toBe(500)
    expect(design.storage?.sanEffectiveTiB).toBe(1250)
    expect(metric(report, 'storage', 'SAN usable capacity (entered)')?.value).toBe('500 TiB')
    expect(metric(report, 'storage', 'SAN effective capacity')?.value).toBe('1,250 TiB')
    expect(metric(report, 'assumptions', 'SAN data reduction ratio')?.value).toBe('2.5:1')
  })
})

describe('split, new platform', () => {
  for (const include of [true, false]) {
    it(`reports split totals per cluster everywhere (management ${include ? 'included' : 'excluded'})`, () => {
      const payload = state({ vms: fleet(3000), placementInputs: splitPlacement, includeManagementInSizing: include, cfg: { ...structuredClone(DEFAULT_PROPOSED_CONFIG), annualGrowthPct: 0.05, growthHorizonYears: 2 } })
      const all = surfaces(payload)
      expect(all.design.status).toBe('split')
      expect(all.design.clusters.length).toBeGreaterThan(1)
      expect(all.design.totalNodes).toBe(all.design.clusters.reduce((sum, cluster) => sum + cluster.nodes!, 0))
      expectNewPlatformAgreement(all, payload)
      expect(all.design.nodesLabel).toMatch(/across \d+ clusters/)
      expect(allText(all.report)).not.toContain('not currently feasible in one cluster')
      expect(section(all.report, 'executive').paragraphs[0]).toContain('splits the design')
      expect(all.design.growth?.scope).toBe('split')
      expect(all.design.growth?.points[0].nodesLabel).toMatch(/across/)
      // Summary target cluster rows match the per-cluster plan.
      const summary = all.sheets.find((sheet) => sheet.name === 'Summary')!.rows
      const header = summary.findIndex((row) => row[0] === 'Cluster')
      expect(summary.slice(header + 1, header + 1 + all.design.clusters.length).map((row) => row[4])).toEqual(all.design.clusters.map((cluster) => cluster.nodes))
    })
  }

  it('sums S2D usable storage across the split clusters', () => {
    const payload = state({ vms: fleet(1500), placementInputs: { ...splitPlacement, maxNodesPerCluster: 8 }, chosenKey: 's2d-3wm' })
    const { design, report } = surfaces(payload)
    expect(design.status).toBe('split')
    const total = design.clusters.reduce((sum, cluster) => sum + (cluster.s2dUsableTiB ?? 0), 0)
    expect(design.storage?.s2dUsableTiB).toBeCloseTo(total, 6)
    expect(metric(report, 'storage', 'S2D usable capacity')?.value).toBe(`${total.toLocaleString('en-US', { maximumFractionDigits: 2 })} TiB`)
    expect(design.storage?.perCluster).toBe(true)
  })

  it('reports a failed split as a failed split, with no single-cluster node count', () => {
    const payload = state({ vms: fleet(3000), placementInputs: { ...splitPlacement, maxNodesPerCluster: 4, maxClusters: 2 } })
    const all = surfaces(payload)
    expect(all.design.status).toBe('split-failed')
    expect(all.design.nodesLabel).toBe('Split placement not feasible')
    expectNewPlatformAgreement(all, payload)
    expect(metric(all.report, 'executive', 'Required nodes')?.value).not.toMatch(/needed/)
    expect(all.project.result).toBe('Split not feasible')
  })
})

describe('design that does not fit', () => {
  const payload = () => state({ vms: fleet(3000) })

  it('agrees on every surface and gives no plan for something that cannot be built', () => {
    const all = surfaces(payload())
    expect(all.design.status).toBe('over-limit')
    expectNewPlatformAgreement(all, payload())
    expect(metric(all.report, 'storage', 'Planned logical storage objects')?.value).toBe('Not calculated')
    expect(section(all.report, 'storage').tables.some((table) => /CSV|volume/.test(table.title ?? ''))).toBe(false)
    expect(metric(all.report, 'network', 'Host switch ports')?.detail).toMatch(/Not calculated/)
    expect(all.sheets.find((sheet) => sheet.name === 'CSV Plan')!.rows.some((row) => String(row[0]).startsWith('Not calculated'))).toBe(true)
    expect(all.sheets.find((sheet) => sheet.name === 'Summary')!.rows.some((row) => row[0] === 'S2D CAPACITY CHAIN')).toBe(false)
    expect(section(all.report, 'findings').reasoning[0].decision).toBe('Do not approve the design until errors are resolved')
  })

  it('bases management defaults on the nodes needed, never the cluster ceiling', () => {
    const design = resolvePlatformDesign(platformDesignInputs(payload()))
    expect(design.sizing?.feasible).toBe(false)
    expect(design.management.contextNodes).toBe(design.sizing!.nodesNeeded)
    expect(design.management.contextNodes).not.toBe(design.sizing!.clusterNodeLimit)
  })

  it('reports the S2D chain only for a buildable single cluster', () => {
    const sheets = designWorkbookSheets(resolvePlatformDesign(platformDesignInputs(state({ vms: fleet(3000), chosenKey: 's2d-3wm' }))), [])
    expect(sheets[0].rows.some((row) => row[0] === 'S2D CAPACITY CHAIN')).toBe(false)
  })
})

describe('existing hardware', () => {
  const tight = () => ({ ...structuredClone(DEFAULT_CONFIG), spareNodes: 1, node: { ...DEFAULT_CONFIG.node, sockets: 2, coresPerSocket: 16, ramGiB: 512 } })

  for (const mode of ['existing-capacity', 'fit-gap'] as const) {
    for (const include of [true, false]) {
      it(`describes the entered estate on ${mode} (management ${include ? 'included' : 'excluded'})`, () => {
        const payload = state({ engagementMode: mode, existingCapacityNodes: 4, existingCapacityCfg: tight(), vms: fleet(80), includeManagementInSizing: include })
        const { design, report, sheets, project } = surfaces(payload)
        expect(design.path).toBe('existing')
        expect(design.totalNodes).toBe(4)
        expect(metric(report, 'executive', 'Existing nodes')?.value).toBe('4')
        expect(metric(report, 'nodes', 'Existing nodes')?.value).toBe('4')
        expect(sheetRow(sheets, 'Capacity and Fit', 'Existing nodes')?.[1]).toBe(4)
        expect(project.nodes).toBe('4 existing')
        // Fit verdict agrees.
        const verdict = design.existing!.verdict === 'fits' ? 'Fits' : 'Does not fit'
        expect(metric(report, 'executive', 'Fit decision')?.value).toBe(verdict)
        expect(metric(report, 'existing', 'Fit decision')?.value).toBe(verdict)
        expect(sheetRow(sheets, 'Capacity and Fit', 'Decision')?.[1]).toBe(verdict.toUpperCase())
        expect(project.result).toBe(verdict)
        expect(metric(report, 'existing', 'Management VMs counted')?.value).toBe(num(design.management.countedVms.length))
        expect(sheetRow(sheets, 'Capacity and Fit', 'Management VMs counted')?.[1]).toBe(design.management.countedVms.length)
        // Never a greenfield build.
        const text = allText(report)
        expect(text).not.toMatch(/Build \d+ (total )?nodes/)
        expect(text).not.toContain('Initial build')
        // Licensable cores are for the entered hosts.
        expect(metric(report, 'nodes', 'Licensable cores (entered hosts)')?.value).toBe(num(design.cfg.node.sockets * design.cfg.node.coresPerSocket * 4))
        // Placement and network use the entered nodes, and placement is not green when fit fails.
        expect(metric(report, 'deployment', 'Entered nodes')?.value).toBe('4')
        expect(metric(report, 'deployment', 'Placement status')?.value).toBe(design.existing!.verdict === 'fits' ? 'Fits' : 'Does not fit')
        expect(design.network.nodes).toBe(4 + (design.management.dedicated?.nodes ?? 0))
        expect(design.clusters[0].feasible).toBe(design.existing!.verdict !== 'does-not-fit')
      })
    }
  }

  it('makes the workload not fit only when management VMs are counted', () => {
    const base = { engagementMode: 'fit-gap' as const, existingCapacityNodes: 2, existingCapacityCfg: { ...tight(), node: { ...tight().node, coresPerSocket: 48 } }, vms: fleet(12) }
    expect(surfaces(state({ ...base, includeManagementInSizing: false })).design.status).toBe('fits')
    const counted = surfaces(state({ ...base, includeManagementInSizing: true }))
    expect(counted.design.status).toBe('does-not-fit')
    expect(section(counted.report, 'findings').reasoning[0].decision).toBe('Do not approve the design until errors are resolved')
    expect(section(counted.report, 'storage').tables.some((table) => /CSV/.test(table.title ?? ''))).toBe(false)
  })

  it('does not report fit against unentered hardware on the new-platform path', () => {
    const { report } = surfaces(state())
    expect(metric(report, 'existing', 'Existing hardware')?.value).toBe('Not assessed')
    expect(metric(report, 'existing', 'Fit decision')).toBeUndefined()
  })
})

describe('management solution only', () => {
  it('sizes no platform and warns when managed hosts are missing', () => {
    const payload = state({ engagementMode: 'management-only', managementDeploymentInputs: { ...management, managedHosts: 0, managementPlacement: 'dedicated-management-cluster' } as ManagementDeploymentInputs })
    const { design, report, project } = surfaces(payload)
    expect(design.status).toBe('not-assessed')
    expect(design.network.nodes).toBeNull()
    expect(project.nodes).toBe('—')
    expect(section(report, 'management').paragraphs.join(' ')).toMatch(/managed hosts are not entered/i)
    // D9: the dedicated management cluster gets a host count from the reference server, with the basis stated.
    expect(design.management.dedicated?.nodes).toBeGreaterThan(0)
    expect(design.management.dedicated?.basis).toMatch(/reference server/i)
    expect(design.management.warnings.join(' ')).toMatch(/managed hosts are 0/i)
    expect(metric(report, 'deployment', 'Dedicated management nodes')?.value).toBe(String(design.management.dedicated?.nodes))
  })

  it('does not claim a topology when no management design is saved', () => {
    const { report } = surfaces(state({ engagementMode: 'management-only', managementDecision: 'unassessed', managementDeploymentInputs: null }))
    expect(section(report, 'executive').paragraphs[0]).not.toContain('documents the management topology')
  })
})

describe('report inputs and exports', () => {
  it('counts excluded records by reason and lists import warnings', () => {
    const vms = [...fleet(3), newVm({ name: 'OFF1', powerState: 'poweredOff', include: false }), newVm({ name: 'ZERO', vCpu: 0, ramGiB: 0, include: false })]
    const report = buildSolutionReport({
      ...state({ vms }),
      lastImport: { fileName: 'synthetic.xlsx', importedVms: 5, totalRows: 9, excludedTemplates: 2, excludedSrmPlaceholders: 1, excludedVcls: 1, poweredOff: 1, suspended: 0, warnings: ['Synthetic warning'] } as never,
    })
    const table = section(report, 'workloads').tables.find((item) => item.title === 'Excluded workload records')!
    expect(table.rows.find((row) => row[0].startsWith('Powered off'))?.[1]).toBe('1')
    expect(table.rows.find((row) => row[0].startsWith('No vCPU'))?.[1]).toBe('1')
    expect(table.rows.find((row) => row[0].startsWith('Templates'))?.[1]).toBe('2')
    expect(table.rows.find((row) => row[0].startsWith('SRM'))?.[1]).toBe('1')
    expect(section(report, 'workloads').bullets).toContain('Import warning: Synthetic warning')
  })

  it('keeps decision notes out of JSON when the executive summary is not selected', () => {
    const report = buildSolutionReport({ ...state(), reportMetadata: { ...DEFAULT_REPORT_METADATA, decisionNotes: 'Synthetic sign-off' } })
    const selection = { ...defaultReportSelection('new-platform'), executive: false }
    expect(reportToJson(report, selection)).not.toContain('Synthetic sign-off')
    expect(reportToJson(report, defaultReportSelection('new-platform'))).toContain('Synthetic sign-off')
  })

  it('transliterates text the PDF font cannot show and still builds the PDF', async () => {
    expect(pdfNeedsTransliteration('Zürich Café')).toBe(false)
    expect(pdfNeedsTransliteration('Łódź')).toBe(true)
    const report = buildSolutionReport({ ...state({ customerName: 'Łódź 東京 Synthetic' }), reportMetadata: { ...DEFAULT_REPORT_METADATA, decisionNotes: 'x '.repeat(4000) } })
    const blob = reportToPdfBlob(report, defaultReportSelection('new-platform'))
    expect(blob.size).toBeGreaterThan(1000)
  })

  it('removes raw control characters from Word text', () => {
    expect(wordSafeText('a\u000bb\nc')).toBe('ab c')
  })
})

describe('sidebar follows the planning path', () => {
  const routes = (mode: Parameters<typeof navGroupsFor>[0]) => navGroupsFor(mode).flatMap((group) => group.items.map((item) => item.to))
  it('hides new-platform pages on existing paths', () => {
    expect(routes('fit-gap')).not.toContain('/results')
    expect(routes('fit-gap')).not.toContain('/configuration')
    expect(routes('existing-capacity')).toContain('/capacity')
    expect(routes('new-platform')).not.toContain('/capacity')
  })
  it('keeps management, implementation and report reachable on management-only', () => {
    const items = routes('management-only')
    expect(items).toEqual(expect.arrayContaining(['/management-plane', '/deployment', '/report', '/project']))
    expect(items).not.toContain('/results')
  })
})
