import { describe, expect, it } from 'vitest'
import {
  buildOptionsMatrix,
  catalogDriveLayouts,
  compareOptions,
  DRIVE_CATALOG,
  isSelectedOption,
  optionSelection,
  rankShortlist,
  type MatrixOption,
} from '../optionsMatrix'
import { ARCHITECTURE_VARIANTS, REFERENCE_SERVER_PROFILES, solveForward } from '../solve'
import { assessStorageDecision } from '../storageDecision'
import { overLimitAdvice } from '../advice'
import { LIMITS } from '../rules'
import { DEFAULT_PROPOSED_CONFIG, defaultTiers } from '../../state/defaults'
import { makeConfig, makeTiers, vm } from './fixtures'
import type { ClusterConfig, Vm } from '../types'

const tiers = defaultTiers()
const fleet = (count: number, patch: Partial<Vm> = {}) => Array.from({ length: count }, (_, i) => vm({ name: `APP${i}`, vCpu: 4, ramGiB: 16, storageGiB: 300, ...patch }))
const proposed = (patch: Partial<ClusterConfig> = {}): ClusterConfig => ({ ...structuredClone(DEFAULT_PROPOSED_CONFIG), ...patch })

describe('options matrix enumeration', () => {
  const matrix = buildOptionsMatrix({ cfg: proposed(), vms: fleet(300), tiers })

  it('declares a bounded all-flash NVMe catalog under 400 TB per server', () => {
    expect(DRIVE_CATALOG.sizesTB).toEqual([3.84, 7.68, 15.36])
    expect(Math.min(...DRIVE_CATALOG.drivesPerNode)).toBe(4)
    expect(Math.max(...DRIVE_CATALOG.drivesPerNode)).toBe(24)
    const layouts = catalogDriveLayouts()
    expect(layouts).toHaveLength(DRIVE_CATALOG.sizesTB.length * DRIVE_CATALOG.drivesPerNode.length)
    expect(layouts.every((layout) => layout.rawPerServerTB <= LIMITS.S2D_MAX_RAW_PER_SERVER_TB)).toBe(true)
    expect(layouts.every((layout) => layout.cacheDrivesPerNode === 0 && layout.media === 'all-flash')).toBe(true)
  })

  it('sizes every storage option on every server, and every drive layout for S2D', () => {
    // The default reference server (2 x 48, 1536 GiB) is one of the four sizes, and its 8 x 7.68 TB
    // drives are in the catalog, but its 3.2 TB cache tier makes it a separate own layout.
    const servers = REFERENCE_SERVER_PROFILES.length
    const layouts = catalogDriveLayouts().length + 1
    const storageVariants = ARCHITECTURE_VARIANTS.length - 1
    expect(matrix.servers).toHaveLength(servers)
    expect(matrix.driveLayouts).toHaveLength(layouts)
    expect(matrix.rows).toHaveLength(servers + storageVariants * servers * layouts)
    expect(new Set(matrix.rows.map((row) => row.id)).size).toBe(matrix.rows.length)
    expect(matrix.rows.filter((row) => row.family === 'san').every((row) => row.drives === null)).toBe(true)
  })

  it('adds your own server when it is not one of the reference sizes', () => {
    const own = buildOptionsMatrix({ cfg: proposed({ node: { ...DEFAULT_PROPOSED_CONFIG.node, sockets: 1, coresPerSocket: 24, ramGiB: 768 } }), vms: fleet(50), tiers })
    expect(own.servers.map((server) => server.key)).toContain('own')
    expect(own.servers).toHaveLength(REFERENCE_SERVER_PROFILES.length + 1)
  })

  it('agrees with solveForward for the same configuration', () => {
    const row = matrix.rows.find((item) => item.storageKey === 's2d-3wm' && item.server.key === 'medium' && item.drives?.key === '8x7.68')!
    const direct = solveForward(row.cfg, fleet(300), tiers)
    expect(row.result.feasible).toBe(direct.feasible)
    expect(row.result.nodes).toBe(direct.nodes)
  })

  it('covers two-way mirror and nested resiliency (C16) as two-node designs', () => {
    const small = buildOptionsMatrix({ cfg: proposed({ spareNodes: 1 }), vms: fleet(10), tiers })
    const keys = new Set(small.rows.map((row) => row.storageKey))
    expect(keys).toEqual(new Set(ARCHITECTURE_VARIANTS.map((variant) => variant.key)))
    const viableTwoNode = small.viable.filter((row) => ['s2d-2wm', 's2d-nested-2wm', 's2d-nested-map'].includes(row.storageKey))
    expect(viableTwoNode.length).toBeGreaterThan(0)
    expect(viableTwoNode.every((row) => row.nodes === 2)).toBe(true)
  })
})

