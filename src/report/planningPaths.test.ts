/**
 * The four planning paths share sizing, placement, and report code. A change for one path must not
 * change another, so these tests walk each path through the shared code.
 */
import { describe, expect, it } from 'vitest'
import { buildSolutionReport, type SolutionReportInputs } from './reportModel'
import { DEFAULT_CONFIG, DEFAULT_PROPOSED_CONFIG, defaultTiers, newVm } from '../state/defaults'
import { normalizeProjectPayload, normalizeProposedConfig } from '../state/project'
import { assessFitGap } from '../engine/fitGap'
import { solveReverse } from '../engine/solve'
import type { EngagementMode } from '../state/journey'

const management = {
  foundation: 'scvmm', wac: 'wac-admin', includeArc: false, monitoring: 'none', highAvailability: false,
  fabricHighAvailability: false, scomHighAvailability: false, scomSqlPlacement: 'dedicated', arcServices: [],
  managedHosts: 8, managedVms: 50, managedClusters: 1, libraryContentGiB: 500, includeIdentityServices: false,
} as NonNullable<SolutionReportInputs['managementDeploymentInputs']>

const fleet = (count: number) => Array.from({ length: count }, (_, i) => newVm({ name: `VM${i}`, vCpu: 4, ramGiB: 32, storageGiB: 200, provisionedGiB: 400 }))

function report(mode: EngagementMode, overrides: Partial<SolutionReportInputs> = {}) {
  return buildSolutionReport({
    engagementMode: mode,
    managementDecision: 'design',
    customerName: 'Contoso',
    cfg: structuredClone(DEFAULT_PROPOSED_CONFIG),
    vms: fleet(50),
    tiers: defaultTiers(),
    chosenKey: 'san',
    managementDeploymentInputs: management,
    includeManagementInSizing: false,
    generatedAt: '2026-11-05T00:00:00.000Z',
    existingCapacityCfg: structuredClone(DEFAULT_CONFIG),
    existingCapacityTiers: defaultTiers(),
    existingCapacityNodes: 8,
    ...overrides,
  })
}

const section = (r: ReturnType<typeof report>, id: string) => r.sections.find((item) => item.id === id)!
const metric = (r: ReturnType<typeof report>, id: string, label: string) => section(r, id).metrics.find((item) => item.label === label)?.value

describe('design a new platform', () => {
  it('reports the SAN to buy from the workload', () => {
    expect(metric(report('new-platform'), 'storage', 'SAN usable capacity to buy')).toBeDefined()
  })

  it('reports the node count needed when the design is over the limit', () => {
    const r = report('new-platform', { vms: fleet(3000) })
    expect(metric(r, 'nodes', 'Total nodes')).toMatch(/needed \(limit 64\)/)
  })

  it('reports a split only after the user selects it', () => {
    const vms = fleet(3000)
    expect(section(report('new-platform', { vms }), 'nodes').metrics.find((m) => m.label === 'Total nodes')?.value).not.toMatch(/across/)
    const split = report('new-platform', { vms, placementInputs: { clusterLayout: 'split', maxNodesPerCluster: 32, targetVmsPerCluster: 8000, preserveSourceClusters: false, separateDatabaseTier: false, maxClusters: 32, sanCapacityScope: 'shared' } })
    expect(metric(split, 'executive', 'Required nodes')).toMatch(/across \d+ clusters/)
  })

  it.each([
    ['all designs by default', undefined, 5],
    ['SAN and S2D', ['san', 's2d-3wm'], 2],
    ['the selected design only', [], 1],
    ['hybrid with the selected SAN design', ['hybrid'], 2],
  ])('shows %s in the report', (_name, architectureKeys, rows) => {
    const r = report('new-platform', { reportMetadata: { author: '', organization: '', revision: '1.0', approvalStatus: 'draft', decisionNotes: '', architectureKeys } })
    const table = section(r, 'architecture').tables.find((item) => item.title === 'Storage design comparison')!
    expect(table.rows).toHaveLength(rows)
    expect(table.rows.some((row) => row[1] === 'Yes')).toBe(true)
  })

  it('records the storage decision answers in the report', () => {
    const r = report('new-platform', { storageDecisionAnswers: { existingArray: true } })
    expect(section(r, 'architecture').tables.some((item) => item.title === 'Storage decision answers')).toBe(true)
    expect(section(r, 'architecture').paragraphs.join(' ')).toContain('lean toward SAN')
  })
})

describe('assess existing capacity', () => {
  it('uses the entered node count and array size', () => {
    const cfg = { ...structuredClone(DEFAULT_CONFIG), san: { ...DEFAULT_CONFIG.san, usableTiB: 1, drr: 1 } }
    const r = report('existing-capacity', { existingCapacityCfg: cfg, existingCapacityNodes: 6 })
    expect(metric(r, 'executive', 'Existing nodes')).toBe('6')
    expect(solveReverse(cfg, 6, fleet(50), defaultTiers()).storageDomains[0].availableTiB).toBe(1)
  })

  it('does not get a calculated SAN from the new-platform defaults', () => {
    expect(DEFAULT_CONFIG.sanSizingMode).toBeUndefined()
    expect(metric(report('existing-capacity'), 'storage', 'SAN usable capacity to buy')).toBeUndefined()
  })

  it('does not offer the storage design comparison', () => {
    expect(section(report('existing-capacity'), 'architecture').tables.some((item) => item.title === 'Storage design comparison')).toBe(false)
  })
})

