/**
 * Phase 6: existing capacity and fit workloads on hardware you own. Synthetic data only.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  assessExistingHardware, blankCluster, blankExistingHardware, computeCapacityOf, cpuVendorFromCpuModel,
  existingHardwareFromImport, normalizeExistingHardware, type ExistingCluster, type ExistingHardware, type ImportedHost,
} from '../existingHardware'
import { resolvePlatformDesign } from '../platformDesign'
import { usableCoresPerHost } from '../compute'
import { DEFAULT_CONFIG, DEFAULT_PROPOSED_CONFIG, defaultTiers, newVm } from '../../state/defaults'
import { buildSolutionReport } from '../../report/reportModel'
import { existingWorkbookSheets } from '../../io/exportXlsx'
import { compareScenario } from '../../state/scenarioComparison'
import { platformDesignInputs } from '../../state/usePlatformDesign'
import { DEFAULT_REPORT_METADATA, normalizeProjectPayload, parseProject, type ProjectPayload } from '../../state/project'
import { migratePersistedState, useSurveyorStore } from '../../state/store'
import { readSharedLink, toUrl } from '../../state/urlState'
import { DEFAULT_PLACEMENT_INPUTS } from '../deploymentPlanning'
import { DEFAULT_NETWORK_INPUTS } from '../networkDesign'
import { DEFAULT_DR_INPUTS } from '../drDesign'
import type { ClusterConfig, Vm } from '../types'

const policy = (patch: Partial<ClusterConfig> = {}): ClusterConfig => ({ ...structuredClone(DEFAULT_CONFIG), ...patch })
const fleet = (count: number, partial: Partial<Vm> = {}, prefix = 'SYN') => Array.from({ length: count }, (_, i) => newVm({ name: `${prefix}${i}`, vCpu: 4, ramGiB: 32, storageGiB: 200, provisionedGiB: 400, ...partial }))

function cluster(name: string, groups: Array<[number, number, number, number]>, patch: Partial<ExistingCluster> = {}): ExistingCluster {
  return blankCluster(name, {
    hostGroups: groups.map(([count, sockets, coresPerSocket, ramGiB], index) => ({ id: `${name}-g${index}`, count, sockets, coresPerSocket, ramGiB, cpuVendor: 'intel' })),
    spareNodes: 1,
    san: { usableTiB: 200, drr: 1, thinProvisioningSavings: 0, maxIops: 0, maxThroughputMBps: 0 },
    ...patch,
  })
}

function hardware(clusters: ExistingCluster[], patch: Partial<ExistingHardware> = {}): ExistingHardware {
  return { ...blankExistingHardware(), confirmed: true, clusters, ...patch }
}

function payload(overrides: Partial<ProjectPayload> = {}): ProjectPayload {
  return {
    engagementMode: 'fit-gap',
    managementDecision: 'unassessed',
    customerName: 'Synthetic Co',
    vms: fleet(40),
    cfg: structuredClone(DEFAULT_PROPOSED_CONFIG),
    tiers: defaultTiers(),
    chosenKey: 'san',
    existingCapacityCfg: policy(),
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

const section = (report: ReturnType<typeof buildSolutionReport>, id: string) => report.sections.find((item) => item.id === id)!
const metric = (report: ReturnType<typeof buildSolutionReport>, id: string, label: string) => section(report, id).metrics.find((item) => item.label === label)?.value
const sheetRow = (sheets: ReturnType<typeof existingWorkbookSheets>, sheet: string, label: string) => sheets.find((item) => item.name === sheet)?.rows.find((row) => row[0] === label)

describe('blank start', () => {
  beforeEach(() => useSurveyorStore.getState().resetScenario())

  it('starts with no invented hardware', () => {
    const hw = useSurveyorStore.getState().existingHardware
    expect(hw.clusters).toHaveLength(1)
    expect(hw.clusters[0].hostGroups).toHaveLength(1)
    expect(hw.clusters[0].hostGroups[0]).toMatchObject({ count: 0, sockets: 0, coresPerSocket: 0, ramGiB: 0 })
    expect(hw.clusters[0].san.usableTiB).toBe(0)
    expect(hw.targetCpuVendor).toBe('unknown')
    expect(hw.confirmed).toBe(false)
  })

  for (const mode of ['existing-capacity', 'fit-gap'] as const) {
    it(`says "Enter your hardware" on every surface (${mode})`, () => {
      const state = payload({ engagementMode: mode })
      const design = resolvePlatformDesign(platformDesignInputs(state))
      expect(design.status).toBe('no-hardware')
      expect(design.headline).toBe('Enter your hardware')
      expect(design.nodesLabel).toBe('Enter your hardware')
      expect(design.feasible).toBeNull()
      expect(design.network.nodes).toBeNull()
      expect(design.totalNodes).toBeNull()
      const report = buildSolutionReport({ ...state, generatedAt: '2026-11-05T00:00:00.000Z' })
      expect(metric(report, 'executive', 'Existing nodes')).toBe('Enter your hardware')
      expect(metric(report, 'executive', 'Fit decision')).toBe('Enter your hardware')
      expect(metric(report, 'existing', 'Existing hardware')).toBe('Enter your hardware')
      const sheets = existingWorkbookSheets(design, state.vms, '2026-11-05T00:00:00.000Z')
      expect(sheetRow(sheets, 'Capacity and Fit', 'Decision')?.[1]).toBe('ENTER YOUR HARDWARE')
      expect(compareScenario(state).result).toBe('Enter your hardware')
    })
  }
})

describe('fill from imported hosts', () => {
  const hosts: ImportedHost[] = [
    ...Array.from({ length: 4 }, (_, i) => ({ name: `a${i}`, cluster: 'Prod', sockets: 2, coresPerSocket: 24, ramGiB: 767.9, cpuModel: 'Intel(R) Xeon(R) Gold 6342' })),
    ...Array.from({ length: 2 }, (_, i) => ({ name: `b${i}`, cluster: 'Prod', sockets: 2, coresPerSocket: 32, ramGiB: 1024, cpuModel: 'Intel(R) Xeon(R) Platinum 8358' })),
    ...Array.from({ length: 3 }, (_, i) => ({ name: `c${i}`, cluster: 'Dev', sockets: 1, coresPerSocket: 64, ramGiB: 512, cpuModel: 'AMD EPYC 7763 64-Core Processor' })),
  ]

  it('detects the CPU vendor from the model', () => {
    expect(cpuVendorFromCpuModel('Intel(R) Xeon(R) Gold 6342')).toBe('intel')
    expect(cpuVendorFromCpuModel('AMD EPYC 9654')).toBe('amd')
    expect(cpuVendorFromCpuModel('')).toBe('unknown')
  })

  it('groups matching hosts inside each cluster, keeps storage, and is editable', () => {
    const current = hardware([cluster('Template', [[0, 0, 0, 0]], { architecture: 'san', san: { usableTiB: 300, drr: 2, thinProvisioningSavings: 0 } })])
    const filled = existingHardwareFromImport(hosts, current)
    expect(filled.source).toBe('import')
    expect(filled.confirmed).toBe(true)
    expect(filled.clusters.map((item) => item.name)).toEqual(['Prod', 'Dev'])
    const prod = filled.clusters[0]
    expect(prod.hostGroups.map((group) => [group.count, group.sockets, group.coresPerSocket, group.ramGiB, group.cpuVendor])).toEqual([
      [4, 2, 24, 768, 'intel'],
      [2, 2, 32, 1024, 'intel'],
    ])
    expect(filled.clusters[1].hostGroups[0]).toMatchObject({ count: 3, cpuVendor: 'amd' })
    // Storage you typed is kept on every imported cluster.
    expect(prod.san.usableTiB).toBe(300)
    // Intel hosts outnumber AMD hosts 6 to 3.
    expect(filled.targetCpuVendor).toBe('intel')

    useSurveyorStore.getState().resetScenario()
    useSurveyorStore.getState().setLastImport({ hostSummary: { hosts: hosts.length, totalPhysicalCores: 0, totalRamGiB: 0, clusters: ['Prod', 'Dev'], cpuModels: [], perHost: hosts.map((host) => ({ ...host, datacenter: '', vCenter: '', totalCores: host.sockets * host.coresPerSocket, cpuVendor: cpuVendorFromCpuModel(host.cpuModel) })) } } as never)
    expect(useSurveyorStore.getState().fillExistingHardwareFromImport()).toBe(true)
    const stored = useSurveyorStore.getState().existingHardware
    expect(stored.clusters).toHaveLength(2)
    const edited = structuredClone(stored)
    edited.clusters[0].hostGroups[0].count = 5
    useSurveyorStore.getState().setExistingHardware(edited)
    expect(useSurveyorStore.getState().existingHardware.clusters[0].hostGroups[0].count).toBe(5)
    expect(useSurveyorStore.getState().existingCapacityNodes).toBe(10)
  })
})

describe('mixed host groups and the spare rule', () => {
  it('sums host groups and removes spares from the largest hosts first', () => {
    const cfg = policy()
    const groups = [{ count: 2, sockets: 2, coresPerSocket: 32, ramGiB: 256 }, { count: 4, sockets: 1, coresPerSocket: 16, ramGiB: 1024 }]
    const capacity = computeCapacityOf(groups, 1, cfg)
    const big = usableCoresPerHost({ ...cfg.node, sockets: 2, coresPerSocket: 32 }, cfg)
    const small = usableCoresPerHost({ ...cfg.node, sockets: 1, coresPerSocket: 16 }, cfg)
    expect(capacity.hosts).toBe(6)
    expect(capacity.workloadNodes).toBe(5)
    // CPU loses one 64-core host; memory loses one 1,024 GiB host. Each resource on its own.
    expect(capacity.availablePCores).toBeCloseTo(big + 4 * small, 6)
    const ramFull = computeCapacityOf(groups, 0, cfg).availableRamGiB
    const ramBig = computeCapacityOf([groups[1]], 0, cfg).availableRamGiB / 4
    expect(capacity.availableRamGiB).toBeCloseTo(ramFull - ramBig, 6)
  })

  it('a one-cluster, one-group profile gives the same capacity as the older single-spec path', () => {
    const cfg = policy({ spareNodes: 1, node: { ...DEFAULT_CONFIG.node, sockets: 2, coresPerSocket: 16, ramGiB: 512 } })
    const vms = fleet(30)
    const fromLegacy = resolvePlatformDesign(platformDesignInputs(payload({ existingHardware: undefined, existingCapacityCfg: cfg, existingCapacityNodes: 4, vms })))
    expect(fromLegacy.existing!.clusters).toHaveLength(1)
    const reverse = fromLegacy.existing!.clusters[0].reverse
    expect(reverse.workloadNodes).toBe(3)
    expect(reverse.availablePCores).toBeCloseTo(3 * usableCoresPerHost(cfg.node, cfg), 6)
  })

  it('places a mixed cluster and reports the VM that fits no host', () => {
    const hw = hardware([cluster('Mixed', [[3, 2, 16, 512], [1, 2, 32, 1024]], { spareNodes: 1 })])
    const vms = [...fleet(10), newVm({ name: 'HUGE', vCpu: 128, ramGiB: 900, storageGiB: 100 }), newVm({ name: 'BIG', vCpu: 48, ramGiB: 800, storageGiB: 100 })]
    const result = assessExistingHardware({ hardware: hw, policy: policy(), tiers: defaultTiers(), vms })
    // BIG fits the 64-core, 1 TiB host; HUGE fits no host.
    expect(result.unplaced.map((vm) => vm.name)).toEqual(['HUGE'])
    expect(result.unplaced[0].reason).toBe('larger-than-any-host')
    expect(result.verdict).toBe('does-not-fit')
    expect(result.remedies.unplaceable.map((vm) => vm.name)).toEqual(['HUGE'])
    expect(result.findings.some((finding) => finding.code === 'VM_LARGER_THAN_HOST')).toBe(true)
  })
})

describe('multi-cluster placement', () => {
  const twoClusters = () => hardware([
    cluster('Prod', [[3, 2, 16, 512]]),
    cluster('Dev', [[3, 2, 16, 512]]),
  ])

  it('places VMs by source cluster first, then first-fit decreasing, and lists the ones that cannot be placed', () => {
    const vms = [
      ...fleet(20, { sourceCluster: 'prod' }, 'P'),
      ...fleet(5, {}, 'U'),
      newVm({ name: 'GIANT', vCpu: 200, ramGiB: 4000, storageGiB: 100 }),
      newVm({ name: 'TOO-BIG-FOR-DEV', vCpu: 8, ramGiB: 600, storageGiB: 10, sourceCluster: 'Dev' }),
    ]
    const result = assessExistingHardware({ hardware: twoClusters(), policy: policy(), tiers: defaultTiers(), vms })
    expect(result.placement.method).toBe('multi')
    expect(result.placement.sourceMatched).toBe(20)
    const prod = result.clusters.find((item) => item.name === 'Prod')!
    expect(prod.vms.filter((vm) => vm.name.startsWith('P'))).toHaveLength(20)
    expect(result.placement.firstFit).toBe(5)
    const reasons = Object.fromEntries(result.unplaced.map((vm) => [vm.name, vm.reason]))
    expect(reasons).toEqual({ GIANT: 'larger-than-any-host', 'TOO-BIG-FOR-DEV': 'larger-than-source-hosts' })
    expect(result.verdict).toBe('does-not-fit')
  })

  it('leaves a VM unplaced when no cluster has room, and the compute remedy counts it', () => {
    const vms = fleet(120, { vCpu: 8, ramGiB: 64 })
    const result = assessExistingHardware({ hardware: twoClusters(), policy: policy(), tiers: defaultTiers(), vms })
    const noRoom = result.unplaced.filter((vm) => vm.reason === 'no-room')
    expect(noRoom.length).toBeGreaterThan(0)
    expect(result.clusters.every((item) => item.fits !== false)).toBe(true)
    expect(result.verdict).toBe('does-not-fit')
    expect(result.remedies.compute.length).toBeGreaterThan(0)
    expect(result.remedies.compute[0].reason).toMatch(/no cluster had room/)
  })

  it('each cluster holds its own limits: an S2D cluster above 16 hosts is blocked, with no "additional 0"', () => {
    const s2d = cluster('Big S2D', [[20, 2, 32, 1024]], {
      architecture: 's2d',
      s2d: { media: 'all-flash', capacityDrivesPerNode: 8, capacityDriveTB: 7.68, cacheDrivesPerNode: 0, cacheDriveTB: 0, iopsPerNode: 0, throughputMBpsPerNode: 0 },
    })
    const design = resolvePlatformDesign(platformDesignInputs(payload({ existingHardware: hardware([s2d]), vms: fleet(10) })))
    expect(design.status).toBe('does-not-fit')
    expect(design.explanation).toMatch(/16/)
    expect(design.explanation).not.toMatch(/additional 0|required 4/i)
    expect(design.existing!.remedies.compute).toHaveLength(0)
  })

  it('a shared array is checked for the clusters together', () => {
    const hw = hardware([cluster('A', [[4, 2, 32, 1024]]), cluster('B', [[4, 2, 32, 1024]])], { sanScope: 'shared', sharedSan: { usableTiB: 10, drr: 1, thinProvisioningSavings: 0 } })
    const vms = [...fleet(30, { sourceCluster: 'A', storageGiB: 250 }, 'A'), ...fleet(30, { sourceCluster: 'B', storageGiB: 250 }, 'B')]
    const result = assessExistingHardware({ hardware: hw, policy: policy(), tiers: defaultTiers(), vms })
    // 60 × 250 GiB is about 14.6 TiB on a 10 TiB array: each cluster alone fits, together they do not.
    expect(result.findings.some((finding) => finding.code === 'SHARED_SAN_CAPACITY')).toBe(true)
    expect(result.verdict).toBe('does-not-fit')
    const shared = result.remedies.storage.find((item) => item.scope === 'Shared array')!
    expect(shared.sanUsableToAddTiB).toBeCloseTo(60 * 250 / 1024 - 10, 1)
  })
})

describe('separate remedies', () => {
  it('gives compute, storage, performance and VM remedies, each with a number, and a what-to-add list', () => {
    const hw = hardware([cluster('Only', [[3, 2, 16, 512], [1, 2, 32, 1024]], { san: { usableTiB: 5, drr: 1, thinProvisioningSavings: 0, maxIops: 1000, maxThroughputMBps: 0 } })])
    const vms = [...fleet(60, { performance: { storageIopsP95: 100, storageThroughputMBpsP95: 1 } }), newVm({ name: 'HUGE', vCpu: 256, ramGiB: 4096, storageGiB: 10 })]
    const result = assessExistingHardware({ hardware: hw, policy: policy(), tiers: defaultTiers(), vms })
    expect(result.verdict).toBe('does-not-fit')
    const [compute] = result.remedies.compute
    expect(compute.hostsToAdd).toBeGreaterThan(0)
    // The default spec is the most common group: 3 hosts of 2 × 16 cores, 512 GiB.
    expect(compute.spec).toMatchObject({ sockets: 2, coresPerSocket: 16, ramGiB: 512 })
    const [storage] = result.remedies.storage
    expect(storage.domain).toBe('san')
    expect(storage.sanUsableToAddTiB).toBeCloseTo(60 * 200 / 1024 - 5, 1)
    expect(storage.sanUsableToTargetTiB!).toBeGreaterThan(storage.sanUsableToAddTiB!)
    const iops = result.remedies.performance.find((item) => item.metric === 'iops')!
    expect(iops.shortfall).toBeCloseTo(6000 - 1000, 0)
    expect(result.remedies.unplaceable.map((vm) => vm.name)).toEqual(['HUGE'])
    expect(result.whatToAdd.map((item) => item.category)).toEqual(['compute', 'storage', 'performance', 'vm'])

    // A chosen spec is used instead of the most common one.
    const bigger = assessExistingHardware({ hardware: { ...hw, addSpecGroupId: 'Only-g1' }, policy: policy(), tiers: defaultTiers(), vms })
    expect(bigger.remedies.compute[0].spec).toMatchObject({ coresPerSocket: 32, ramGiB: 1024 })
    expect(bigger.remedies.compute[0].hostsToAdd).toBeLessThan(compute.hostsToAdd)
  })

  it('offers S2D drives or hosts when S2D is short', () => {
    const s2d = cluster('S2D', [[4, 2, 32, 1024]], {
      architecture: 's2d',
      s2d: { media: 'all-flash', capacityDrivesPerNode: 4, capacityDriveTB: 3.84, cacheDrivesPerNode: 0, cacheDriveTB: 0, iopsPerNode: 0, throughputMBpsPerNode: 0 },
    })
    const result = assessExistingHardware({ hardware: hardware([s2d]), policy: policy(), tiers: defaultTiers(), vms: fleet(40, { storageGiB: 400 }) })
    const [storage] = result.remedies.storage
    expect(storage.domain).toBe('s2d')
    expect(storage.s2dDrivesPerHost).toBeGreaterThan(4)
    expect(storage.s2dHostsToAdd).toBeGreaterThan(0)
  })
})

describe('existing capacity outputs', () => {
  it('with no workloads, shows capacity and the profile answer only', () => {
    const hw = hardware([cluster('Only', [[4, 2, 16, 512]])], { vmProfile: { mode: 'custom', tier: 'general', vCpu: 4, ramGiB: 16, storageGiB: 100, iops: 0 } })
    const result = assessExistingHardware({ hardware: hw, policy: policy(), tiers: defaultTiers(), vms: [] })
    expect(result.verdict).toBe('no-workload')
    expect(result.firstToRunOut).toBeNull()
    expect(result.profile.count).toBeGreaterThan(0)
    expect(result.profile.limitedBy).not.toBeNull()
    expect(result.whatToAdd).toEqual([])
    expect(result.growthYears).toEqual([])
  })

  it('reports the year each resource runs out at the entered growth', () => {
    // One cluster of 3 hosts (N+1). CPU sits near 50% today; 20% a year passes 100% in year 4.
    const cfg = policy({ annualGrowthPct: 0.2, growthHorizonYears: 5 })
    const hw = hardware([cluster('Only', [[3, 2, 16, 4096]], { san: { usableTiB: 1000, drr: 1, thinProvisioningSavings: 0 } })])
    const coresPerHost = usableCoresPerHost({ ...cfg.node, sockets: 2, coresPerSocket: 16 }, cfg)
    const halfCores = coresPerHost * 2 * 0.5
    // 4 vCPU at 4:1 is 1 physical core per VM.
    const vms = fleet(Math.floor(halfCores), { vCpu: 4, ramGiB: 8, storageGiB: 10 })
    const result = assessExistingHardware({ hardware: hw, policy: cfg, tiers: defaultTiers(), vms })
    const cpu = result.resources.find((row) => row.resource === 'cpu')!
    expect(cpu.pct).toBeGreaterThan(0.45)
    expect(cpu.pct).toBeLessThanOrEqual(0.5)
    let expected = 0
    while (cpu.used * 1.2 ** expected <= cpu.available) expected += 1
    expect(cpu.exhaustionYear).toBe(expected)
    expect(expected).toBe(4)
    expect(result.firstToRunOut?.resource).toBe('cpu')
    // The growth timeline turns red the same year.
    expect(result.growthYears.find((point) => !point.fits)?.year).toBe(4)
    expect(result.growthYears[4].hostsToAdd).toBeGreaterThan(0)
  })

  it('a two-node three-way mirror is not shown as green headroom', () => {
    const s2d = cluster('Two', [[2, 2, 32, 1024]], {
      architecture: 's2d', resiliency: 'three-way-mirror',
      s2d: { media: 'all-flash', capacityDrivesPerNode: 8, capacityDriveTB: 7.68, cacheDrivesPerNode: 0, cacheDriveTB: 0, iopsPerNode: 0, throughputMBpsPerNode: 0 },
    })
    const design = resolvePlatformDesign(platformDesignInputs(payload({ engagementMode: 'existing-capacity', existingHardware: hardware([s2d]), vms: [] })))
    expect(design.headline).toBe('Not valid as entered')
    expect(design.errors.length).toBeGreaterThan(0)
    expect(design.existing!.profile.count).toBe(0)
  })

  it('the target CPU vendor reaches the readiness check', () => {
    const hw = hardware([cluster('Only', [[4, 2, 16, 512]])], { targetCpuVendor: 'intel' })
    const design = resolvePlatformDesign(platformDesignInputs(payload({ existingHardware: hw })))
    expect(design.cfg.node.cpuVendor).toBe('intel')
  })
})

describe('migration of older projects', () => {
  it('turns a single-spec project into one cluster with one host group', () => {
    const cfg = policy({ spareNodes: 1, node: { ...DEFAULT_CONFIG.node, sockets: 2, coresPerSocket: 24, ramGiB: 768 }, san: { ...DEFAULT_CONFIG.san, usableTiB: 120 } })
    const migrated = normalizeProjectPayload({ engagementMode: 'fit-gap', cfg: {}, tiers: {}, vms: [], existingCapacityCfg: cfg, existingCapacityNodes: 6 })
    const hw = migrated.existingHardware!
    expect(hw.source).toBe('migrated')
    expect(hw.confirmed).toBe(true)
    expect(hw.looksLikeOldDefaults).toBe(false)
    expect(hw.clusters).toHaveLength(1)
    expect(hw.clusters[0].hostGroups).toEqual([expect.objectContaining({ count: 6, sockets: 2, coresPerSocket: 24, ramGiB: 768 })])
    expect(hw.clusters[0].spareNodes).toBe(1)
    expect(hw.clusters[0].san.usableTiB).toBe(120)
  })

  it('keeps old default values but asks you to confirm them', () => {
    const file = JSON.stringify({ kind: 'hyperv-surveyor-project', schemaVersion: 6, engineVersion: '1.2.0', exportedAt: '', payload: { ...payload({ engagementMode: 'existing-capacity' }), existingHardware: undefined, existingCapacityCfg: structuredClone(DEFAULT_CONFIG), existingCapacityNodes: 8 } })
    const project = parseProject(file)
    const hw = project.payload.existingHardware!
    expect(hw.looksLikeOldDefaults).toBe(true)
    expect(hw.confirmed).toBe(false)
    expect(hw.clusters[0].hostGroups[0]).toMatchObject({ count: 8, sockets: 2, coresPerSocket: 48, ramGiB: 1536 })
    const design = resolvePlatformDesign(platformDesignInputs(project.payload))
    expect(design.totalNodes).toBe(8)
    expect(design.existing!.notices[0]).toMatch(/look like the old built-in defaults/)
    const report = buildSolutionReport({ ...project.payload, generatedAt: '2026-11-05T00:00:00.000Z' })
    expect(section(report, 'existing').paragraphs.join(' ')).toMatch(/old built-in defaults/)
    // Confirming clears the notice.
    useSurveyorStore.getState().resetScenario()
    useSurveyorStore.getState().loadProject(project.payload)
    useSurveyorStore.getState().confirmExistingHardware()
    expect(useSurveyorStore.getState().existingHardware.looksLikeOldDefaults).toBe(false)
    expect(useSurveyorStore.getState().existingHardware.confirmed).toBe(true)
  })

  it('migrates saved browser state and old share links the same way', () => {
    const cfg = policy({ node: { ...DEFAULT_CONFIG.node, sockets: 1, coresPerSocket: 32, ramGiB: 512 } })
    const state = migratePersistedState({ existingCapacityCfg: cfg, existingCapacityNodes: 5 })
    expect(state.existingHardware.clusters[0].hostGroups[0]).toMatchObject({ count: 5, sockets: 1, coresPerSocket: 32 })
    expect(state.existingHardware.confirmed).toBe(true)
    expect(migratePersistedState({}).existingHardware.clusters[0].hostGroups[0].count).toBe(0)

    useSurveyorStore.getState().resetScenario()
    const link = toUrl({ cfg: structuredClone(DEFAULT_PROPOSED_CONFIG), tiers: defaultTiers(), existingCapacityCfg: cfg, existingCapacityNodes: 5, vms: [] }, '/capacity', 'https://surveyor.example/')
    const shared = readSharedLink(link)!.scenario
    expect(shared.existingHardware).toBeUndefined()
    useSurveyorStore.getState().loadScenario(shared)
    expect(useSurveyorStore.getState().existingHardware.clusters[0].hostGroups[0]).toMatchObject({ count: 5, coresPerSocket: 32 })

    // A current link carries the grouped hardware as it is.
    const grouped = hardware([cluster('X', [[2, 2, 16, 512], [1, 2, 32, 1024]]), cluster('Y', [[3, 1, 16, 256]])])
    const next = readSharedLink(toUrl({ cfg: structuredClone(DEFAULT_PROPOSED_CONFIG), tiers: defaultTiers(), existingHardware: grouped, vms: [] }, '/capacity', 'https://surveyor.example/'))!.scenario
    useSurveyorStore.getState().loadScenario(next)
    expect(useSurveyorStore.getState().existingHardware.clusters.map((item) => item.name)).toEqual(['X', 'Y'])
    expect(normalizeExistingHardware(JSON.parse(JSON.stringify(grouped))).clusters[0].hostGroups).toHaveLength(2)
  })
})

describe('cross-surface consistency', () => {
  const mixed = () => hardware([
    cluster('Prod', [[3, 2, 16, 512], [1, 2, 32, 1024]], { san: { usableTiB: 8, drr: 1, thinProvisioningSavings: 0 } }),
    cluster('Dev', [[2, 2, 16, 512]], { san: { usableTiB: 50, drr: 1, thinProvisioningSavings: 0 } }),
  ])
  const vms = () => [...fleet(50, { sourceCluster: 'Prod' }, 'P'), ...fleet(10, { sourceCluster: 'Dev' }, 'D'), newVm({ name: 'HUGE', vCpu: 256, ramGiB: 4096, storageGiB: 10 })]

  for (const mode of ['existing-capacity', 'fit-gap'] as const) {
    it(`agrees on pages, report, workbook and project comparison (${mode})`, () => {
      const state = payload({ engagementMode: mode, existingHardware: mixed(), vms: vms() })
      const design = resolvePlatformDesign(platformDesignInputs(state))
      const existing = design.existing!
      const report = buildSolutionReport({ ...state, generatedAt: '2026-11-05T00:00:00.000Z' })
      const sheets = existingWorkbookSheets(design, state.vms, '2026-11-05T00:00:00.000Z')
      const project = compareScenario(state)
      expect(design.totalNodes).toBe(6)
      expect(design.nodesLabel).toBe('6 across 2 clusters')
      expect(metric(report, 'executive', 'Existing nodes')).toBe(design.nodesLabel)
      expect(sheetRow(sheets, 'Capacity and Fit', 'Existing nodes')?.[1]).toBe(6)
      expect(project.nodes).toBe('6 across 2 clusters existing')
      expect(existing.verdict).toBe('does-not-fit')
      expect(metric(report, 'executive', 'Fit decision')).toBe('Does not fit')
      expect(metric(report, 'existing', 'Fit decision')).toBe('Does not fit')
      expect(sheetRow(sheets, 'Capacity and Fit', 'Decision')?.[1]).toBe('DOES NOT FIT')
      expect(project.result).toBe('Does not fit')
      // What to add: the same lines in the report table and the workbook.
      const reportTable = section(report, 'existing').tables.find((table) => table.title === 'What to add')!
      const workbook = sheets.find((sheet) => sheet.name === 'What to Add')!.rows.slice(3)
      expect(reportTable.rows).toHaveLength(existing.whatToAdd.length)
      expect(workbook.slice(0, existing.whatToAdd.length).map((row) => row[2])).toEqual(existing.whatToAdd.map((item) => item.quantity))
      expect(existing.whatToAdd.some((item) => item.category === 'storage' && item.scope === 'Prod')).toBe(true)
      expect(existing.whatToAdd.some((item) => item.category === 'vm')).toBe(true)
      // The profile answer is the same everywhere.
      expect(sheetRow(sheets, 'VM Capacity', 'More VMs of the chosen profile')?.[1]).toBe(existing.profile.count)
      // Per-cluster rows reach the report and the implementation plan.
      expect(design.clusters.map((item) => item.name)).toEqual(['Prod', 'Dev'])
      expect(section(report, 'existing').tables.some((table) => table.title === 'Per-cluster results')).toBe(true)
      expect(design.network.nodes).toBe(6)
      // Licensable cores are summed host by host: 3 × 32 + 1 × 64 + 2 × 32.
      expect(design.licensableCores).toBe(3 * 32 + 64 + 2 * 32)
      expect(JSON.stringify(report.sections)).not.toMatch(/Build \d+ (total )?nodes|Initial build|Not sufficient/)
    })
  }

  it('the new-platform path is unchanged by existing hardware', () => {
    const base = payload({ engagementMode: 'new-platform', vms: fleet(40) })
    const a = resolvePlatformDesign(platformDesignInputs(base))
    const b = resolvePlatformDesign(platformDesignInputs({ ...base, existingHardware: mixed() }))
    expect(b.nodesLabel).toBe(a.nodesLabel)
    expect(b.existing).toBeNull()
    expect(b.status).toBe(a.status)
  })
})