describe('rejection reasons', () => {
  it('gives every ruled-out option a reason, and viable ones none', () => {
    const matrix = buildOptionsMatrix({ cfg: proposed(), vms: fleet(2000, { ramGiB: 64 }), tiers })
    for (const row of matrix.rows) {
      if (row.rejected) expect(row.rejectionReasons.join(' ').length).toBeGreaterThan(10)
      else expect(row.rejectionReasons).toEqual([])
    }
  })

  it('rules two-way mirror out above two nodes, citing Microsoft guidance', () => {
    const matrix = buildOptionsMatrix({ cfg: proposed(), vms: fleet(300), tiers })
    const twoWay = matrix.rows.filter((row) => row.storageKey === 's2d-2wm')
    expect(twoWay.every((row) => row.rejected)).toBe(true)
    expect(twoWay.some((row) => /Microsoft recommends three-way mirror/.test(row.rejectionReasons.join(' ')))).toBe(true)
  })

  it('rules out S2D and hybrid when you will not run Datacenter edition, and S2D when you must use an array', () => {
    const standard = buildOptionsMatrix({ cfg: proposed(), vms: fleet(100), tiers, answers: { datacenter: false } })
    expect(standard.rows.filter((row) => row.family !== 'san').every((row) => row.rejected && /Ruled out by your answers/.test(row.rejectionReasons.join(' ')))).toBe(true)
    const array = buildOptionsMatrix({ cfg: proposed(), vms: fleet(100), tiers, answers: { mustUseArray: true } })
    expect(array.rows.filter((row) => row.family === 's2d').every((row) => row.rejected)).toBe(true)
    expect(array.viable.some((row) => row.family === 'san')).toBe(true)
    expect(assessStorageDecision({ mustUseArray: true }).excluded).toEqual(['s2d'])
  })

  it('C14: drive-input problems show on the S2D rows that use them, not on SAN rows', () => {
    const cfg = proposed({ node: { ...DEFAULT_PROPOSED_CONFIG.node, capacityDrivesPerNode: 0 } })
    const matrix = buildOptionsMatrix({ cfg, vms: fleet(100), tiers })
    const own = matrix.rows.filter((row) => row.drives?.own)
    expect(own.length).toBeGreaterThan(0)
    expect(own.every((row) => row.problems.some((problem) => /capacity drive/.test(problem)))).toBe(true)
    expect(matrix.rows.filter((row) => row.family === 'san').every((row) => row.problems.length === 0)).toBe(true)
    expect(matrix.rows.filter((row) => row.drives && !row.drives.own).every((row) => row.problems.length === 0)).toBe(true)
  })

  it('C6: storage-bound over-limit advice never suggests a larger server', () => {
    const cfg = makeConfig({ architecture: 's2d', spareNodes: 1, node: { capacityDrivesPerNode: 4, capacityDriveTB: 1.92, cacheDrivesPerNode: 0, cacheDriveTB: 0 } })
    const storageHeavy = Array.from({ length: 50 }, () => vm({ vCpu: 2, ramGiB: 8, storageGiB: 20_000 }))
    const r = solveForward(cfg, storageHeavy, makeTiers())
    expect(r.feasible).toBe(false)
    const advice = overLimitAdvice(r, cfg)
    expect(advice).toMatch(/capacity drives|larger drives/)
    expect(advice).not.toMatch(/use a larger server/)
    const cpuHeavy = Array.from({ length: 900 }, () => vm({ tier: 'database', vCpu: 16, ramGiB: 8, storageGiB: 10 }))
    const cpu = solveForward(makeConfig({ architecture: 'san', spareNodes: 1 }), cpuHeavy, makeTiers())
    expect(cpu.feasible).toBe(false)
    expect(overLimitAdvice(cpu, makeConfig({ architecture: 'san' }))).toMatch(/larger server/)
  })
})