describe('fit workloads to existing hardware', () => {
  it('still answers whether the workload fits the entered array', () => {
    const cfg = { ...structuredClone(DEFAULT_CONFIG), san: { ...DEFAULT_CONFIG.san, usableTiB: 1, drr: 1 } }
    const fit = assessFitGap(cfg, 8, fleet(50), defaultTiers())
    expect(fit.fits).toBe(false)
    expect(fit.deficits.sanTiB).toBeGreaterThan(0)
  })

  it('still gives the same-spec node requirement', () => {
    const fit = assessFitGap(structuredClone(DEFAULT_CONFIG), 3, fleet(500), defaultTiers())
    expect(fit.requiredNodesAtSameSpec).toBeGreaterThan(3)
    expect(fit.additionalNodes).toBe(fit.requiredNodesAtSameSpec! - 3)
  })

  it('keeps its entered node count in the report', () => {
    expect(metric(report('fit-gap', { existingCapacityNodes: 12 }), 'executive', 'Existing nodes')).toBe('12')
  })

  describe('counts management VMs in the verdict only when they share the hardware', () => {
    // 2 nodes, N+1: one 96-core host left. The workload fits; adding HA SCVMM and SCOM does not.
    const tight = () => {
      const cfg = structuredClone(DEFAULT_CONFIG)
      cfg.architecture = 'san'
      cfg.spareNodes = 1
      cfg.node = { ...cfg.node, sockets: 2, coresPerSocket: 48, ramGiB: 512 }
      return cfg
    }
    const heavy = { ...management, monitoring: 'scom', highAvailability: true, fabricHighAvailability: true, scomHighAvailability: true } as typeof management
    const verdict = (overrides: Partial<SolutionReportInputs>) => {
      const r = report('fit-gap', { existingCapacityCfg: tight(), existingCapacityNodes: 2, vms: fleet(12), managementDeploymentInputs: heavy, ...overrides })
      return { fit: metric(r, 'existing', 'Fit decision'), counted: metric(r, 'existing', 'Management VMs counted') }
    }

    it('counts them for design, included in sizing, on the workload cluster', () => {
      const result = verdict({ includeManagementInSizing: true })
      expect(Number(result.counted)).toBeGreaterThan(0)
      expect(result.fit).toBe('Does not fit')
    })

    it('does not count them when excluded, deferred, or placed elsewhere', () => {
      for (const overrides of [
        { includeManagementInSizing: false },
        { includeManagementInSizing: true, managementDecision: 'deferred' as const },
        { includeManagementInSizing: true, managementDeploymentInputs: { ...heavy, managementPlacement: 'dedicated-management-cluster' as const } },
      ]) {
        const result = verdict(overrides)
        expect(result.counted).toBe('0')
        expect(result.fit).toBe('Fits')
      }
    })
  })

  it('states the compute answer in the report when the array blocks', () => {
    const cfg = structuredClone(DEFAULT_CONFIG)
    cfg.architecture = 'san'
    cfg.san = { ...cfg.san, usableTiB: 1, drr: 1 }
    const r = report('fit-gap', { existingCapacityCfg: cfg, existingCapacityNodes: 2, vms: fleet(50) })
    expect(metric(r, 'existing', 'Fit decision')).toBe('Does not fit')
    expect(metric(r, 'existing', 'Same-spec nodes required')).toMatch(/for compute/)
  })

  it('asks for workloads rather than reporting a shortfall', () => {
    const r = report('fit-gap', { vms: [] })
    expect(metric(r, 'existing', 'Same-spec nodes required')).toBe('Add workloads')
    expect(metric(r, 'existing', 'Additional nodes')).toBe('Add workloads')
  })
})

describe('management solution only', () => {
  it('builds a report with no workloads and no platform sizing', () => {
    const r = report('management-only', { vms: [] })
    expect(metric(r, 'executive', 'Platform sizing')).toBe('Not requested')
    expect(section(r, 'management').tables.length).toBeGreaterThan(0)
  })

  it('ignores workloads and the cluster layout', () => {
    const r = report('management-only', { placementInputs: { clusterLayout: 'split', maxNodesPerCluster: 4, targetVmsPerCluster: 8000, preserveSourceClusters: false, separateDatabaseTier: false, maxClusters: 32, sanCapacityScope: 'shared' } })
    expect(metric(r, 'deployment', 'Platform placement')).toBe('Not assessed')
  })
})

describe('saved projects', () => {
  it('keeps a customised array from an older save as a hard limit', () => {
    expect(normalizeProposedConfig({ san: { usableTiB: 100, drr: 2 } }).sanSizingMode).toBe('fixed')
  })

  it('moves the untouched 500 TiB default to calculated', () => {
    expect(normalizeProposedConfig({ san: { usableTiB: 500, drr: 2.5 } }).sanSizingMode).toBe('calculated')
    expect(normalizeProposedConfig(undefined).sanSizingMode).toBe('calculated')
  })

  it('opens an older project with no new fields and leaves existing hardware alone', () => {
    const payload = normalizeProjectPayload({ cfg: {}, tiers: {}, vms: [], existingCapacityCfg: { san: { usableTiB: 500, drr: 2.5 } } })
    expect(payload.placementInputs.clusterLayout).toBe('single')
    expect(payload.storageDecisionAnswers).toEqual({})
    expect(payload.existingCapacityCfg.sanSizingMode).toBeUndefined()
  })
})
