import { describe, expect, it } from 'vitest'
import { reportToHtml, reportToJson, reportToMarkdown, reportToPdfBlob, reportToWordBlob } from './exportReport'
import { buildSolutionReport, defaultReportSelection, type SolutionReportInputs } from './reportModel'
import { DEFAULT_CONFIG, defaultTiers, newVm } from '../state/defaults'
import type { ManagementDeploymentInputs } from '../engine/managementDeployment'

const management: ManagementDeploymentInputs = {
  foundation: 'scvmm',
  wac: 'wac-admin',
  includeArc: true,
  monitoring: 'scom',
  highAvailability: true,
  fabricHighAvailability: true,
  scomHighAvailability: true,
  scomSqlPlacement: 'shared-vmm',
  arcServices: ['update-manager', 'azure-monitor'],
  managedHosts: 8,
  managedVms: 2,
  managedClusters: 1,
  libraryContentGiB: 500,
  includeIdentityServices: false,
}

function sampleReport(chosenKey = 'san', overrides: Partial<SolutionReportInputs> = {}) {
  const cfg = structuredClone(DEFAULT_CONFIG)
  cfg.annualGrowthPct = 0.1
  cfg.growthHorizonYears = 3
  cfg.growthStrategy = 'phased'
  return buildSolutionReport({
    customerName: 'Contoso',
    cfg,
    vms: [
      newVm({ name: 'APP01', vCpu: 4, ramGiB: 16, storageGiB: 200, provisionedGiB: 400 }),
      newVm({ name: 'SQL01', tier: 'database', vCpu: 8, ramGiB: 64, storageGiB: 500, provisionedGiB: 800 }),
    ],
    tiers: defaultTiers(),
    chosenKey,
    managementDeploymentInputs: management,
    includeManagementInSizing: true,
    generatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  })
}

