import { describe, expect, it } from 'vitest'
import { resolvePlatformDesign } from '../platformDesign'
import { platformDesignInputs } from '../../state/usePlatformDesign'
import { DEFAULT_CONFIG, DEFAULT_PROPOSED_CONFIG, defaultTiers } from '../../state/defaults'
import { DEFAULT_PLACEMENT_INPUTS } from '../deploymentPlanning'
import { bomSheet, designWorkbookSheets } from '../../io/exportXlsx'
import { buildSolutionReport } from '../../report/reportModel'
import { vm } from './fixtures'
import type { ClusterConfig, Vm } from '../types'

const fleet = (count: number, patch: Partial<Vm> = {}) => Array.from({ length: count }, (_, i) => vm({ name: `APP${i}`, ...patch }))

function design(chosenKey: string, vms: Vm[], cfg: Partial<ClusterConfig> = {}) {
  return resolvePlatformDesign(platformDesignInputs({
    engagementMode: 'new-platform',
    cfg: { ...structuredClone(DEFAULT_PROPOSED_CONFIG), ...cfg },
    tiers: defaultTiers(),
    vms,
    chosenKey,
    existingCapacityCfg: structuredClone(DEFAULT_CONFIG),
    existingCapacityTiers: defaultTiers(),
    existingCapacityNodes: 8,
    placementInputs: structuredClone(DEFAULT_PLACEMENT_INPUTS),
    managementDecision: 'unassessed',
    managementDeploymentInputs: null,
    includeManagementInSizing: true,
  }))
}

const line = (d: ReturnType<typeof design>, item: RegExp) => d.bom.lines.find((entry) => item.test(entry.item))

describe('what to buy (C1)', () => {
  it('lists servers, per-node drives, RDMA network, switch ports and licensing for S2D', () => {
    const d = design('s2d-3wm', fleet(300))
    expect(d.feasible).toBe(true)
    expect(d.bom.available).toBe(true)
    expect(line(d, /host servers/)!.quantity).toBe(String(d.totalNodes))
    expect(line(d, /Capacity drives/)!.quantity).toMatch(new RegExp(`^${d.cfg.node.capacityDrivesPerNode} per server`))
    const storageNic = line(d, /Storage network adapters/)!
    if ((d.totalNodes ?? 0) >= 4) expect(storageNic.item).toMatch(/25 GbE or faster, RDMA/)
    expect(storageNic.basis).toBe('MS-REC')
    expect(storageNic.source).toMatch(/storage-spaces-direct-hardware-requirements/)
    expect(line(d, /switch ports/)!.quantity).toContain(`${(d.totalNodes ?? 0) * 4} × 25 GbE`)
    expect(line(d, /Datacenter core licenses/)!.quantity).toBe(`${(d.licensableCores ?? 0).toLocaleString('en-US')} cores`)
    expect(d.bom.sanConnectivity.required).toBe(false)
  })

  it('lists no local drives for SAN, and the SAN usable to buy with its assumptions', () => {
    const d = design('san', fleet(300))
    expect(d.bom.available).toBe(true)
    expect(line(d, /Capacity drives|Cache drives/)).toBeUndefined()
    const san = line(d, /usable capacity to buy/)!
    expect(san.quantity).toContain((d.storage!.sanToBuyUsableTiB!).toLocaleString('en-US', { maximumFractionDigits: 1 }))
    expect(san.detail).toMatch(/free/)
    expect(san.detail).toMatch(/2\.5:1 data reduction/)
    expect(d.bom.sanConnectivity.required).toBe(true)
    // Phase 8: SAN connectivity comes from the Implementation plan (default Fibre Channel, two HBAs per host).
    expect(d.bom.sanConnectivity.status).toBe('planned')
    expect(line(d, /Fibre Channel HBAs/)!.quantity).toMatch(new RegExp(`^2 per server, ${(d.totalNodes ?? 0) * 2} in total`))
  })

  it('gives no bill of materials for a design that does not fit, or another path', () => {
    const over = design('s2d-3wm', fleet(4000, { ramGiB: 128 }))
    expect(over.feasible).toBe(false)
    expect(over.bom.available).toBe(false)
    expect(over.bom.reason).toMatch(/does not fit one cluster/)
    const existing = resolvePlatformDesign({ ...platformDesignInputs({
      engagementMode: 'fit-gap', cfg: structuredClone(DEFAULT_PROPOSED_CONFIG), tiers: defaultTiers(), vms: fleet(10), chosenKey: 'san',
      existingCapacityCfg: structuredClone(DEFAULT_CONFIG), existingCapacityTiers: defaultTiers(), existingCapacityNodes: 8,
      placementInputs: structuredClone(DEFAULT_PLACEMENT_INPUTS), managementDecision: 'unassessed', managementDeploymentInputs: null, includeManagementInSizing: true,
    }) })
    expect(existing.bom.available).toBe(false)
  })

  it('is in the report and the workbook with the same quantities', () => {
    const vms = fleet(300)
    const d = design('s2d-3wm', vms)
    const report = buildSolutionReport({ engagementMode: 'new-platform', customerName: 'Example', cfg: structuredClone(DEFAULT_PROPOSED_CONFIG), vms, tiers: defaultTiers(), chosenKey: 's2d-3wm', managementDeploymentInputs: null, includeManagementInSizing: true })
    const section = report.sections.find((item) => item.id === 'bill-of-materials')!
    expect(section.tables[0].rows.map((row) => row[2])).toEqual(d.bom.lines.map((entry) => entry.quantity))
    const sheet = designWorkbookSheets(d, vms).find((item) => item.name === 'What to Buy')!
    expect(sheet).toEqual(bomSheet(d))
    expect(sheet.rows.some((row) => (row as unknown[])[2] === line(d, /host servers/)!.quantity)).toBe(true)
  })
})