describe('shortlist ranking', () => {
  const base = (patch: Partial<MatrixOption>): MatrixOption => ({
    id: Math.random().toString(36), storageKey: 'san', storageLabel: 'SAN', family: 'san',
    server: { key: 'medium', label: 'Medium', sockets: 2, coresPerSocket: 32, ramGiB: 1024, own: false },
    drives: null, cfg: proposed(), result: solveForward(proposed(), fleet(10), tiers),
    fitsOneCluster: true, nodes: 4, workloadNodes: 2, binding: 'cpu', s2dUsableTiB: null, sanToBuyUsableTiB: null,
    licensableCores: 256, headroomPct: 20, rejected: false, rejectionReasons: [], problems: [], splitCandidate: false,
    ...patch,
  })

  it('orders by fits one cluster, then licensable cores, then nodes, then headroom', () => {
    const a = base({ fitsOneCluster: false, licensableCores: 10 })
    const b = base({ licensableCores: 300 })
    const c = base({ licensableCores: 256, nodes: 5 })
    const d = base({ licensableCores: 256, nodes: 4, headroomPct: 10 })
    const e = base({ licensableCores: 256, nodes: 4, headroomPct: 30 })
    const sorted = [a, b, c, d, e].sort(compareOptions)
    expect(sorted).toEqual([e, d, c, b, a])
  })

  it('keeps one entry per storage option, at most three, best first', () => {
    const matrix = buildOptionsMatrix({ cfg: proposed(), vms: fleet(300), tiers })
    expect(matrix.shortlist.length).toBeGreaterThan(0)
    expect(matrix.shortlist.length).toBeLessThanOrEqual(3)
    expect(new Set(matrix.shortlist.map((entry) => entry.option.storageKey)).size).toBe(matrix.shortlist.length)
    for (let i = 1; i < matrix.shortlist.length; i++) {
      expect(compareOptions(matrix.shortlist[i - 1].option, matrix.shortlist[i].option)).toBeLessThanOrEqual(0)
    }
    expect(matrix.shortlist.every((entry) => !entry.option.rejected && entry.rationale.length >= 3 && entry.tradeoffs.length >= 1)).toBe(true)
  })

  it('lets the guide answers move an option up, with a visible note', () => {
    const viable = [
      base({ storageKey: 's2d-3wm', family: 's2d', licensableCores: 100 }),
      base({ storageKey: 'hybrid', family: 'hybrid', licensableCores: 150 }),
      base({ storageKey: 'san', family: 'san', licensableCores: 200 }),
    ]
    const neutral = rankShortlist(viable, assessStorageDecision({}))
    expect(neutral[0].option.family).toBe('s2d')
    expect(neutral.every((entry) => entry.guideNote === null)).toBe(true)
    const leaning = rankShortlist(viable, assessStorageDecision({ independentScale: true, storageTeam: true }))
    expect(leaning[0].option.family).toBe('san')
    expect(leaning[0].guideNote).toMatch(/lean toward SAN.*ranks 3 of 3/)
  })
})

describe('selection is a click and never splits on its own', () => {
  it('refuses a ruled-out option (C15) and applies storage, server and drives for a viable one', () => {
    const cfg = proposed()
    const matrix = buildOptionsMatrix({ cfg, vms: fleet(300), tiers })
    const rejected = matrix.rows.find((row) => row.rejected)!
    expect(optionSelection(rejected, cfg)).toBeNull()
    const pick = matrix.viable.find((row) => row.family === 's2d' && row.drives && !row.drives.own)!
    const selection = optionSelection(pick, cfg)!
    expect(selection.chosenKey).toBe(pick.storageKey)
    expect(selection.cfg.node.sockets).toBe(pick.server.sockets)
    expect(selection.cfg.node.capacityDrivesPerNode).toBe(pick.drives!.drivesPerNode)
    expect(selection.cfg.node.cacheDrivesPerNode).toBe(0)
    expect(isSelectedOption(pick, selection.cfg, selection.chosenKey)).toBe(true)
  })

  it('offers over-limit options only in the split view, and only a split choice can apply them', () => {
    const matrix = buildOptionsMatrix({ cfg: proposed(), vms: fleet(3000, { ramGiB: 64 }), tiers })
    expect(matrix.splitCandidates.length).toBeGreaterThan(0)
    const candidate = matrix.splitCandidates[0]
    expect(candidate.rejected).toBe(true)
    expect(candidate.fitsOneCluster).toBe(false)
    expect(optionSelection(candidate, proposed())).toBeNull()
    expect(optionSelection(candidate, proposed(), 'split')).not.toBeNull()
    expect(matrix.shortlist.every((entry) => entry.option.fitsOneCluster)).toBe(true)
  })
})

describe('matrix performance', () => {
  it('builds the matrix for 5,000 VMs in well under a second', () => {
    const vms = Array.from({ length: 5000 }, (_, i) => vm({
      name: `VM${i}`,
      tier: i % 10 === 0 ? 'database' : 'general',
      vCpu: [2, 4, 8, 16][i % 4],
      ramGiB: [8, 16, 32, 64][i % 4],
      storageGiB: 100 + (i % 17) * 50,
      firmware: i % 3 === 0 ? 'bios' : 'efi',
    }))
    buildOptionsMatrix({ cfg: proposed(), vms: vms.slice(0, 50), tiers })
    const started = performance.now()
    const matrix = buildOptionsMatrix({ cfg: proposed(), vms, tiers })
    const elapsed = performance.now() - started
    console.info(`options matrix: ${matrix.rows.length} combinations for 5,000 VMs in ${elapsed.toFixed(0)} ms`)
    expect(matrix.rows.length).toBeGreaterThan(600)
    expect(elapsed).toBeLessThan(1000)
  })
})