describe('solution report', () => {
  it('includes sizing, workload, and selected management-plane components', () => {
    const report = sampleReport()
    const managementSection = report.sections.find((section) => section.id === 'management')!
    const componentRows = managementSection.tables[0].rows

    expect(report.customerName).toBe('Contoso')
    expect(report.sections).toHaveLength(16)
    expect(componentRows.some((row) => row[0] === 'SCOM management server')).toBe(true)
    expect(componentRows.some((row) => row[0] === 'Azure Arc resource bridge appliance')).toBe(true)
    expect(componentRows.some((row) => row[0] === 'Shared SQL Server for VMM and SCOM databases')).toBe(true)
    expect(componentRows.some((row) => row[0] === 'SQL Server for SCOM databases')).toBe(false)
    expect(managementSection.paragraphs[0]).toContain('SCOM 2025 HA on shared VMM SQL infrastructure')
    expect(managementSection.tables[1].title).toBe('Selected Azure Arc services')
    expect(managementSection.tables[1].rows.map((row) => row[0])).toEqual([
      'Azure Arc core management',
      'Azure Update Manager',
      'Azure Monitor and Log Analytics',
    ])
  })

  it('applies section choices to Markdown and JSON exports', () => {
    const report = sampleReport()
    const selection = Object.fromEntries(Object.keys(defaultReportSelection()).map((id) => [id, id === 'executive' || id === 'management'])) as ReturnType<typeof defaultReportSelection>
    const markdown = reportToMarkdown(report, selection)
    const json = JSON.parse(reportToJson(report, selection))

    expect(markdown).toContain('## Executive summary')
    expect(markdown).toContain('## Management plane')
    expect(markdown).not.toContain('## VM inventory')
    expect(json.sections.map((section: { id: string }) => section.id)).toEqual(['executive', 'management'])
  })

  it('optionally includes structured decision reasoning in every export model', () => {
    const report = sampleReport()
    const selection = Object.fromEntries(Object.keys(defaultReportSelection()).map((id) => [id, id === 'architecture' || id === 'management'])) as ReturnType<typeof defaultReportSelection>
    const conciseMarkdown = reportToMarkdown(report, selection)
    const detailedMarkdown = reportToMarkdown(report, selection, { includeDecisionReasoning: true })
    const conciseJson = JSON.parse(reportToJson(report, selection))
    const detailedJson = JSON.parse(reportToJson(report, selection, { includeDecisionReasoning: true }))
    const detailedHtml = reportToHtml(report, selection, { includeDecisionReasoning: true })

    expect(report.schemaVersion).toBe(3)
    expect(report.sections.find((section) => section.id === 'architecture')?.reasoning.length).toBeGreaterThan(0)
    expect(report.sections.find((section) => section.id === 'management')?.reasoning.map((item) => item.decision)).toEqual(expect.arrayContaining([
      'Use SCVMM 2025 as the fabric foundation',
      'Add Azure Arc-enabled SCVMM',
      'Add SCOM 2025 with high availability',
    ]))
    expect(conciseMarkdown).not.toContain('Decision reasoning and explanations')
    expect(detailedMarkdown).toContain('### Decision reasoning and explanations')
    expect(detailedMarkdown).toContain('**Basis:** User-selected')
    expect(conciseJson.outputOptions.includeDecisionReasoning).toBe(false)
    expect(conciseJson.sections.every((section: { reasoning: unknown[] }) => section.reasoning.length === 0)).toBe(true)
    expect(detailedJson.outputOptions.includeDecisionReasoning).toBe(true)
    expect(detailedJson.sections.every((section: { reasoning: unknown[] }) => section.reasoning.length > 0)).toBe(true)
    expect(detailedHtml).toContain('<div class="reasoning">')
    expect(detailedHtml).toContain('Tradeoff / validation:')
  })

  it('places VM inventory immediately above sources and methodology', () => {
    const report = sampleReport()
    const sectionIds = report.sections.map((section) => section.id)

    expect(sectionIds.slice(-2)).toEqual(['inventory', 'sources'])
  })

  it('includes a compounded node growth timeline in the solution report', () => {
    const report = sampleReport()
    const nodes = report.sections.find((section) => section.id === 'nodes')!
    const timeline = nodes.tables.find((table) => table.title === 'Node growth timeline')!

    expect(timeline.rows.map((row) => row[0])).toEqual(['Today', 'Year 1', 'Year 2', 'Year 3'])
    expect(timeline.rows.map((row) => row[1])).toEqual(['1x', '1.1x', '1.21x', '1.33x'])
    expect(nodes.metrics.find((metric) => metric.label === 'Growth strategy')?.value).toBe('Phase nodes with growth')
  })

  it('shows storage protection that matches SAN, S2D, and hybrid architecture semantics', () => {
    const metricFor = (chosenKey: string) => sampleReport(chosenKey)
      .sections.find((section) => section.id === 'architecture')!
      .metrics.find((metric) => metric.label === 'Storage protection' || metric.label === 'S2D resiliency')!

    const san = metricFor('san')
    expect(san.label).toBe('Storage protection')
    expect(san.value).toBe('External SAN (array-managed; not modeled)')
    expect(san.detail).toContain('S2D resiliency does not apply')
    expect(san.value).not.toContain('mirror')

    const s2d = metricFor('s2d-3wm')
    expect(s2d.label).toBe('S2D resiliency')
    expect(s2d.value).toBe('Three-way mirror')

    const hybrid = metricFor('hybrid')
    expect(hybrid.label).toBe('Storage protection')
    expect(hybrid.value).toBe('S2D: Three-way mirror; SAN: array-managed')
  })

  it('uses SAN protection wording in the interactive HTML architecture section', () => {
    const selection = Object.fromEntries(Object.keys(defaultReportSelection()).map((id) => [id, id === 'architecture'])) as ReturnType<typeof defaultReportSelection>
    const html = reportToHtml(sampleReport('san'), selection)

    expect(html).toContain('<span>Storage protection</span>')
    expect(html).toContain('External SAN (array-managed; not modeled)')
    expect(html).not.toContain('<span>Resiliency</span>')
  })

  it('creates a self-contained interactive HTML report from selected sections', () => {
    const report = sampleReport()
    const selection = Object.fromEntries(Object.keys(defaultReportSelection()).map((id) => [id, id === 'executive' || id === 'management'])) as ReturnType<typeof defaultReportSelection>
    const html = reportToHtml(report, selection)

    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<style>')
    expect(html).toContain('Print / Save as PDF')
    expect(html).toContain('Executive summary')
    expect(html).toContain('Management plane')
    expect(html).not.toContain('VM inventory')
  })

  it('describes host memory reserve as a greater-of calculation', () => {
    const assumptions = sampleReport().sections.find((section) => section.id === 'assumptions')!
    const memoryReserve = assumptions.metrics.find((metric) => metric.label === 'Host RAM reserve')!

    expect(memoryReserve.value).toContain('Greater of')
    expect(memoryReserve.detail).toContain('not added together')
  })

  it('uses a focused default report for management-only engagements', () => {
    const selection = defaultReportSelection('management-only')
    expect(Object.entries(selection).filter(([, included]) => included).map(([id]) => id)).toEqual(['executive', 'management', 'sources'])
  })

  it('does not invent platform sizing in a management-only report', () => {
    const report = sampleReport('san', { engagementMode: 'management-only', managementDecision: 'design' })
    const nodes = report.sections.find((section) => section.id === 'nodes')!
    const deployment = report.sections.find((section) => section.id === 'deployment')!
    const network = report.sections.find((section) => section.id === 'network')!

    expect(report.selectedArchitecture).toBe('Management-only scope')
    expect(nodes.metrics).toEqual([{ label: 'Platform node sizing', value: 'Not assessed' }])
    expect(deployment.metrics.find((metric) => metric.label === 'Platform placement')?.value).toBe('Not assessed')
    expect(network.metrics).toEqual([{ label: 'Host network design', value: 'Not assessed' }])
  })

  it('creates real Word and PDF file payloads', async () => {
    const report = sampleReport()
    const selection = Object.fromEntries(Object.keys(defaultReportSelection()).map((id) => [id, id === 'executive'])) as ReturnType<typeof defaultReportSelection>
    const word = await reportToWordBlob(report, selection)
    const pdf = reportToPdfBlob(report, selection)
    const detailedWord = await reportToWordBlob(report, selection, { includeDecisionReasoning: true })
    const detailedPdf = reportToPdfBlob(report, selection, { includeDecisionReasoning: true })
    const wordSignature = new Uint8Array(await word.slice(0, 2).arrayBuffer())
    const pdfSignature = new TextDecoder().decode(await pdf.slice(0, 4).arrayBuffer())

    expect([...wordSignature]).toEqual([0x50, 0x4b])
    expect(pdfSignature).toBe('%PDF')
    expect(word.size).toBeGreaterThan(5_000)
    expect(pdf.size).toBeGreaterThan(1_000)
    expect(detailedWord.size).toBeGreaterThan(word.size)
    expect(detailedPdf.size).toBeGreaterThan(pdf.size)
  })
})
