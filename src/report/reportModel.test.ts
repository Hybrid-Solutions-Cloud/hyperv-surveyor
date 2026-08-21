import { describe, expect, it } from 'vitest'
import { reportToHtml, reportToJson, reportToMarkdown, reportToPdfBlob, reportToWordBlob } from './exportReport'
import { buildSolutionReport, defaultReportSelection } from './reportModel'
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

function sampleReport(chosenKey = 'san') {
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
  })
}

describe('solution report', () => {
  it('includes sizing, workload, and selected management-plane components', () => {
    const report = sampleReport()
    const managementSection = report.sections.find((section) => section.id === 'management')!
    const componentRows = managementSection.tables[0].rows

    expect(report.customerName).toBe('Contoso')
    expect(report.sections).toHaveLength(10)
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

  it('creates real Word and PDF file payloads', async () => {
    const report = sampleReport()
    const selection = Object.fromEntries(Object.keys(defaultReportSelection()).map((id) => [id, id === 'executive'])) as ReturnType<typeof defaultReportSelection>
    const word = await reportToWordBlob(report, selection)
    const pdf = reportToPdfBlob(report, selection)
    const wordSignature = new Uint8Array(await word.slice(0, 2).arrayBuffer())
    const pdfSignature = new TextDecoder().decode(await pdf.slice(0, 4).arrayBuffer())

    expect([...wordSignature]).toEqual([0x50, 0x4b])
    expect(pdfSignature).toBe('%PDF')
    expect(word.size).toBeGreaterThan(5_000)
    expect(pdf.size).toBeGreaterThan(1_000)
  })
})
