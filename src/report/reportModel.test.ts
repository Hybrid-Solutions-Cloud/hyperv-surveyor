import { describe, expect, it } from 'vitest'
import { reportToJson, reportToMarkdown, reportToPdfBlob, reportToWordBlob } from './exportReport'
import { buildSolutionReport, defaultReportSelection } from './reportModel'
import { DEFAULT_CONFIG, defaultTiers, newVm } from '../state/defaults'
import type { ManagementDeploymentInputs } from '../engine/managementDeployment'

const management: ManagementDeploymentInputs = {
  foundation: 'scvmm',
  wac: 'wac-admin',
  includeArc: true,
  monitoring: 'scom',
  highAvailability: true,
  managedHosts: 8,
  managedVms: 2,
  managedClusters: 1,
  libraryContentGiB: 500,
  includeIdentityServices: false,
}

function sampleReport() {
  return buildSolutionReport({
    customerName: 'Contoso',
    cfg: structuredClone(DEFAULT_CONFIG),
    vms: [
      newVm({ name: 'APP01', vCpu: 4, ramGiB: 16, storageGiB: 200, provisionedGiB: 400 }),
      newVm({ name: 'SQL01', tier: 'database', vCpu: 8, ramGiB: 64, storageGiB: 500, provisionedGiB: 800 }),
    ],
    tiers: defaultTiers(),
    chosenKey: 'san',
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
