/**
 * Phase 8: the Implementation plan gives a planner what they need to build. Synthetic data only.
 */
import { describe, expect, it } from 'vitest'
import { assessMigrationReadiness, guestOsSupport } from '../readiness'
import { designNetwork, DEFAULT_NETWORK_INPUTS, normalizeNetworkDesignInputs, parseVlans, type NetworkDesignInputs } from '../networkDesign'
import { designDisasterRecovery, normalizeDrDesignInputs } from '../drDesign'
import { planMultipleClusters } from '../deploymentPlanning'
import { assessExistingHardware, additionalVmsByTier, blankCluster, blankExistingHardware, type ExistingCluster, type ExistingHardware } from '../existingHardware'
import { resolvePlatformDesign } from '../platformDesign'
import { platformDesignInputs } from '../../state/usePlatformDesign'
import { DEFAULT_CONFIG, DEFAULT_PROPOSED_CONFIG, defaultTiers, newVm } from '../../state/defaults'
import { DEFAULT_PLACEMENT_INPUTS } from '../deploymentPlanning'
import { DEFAULT_DR_INPUTS } from '../drDesign'
import { buildSolutionReport } from '../../report/reportModel'
import { designWorkbookSheets, existingWorkbookSheets } from '../../io/exportXlsx'
import { createProject, DEFAULT_REPORT_METADATA, normalizeProjectPayload, parseProject, type ProjectPayload } from '../../state/project'
import { migratePersistedState } from '../../state/store'
import { readSharedLink, toUrl } from '../../state/urlState'
import { makeConfig, vm } from './fixtures'
import { DEFAULT_TIERS } from '../rules'
import type { ClusterConfig, Vm } from '../types'

const ready = (patch: Partial<Vm> = {}): Vm => vm({
  guestOs: 'Microsoft Windows Server 2022 (64-bit)', firmware: 'efi', diskCount: 2, hasRdm: false, rdmPhysical: false, hasSharedDisk: false,
  hasIndependentDisk: false, onVsan: false, snapshotCount: 0, encrypted: false, hasVtpm: false, ...patch,
})
const amd = makeConfig({ node: { cpuVendor: 'amd' } })
const statusOf = (v: Vm, cfg: ClusterConfig = amd) => assessMigrationReadiness([v], cfg).statusByVm[v.id]

describe('F2 guest OS support', () => {
  it('reads Microsoft supported-guest lists', () => {
    expect(guestOsSupport('Microsoft Windows Server 2022 (64-bit)').support).toBe('supported')
    expect(guestOsSupport('Microsoft Windows 11 (64-bit)').support).toBe('supported')
    expect(guestOsSupport('Microsoft Windows Server 2008 R2 (64-bit)').support).toBe('legacy')
    expect(guestOsSupport('Microsoft Windows Server 2003 Standard (32-bit)').support).toBe('not-listed')
    expect(guestOsSupport('Oracle Solaris 11 (64-bit)').support).toBe('not-listed')
    expect(guestOsSupport('VMware Photon OS (64-bit)').support).toBe('not-listed')
    expect(guestOsSupport('Ubuntu Linux (64-bit)').support).toBe('supported-family')
    expect(guestOsSupport('').support).toBe('unknown')
  })

  it('never calls legacy, unsupported or blank guests Ready', () => {
    for (const os of ['Microsoft Windows Server 2003', 'Microsoft Windows Server 2008', 'Oracle Solaris 10', 'VMware Photon OS', '', 'Other (64-bit)']) {
      expect(statusOf(ready({ guestOs: os }))).not.toBe('ready')
    }
    expect(statusOf(ready())).toBe('ready')
    expect(statusOf(ready({ guestOs: 'Red Hat Enterprise Linux 9 (64-bit)' }))).toBe('ready')
  })
})

describe('F5 generation limits and F8 firmware', () => {
  it('blocks BIOS VMs above the Generation 1 limits', () => {
    const big = assessMigrationReadiness([ready({ firmware: 'bios', vCpu: 128, ramGiB: 2048 })], amd)
    expect(big.blocked).toBe(1)
    expect(big.findings.filter((finding) => finding.status === 'blocked').map((finding) => finding.finding).join(' ')).toMatch(/64.*1 TB/s)
  })

  it('blocks disk counts above 256 SCSI (Gen 2) or 260 (Gen 1)', () => {
    expect(statusOf(ready({ diskCount: 257 }))).toBe('blocked')
    expect(statusOf(ready({ firmware: 'bios', diskCount: 258 }))).toBe('review')
    expect(statusOf(ready({ firmware: 'bios', diskCount: 261 }))).toBe('blocked')
  })

  it('treats missing or unknown firmware as review, never Ready', () => {
    expect(statusOf(ready({ firmware: undefined }))).toBe('review')
    expect(statusOf(ready({ firmware: 'unknown' }))).toBe('review')
  })

  it('flags vTPM on a BIOS VM', () => {
    const result = assessMigrationReadiness([ready({ firmware: 'bios', hasVtpm: true })], amd)
    expect(result.findings.some((finding) => /Generation 2 VMs only/.test(finding.finding))).toBe(true)
  })
})

describe('F7 CPU vendor and conversion blockers', () => {
  it('notes a vendor change without changing the status', () => {
    const v = ready({ sourceCpuVendor: 'intel' })
    const result = assessMigrationReadiness([v], amd)
    expect(result.findings.find((finding) => finding.category === 'processor')?.status).toBe('info')
    expect(result.statusByVm[v.id]).toBe('ready')
  })

  it('flags independent disks, physical-mode RDMs and vSAN VMs with their sources', () => {
    const result = assessMigrationReadiness([
      ready({ name: 'ind', hasIndependentDisk: true }),
      ready({ name: 'prdm', hasRdm: true, rdmPhysical: true }),
      ready({ name: 'vsan', onVsan: true }),
      ready({ name: 'multi', hasSharedDisk: true }),
    ], amd)
    expect(result.findings.find((finding) => finding.vmName === 'ind')!.source).toMatch(/troubleshoot-vm-conversion/)
    expect(result.findings.find((finding) => finding.vmName === 'prdm')!.status).toBe('blocked')
    expect(result.findings.find((finding) => finding.vmName === 'vsan')!.finding).toMatch(/vSAN/)
    expect(result.findings.find((finding) => finding.vmName === 'multi')!.finding).toMatch(/Shared virtual disk/)
  })

  it('says which checks did not run because data is missing', () => {
    const result = assessMigrationReadiness([vm({ guestOs: 'Microsoft Windows Server 2022', firmware: 'efi' })], amd)
    expect(result.notChecked.map((gap) => gap.check)).toEqual(expect.arrayContaining(['Raw device mappings', 'Independent disks', 'vSAN placement']))
    expect(result.readyMeaning).toMatch(/not run for some VMs because the data is missing/)
    expect(assessMigrationReadiness([ready()], amd).notChecked).toHaveLength(0)
  })
})

describe('F3 SAN connectivity', () => {
  const san = makeConfig({ architecture: 'san' })
  const net = (patch: Partial<NetworkDesignInputs['san']>) => designNetwork(san, 4, { ...DEFAULT_NETWORK_INPUTS, san: { ...DEFAULT_NETWORK_INPUTS.san, ...patch } })

  it('a single adapter at 1 Gbps produces findings', () => {
    const design = net({ protocol: 'iscsi', adaptersPerHost: 1, portsPerAdapter: 1, speedGbps: 1, pathsPerLun: 1, dedicatedIscsi: false })
    const messages = design.findings.map((finding) => `${finding.severity}: ${finding.message}`).join('\n')
    expect(messages).toMatch(/warning: One iSCSI adapter per host is a single point of failure/)
    expect(messages).toMatch(/error: Each host has one iSCSI adapter port/)
    expect(messages).toMatch(/below 10 Gbps/)
    expect(messages).toMatch(/dedicate each adapter to either network communication or iSCSI/)
  })

  it('counts host, array and fabric ports and checks paths, MPIO and fabric totals', () => {
    const design = net({ protocol: 'fc', adaptersPerHost: 2, portsPerAdapter: 2, fabrics: 2, arrayPortsPerFabric: 4, pathsPerLun: 4, fabricPortsAvailable: 10 })
    expect(design.san).toMatchObject({ hostPortsPerNode: 4, totalHostPorts: 16, arrayPorts: 8, fabricPortsNeeded: 24, maxPathsPerLun: 16, hostPortsPerFabric: 8 })
    expect(design.findings.some((finding) => finding.severity === 'error' && /need 24 ports/.test(finding.message))).toBe(true)
    expect(net({ mpio: false }).findings.some((finding) => finding.severity === 'error' && /without MPIO/.test(finding.message))).toBe(true)
    expect(net({ pathsPerLun: 32 }).findings.some((finding) => /give at most/.test(finding.message))).toBe(true)
    expect(net({ protocol: 'none' }).findings.some((finding) => finding.severity === 'error' && /no SAN connectivity is chosen/.test(finding.message))).toBe(true)
  })

  it('reaches the bill of materials, the report and the workbook with the same ports', () => {
    const vms = Array.from({ length: 100 }, (_, i) => vm({ name: `APP${i}` }))
    const payload = { engagementMode: 'new-platform' as const, customerName: 'Example', cfg: structuredClone(DEFAULT_PROPOSED_CONFIG), vms, tiers: defaultTiers(), chosenKey: 'san', managementDeploymentInputs: null, includeManagementInSizing: true, networkDesignInputs: normalizeNetworkDesignInputs({ san: { protocol: 'fc', adaptersPerHost: 2, portsPerAdapter: 2 } }) }
    const design = resolvePlatformDesign({ ...payload, existingCapacityCfg: structuredClone(DEFAULT_CONFIG) })
    const sanPlan = design.implementation.network!.san!
    expect(design.bom.sanConnectivity.status).toBe('planned')
    const hba = design.bom.lines.find((line) => /Fibre Channel HBAs/.test(line.item))!
    expect(hba.quantity).toContain(`(${sanPlan.totalHostPorts} ports)`)
    expect(design.bom.lines.find((line) => /SAN fabric switch ports/.test(line.item))!.quantity).toContain(String(sanPlan.fabricPortsNeeded))
    const report = buildSolutionReport(payload)
    const network = report.sections.find((section) => section.id === 'network')!
    expect(network.metrics.find((metric) => metric.label === 'SAN fabric ports')!.value).toBe(sanPlan.fabricPortsNeeded.toLocaleString('en-US'))
    const sheet = designWorkbookSheets(design, vms).find((item) => item.name === 'Network')!
    expect(sheet.rows.find((row) => row[0] === 'Fabric ports needed')![1]).toBe(sanPlan.fabricPortsNeeded)
  })
})

describe('F11 and F12 host network', () => {
  const s2d = makeConfig({ architecture: 's2d' })
  it('recommends 25 Gbps and RDMA at four or more nodes, with iWARP as the default', () => {
    expect(DEFAULT_NETWORK_INPUTS.rdmaProtocol).toBe('iwarp')
    const slow = designNetwork(s2d, 4, { ...DEFAULT_NETWORK_INPUTS, intents: [{ id: 'a', name: 'Mgmt', types: ['management', 'compute'], adapters: 2, speedGbps: 10 }, { id: 'b', name: 'Storage', types: ['storage'], adapters: 2, speedGbps: 10 }], rdmaProtocol: 'none' })
    expect(slow.findings.some((finding) => finding.severity === 'warning' && /25 Gbps/.test(finding.message) && finding.source?.includes('storage-spaces-direct-hardware-requirements'))).toBe(true)
    expect(slow.findings.some((finding) => finding.severity === 'warning' && /RDMA is not selected/.test(finding.message))).toBe(true)
    const small = designNetwork(s2d, 3, { ...DEFAULT_NETWORK_INPUTS, intents: slow.intents, rdmaProtocol: 'none' })
    expect(small.findings.some((finding) => finding.severity === 'warning')).toBe(false)
  })

  it('applies the SET limit per team, not per host', () => {
    const ten = designNetwork(s2d, 4, { ...DEFAULT_NETWORK_INPUTS, intents: [{ id: 'a', name: 'Compute', types: ['management', 'compute'], adapters: 6, speedGbps: 25 }, { id: 'b', name: 'Storage', types: ['storage'], adapters: 4, speedGbps: 25 }] })
    expect(ten.hostPortsPerNode).toBe(10)
    expect(ten.findings.some((finding) => /eight adapters/.test(finding.message))).toBe(false)
    const oneTeam = designNetwork(s2d, 4, { ...DEFAULT_NETWORK_INPUTS, intents: [{ id: 'a', name: 'Converged', types: ['management', 'compute', 'storage'], adapters: 10, speedGbps: 25 }] })
    expect(oneTeam.findings.some((finding) => finding.severity === 'error' && /eight adapters in a team/.test(finding.message))).toBe(true)
  })

  it('models intents the Network ATC way and counts BMC ports', () => {
    const design = designNetwork(s2d, 4, { ...DEFAULT_NETWORK_INPUTS, intents: [{ id: 'a', name: 'A', types: ['management', 'compute'], adapters: 2, speedGbps: 25 }, { id: 'b', name: 'B', types: ['management', 'storage'], adapters: 2, speedGbps: 25 }] })
    expect(design.findings.some((finding) => /allows one management intent/.test(finding.message))).toBe(true)
    expect(design.bmcPorts).toBe(4)
    expect(design.totalHostPorts).toBe(16)
  })

  it('compares imported network P95 with the compute bandwidth', () => {
    const busy = Array.from({ length: 10 }, (_, i) => vm({ name: `NET${i}`, performance: { networkMbpsP95: 30_000 } }))
    const design = designNetwork(s2d, 4, DEFAULT_NETWORK_INPUTS, { workloadNodes: 3, vms: busy })
    // 3 hosts × 2 × 25 Gbps = 150,000 Mbps against 300,000 Mbps of P95.
    expect(design.traffic).toMatchObject({ computeMbps: 150_000, totalP95Mbps: 300_000, measuredVms: 10 })
    expect(design.findings.some((finding) => finding.severity === 'error' && /network P95 adds up to 300,000 Mbps/.test(finding.message))).toBe(true)
    expect(design.findings.some((finding) => /above one 25 Gbps adapter/.test(finding.message))).toBe(true)
  })
})

describe('F15 VLANs', () => {
  it('validates VLAN IDs and requires a storage VLAN for RoCE', () => {
    expect(parseVlans('100-199, 711')).toEqual({ ids: [100, 199, 711], invalid: [] })
    expect(parseVlans('abc,0,4095,10-5').invalid).toEqual(['abc', '0', '4095', '10-5'])
    const s2d = makeConfig({ architecture: 's2d' })
    const bad = designNetwork(s2d, 4, { ...DEFAULT_NETWORK_INPUTS, managementVlan: 'abc' })
    expect(bad.findings.some((finding) => finding.severity === 'error' && /"abc" is not a valid VLAN ID/.test(finding.message))).toBe(true)
    const roce = designNetwork(s2d, 4, { ...DEFAULT_NETWORK_INPUTS, rdmaProtocol: 'roce-v2', storageVlans: '' })
    expect(roce.findings.some((finding) => finding.severity === 'error' && /nonzero VLAN/.test(finding.message))).toBe(true)
  })
})

describe('F4 disaster recovery', () => {
  const vms = [vm({ storageGiB: 1024 * 100 })]
  const sizing = { requiredStorageTiB: 100 }

  it('checks Replica RPO against 30 seconds, 5 and 15 minutes without a false warning at 60', () => {
    const at60 = designDisasterRecovery(vms, sizing, { strategy: 'hyper-v-replica', rpoMinutes: 60 })
    expect(at60.replicationIntervalMinutes).toBe(15)
    expect(at60.rpoPasses).toBe(true)
    expect(at60.findings.some((finding) => finding.severity !== 'info' && /RPO/.test(finding.message))).toBe(false)
    expect(designDisasterRecovery(vms, sizing, { strategy: 'hyper-v-replica', rpoMinutes: 0.25 }).rpoPasses).toBe(false)
  })

  it('checks ASR RPO against 30 seconds or 5 minutes, and lists ASR blockers', () => {
    const asr = designDisasterRecovery([vm({ encrypted: true }), vm({ hasSharedDisk: true }), vm({ storageGiB: 100_000 })], sizing, { strategy: 'azure-site-recovery', rpoMinutes: 15, dailyChangeRatePct: 5, burstFactor: 2 })
    expect(asr.replicationIntervalMinutes).toBe(5)
    expect(asr.asrBlockers.map((item) => item.reason).join(' ')).toMatch(/Encrypted.*Shared.*churn/s)
    expect(asr.secondaryHosts).toBeNull()
    expect(designDisasterRecovery(vms, sizing, { strategy: 'azure-site-recovery', rpoMinutes: 0.25 }).rpoPasses).toBe(false)
  })

  it('evaluates RTO from restore throughput for backup only', () => {
    const backup = designDisasterRecovery(vms, sizing, { strategy: 'backup-only', rtoHours: 4, restoreThroughputMBps: 1000, backupIntervalHours: 24, rpoMinutes: 60 })
    // 100 TiB at 1,000 MB/s is about 30.5 hours.
    expect(backup.estimatedRecoveryHours!).toBeCloseTo(100 * 1024 ** 4 / 1e9 / 3600, 3)
    expect(backup.rtoPasses).toBe(false)
    expect(backup.rpoPasses).toBe(false)
    expect(backup.bandwidthPasses).toBeNull()
    expect(backup.assumptions.join(' ')).toMatch(/1,000 MB\/s/)
  })

  it('uses decimal megabits, estimates seeding, names the Replica Broker and secondary hosts', () => {
    const replica = designDisasterRecovery(vms, sizing, { strategy: 'hyper-v-replica', dailyChangeRatePct: 1, burstFactor: 1, availableWanMbps: 1000 }, { workloadNodes: 8 })
    expect(replica.estimatedAverageMbps!).toBeCloseTo(100 * 1024 ** 4 * 0.01 * 8 / 1e6 / 86_400, 3)
    expect(replica.seedingDays!).toBeCloseTo(100 * 1024 ** 4 * 8 / 1e9 / 86_400, 2)
    expect(replica.seedingDays!).toBeGreaterThan(10)
    expect(replica.findings.some((finding) => /Replica Broker/.test(finding.message))).toBe(true)
    expect(replica.secondaryHosts).toBe(8)
    expect(designDisasterRecovery(vms, sizing, { strategy: 'hyper-v-replica', seedingMethod: 'offline-media' }).seedingDays).toBeNull()
  })

  it('shows no protected scope or WAN verdict for strategy none', () => {
    const none = designDisasterRecovery(vms, sizing, { strategy: 'none' })
    expect(none).toMatchObject({ protectedVms: 0, protectedStorageTiB: 0, bandwidthPasses: null, estimatedBurstMbps: null })
  })

  it('keeps protected VMs and protected storage in the same proportion', () => {
    const three = [vm(), vm(), vm()]
    const half = designDisasterRecovery(three, { requiredStorageTiB: 30 }, { protectedWorkloadPct: 50 })
    expect(half.protectedVms).toBe(2)
    expect(half.protectedStorageTiB).toBeCloseTo(20, 6)
  })

  it('migrates older DR inputs with the new fields at their defaults', () => {
    expect(normalizeDrDesignInputs({ strategy: 'backup-only', rpoMinutes: '30' })).toMatchObject({ strategy: 'backup-only', rpoMinutes: 30, restoreThroughputMBps: DEFAULT_DR_INPUTS.restoreThroughputMBps, seedingMethod: 'network' })
  })
})

describe('F6, F13 and F15 placement', () => {
  const san = makeConfig({ architecture: 'san', san: { usableTiB: 10_000, drr: 1, maxIops: 100_000 } })

  it('sums performance across clusters on one shared array', () => {
    const vms = Array.from({ length: 8 }, (_, i) => vm({ name: `IO${i}`, performance: { storageIopsP95: 20_000 } }))
    const plan = planMultipleClusters({ ...san, sanSizingMode: 'fixed' }, vms, DEFAULT_TIERS, { clusterLayout: 'split', targetVmsPerCluster: 4, sanCapacityScope: 'shared' })
    expect(plan.clusters).toHaveLength(2)
    expect(plan.feasible).toBe(false)
    expect(plan.warnings.join(' ')).toMatch(/share one array: together they need 160,000 IOPS/)
    const perCluster = planMultipleClusters({ ...san, sanSizingMode: 'fixed' }, vms, DEFAULT_TIERS, { clusterLayout: 'split', targetVmsPerCluster: 4, sanCapacityScope: 'per-cluster' })
    expect(perCluster.feasible).toBe(true)
  })

  it('applies the maximum clusters to the total, not each pool', () => {
    const vms = [vm({ name: 'DB1', tier: 'database' }), vm({ name: 'APP1' })]
    const plan = planMultipleClusters(san, vms, DEFAULT_TIERS, { clusterLayout: 'split', separateDatabaseTier: true, maxClusters: 1 })
    expect(plan.feasible).toBe(false)
    expect(plan.warnings.join(' ')).toMatch(/1 cluster in total/)
    expect(planMultipleClusters(san, vms, DEFAULT_TIERS, { clusterLayout: 'split', separateDatabaseTier: true, maxClusters: 2 }).feasible).toBe(true)
  })

  it('says when database separation splits a source cluster kept together', () => {
    const vms = [vm({ name: 'DB1', tier: 'database', sourceCluster: 'SRC-A' }), vm({ name: 'APP1', sourceCluster: 'SRC-A' })]
    const plan = planMultipleClusters(san, vms, DEFAULT_TIERS, { clusterLayout: 'split', separateDatabaseTier: true, preserveSourceClusters: true })
    expect(plan.warnings.join(' ')).toMatch(/Database separation comes first, so source cluster SRC-A is split/)
  })

  it('finds a valid 2 + 2 packing the old weight-only order rejected', () => {
    const vms = [vm({ name: 'BIG', vCpu: 40 }), vm({ name: 'S1', vCpu: 2 }), vm({ name: 'S2', vCpu: 2 }), vm({ name: 'S3', vCpu: 2 })]
    const plan = planMultipleClusters(san, vms, DEFAULT_TIERS, { clusterLayout: 'split', targetVmsPerCluster: 2 })
    expect(plan.feasible).toBe(true)
    expect(plan.clusters).toHaveLength(2)
    expect(plan.clusters.map((cluster) => cluster.vms.length)).toEqual([2, 2])
  })

  it('names an oversized source cluster instead of blaming the cluster maximum', () => {
    const vms = Array.from({ length: 6 }, (_, i) => vm({ name: `S${i}`, sourceCluster: 'HUGE' }))
    const plan = planMultipleClusters(san, vms, DEFAULT_TIERS, { clusterLayout: 'split', preserveSourceClusters: true, targetVmsPerCluster: 4 })
    expect(plan.feasible).toBe(false)
    expect(plan.warnings.join(' ')).toMatch(/Source cluster HUGE cannot fit one target cluster on its own/)
    expect(plan.warnings.join(' ')).not.toMatch(/within 32 clusters/)
  })

  it('counts management VMs in the cluster ceiling and keeps them on one cluster', () => {
    const workload = [vm({ name: 'APP1', sourceCluster: 'A' }), vm({ name: 'APP2', sourceCluster: 'A' })]
    const management = [vm({ name: 'VMM01', tier: 'infrastructure' }), vm({ name: 'SQL01', tier: 'infrastructure' })]
    // Two workload VMs kept together plus two management VMs cannot share one 2-VM cluster: a second cluster holds management.
    const plan = planMultipleClusters(san, workload, DEFAULT_TIERS, { clusterLayout: 'split', preserveSourceClusters: true, targetVmsPerCluster: 2 }, management)
    expect(plan.feasible).toBe(true)
    expect(plan.clusters).toHaveLength(2)
    expect(plan.clusters.filter((cluster) => cluster.managementVmCount > 0)).toHaveLength(1)
  })
})

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
const hardware = (clusters: ExistingCluster[], patch: Partial<ExistingHardware> = {}): ExistingHardware => ({ ...blankExistingHardware(), confirmed: true, clusters, ...patch })

describe('Phase 6 limitations', () => {
  it('caps the per-tier room by a shared array instead of adding each cluster\'s answer', () => {
    const hw = hardware([cluster('A', [[4, 2, 64, 2048]]), cluster('B', [[4, 2, 64, 2048]])], { sanScope: 'shared', sharedSan: { usableTiB: 20, drr: 1, thinProvisioningSavings: 0 } })
    const vms = [...fleet(10, { sourceCluster: 'A' }, 'A'), ...fleet(10, { sourceCluster: 'B' }, 'B')]
    const result = assessExistingHardware({ hardware: hw, policy: policy(), tiers: defaultTiers(), vms })
    const summed = result.clusters.reduce((total, item) => total + item.reverse.additionalVmsByTier.general, 0)
    const room = additionalVmsByTier(result).general
    expect(room).toBeLessThan(summed)
    // Room on the shared array after the free-space target, at 200 GiB per general VM.
    const used = result.resources.find((row) => row.resource === 'san-storage')!.used
    expect(room).toBeLessThanOrEqual(Math.floor((20 * (1 - (policy().sanFreeSpaceTargetPct ?? 0.2)) - used) * 1024 / 200) + 1)
    expect(existingWorkbookSheets(resolvePlatformDesign(platformDesignInputs({
      engagementMode: 'existing-capacity', cfg: structuredClone(DEFAULT_PROPOSED_CONFIG), tiers: defaultTiers(), vms, chosenKey: 'san',
      existingCapacityCfg: policy(), existingCapacityTiers: defaultTiers(), existingCapacityNodes: 8, existingHardware: hw,
      placementInputs: structuredClone(DEFAULT_PLACEMENT_INPUTS), managementDecision: 'unassessed', managementDeploymentInputs: null, includeManagementInSizing: true,
    })), vms).find((sheet) => sheet.name === 'VM Capacity')!.rows.find((row) => row[0] === defaultTiers().general.label)![2]).toBe(room)
  })

  it('finds the run-out year by re-running the calculation per year', () => {
    const hw = hardware([cluster('A', [[4, 2, 32, 4096]])])
    const vms = fleet(40, { vCpu: 8 })
    const growing = policy({ annualGrowthPct: 0.1, growthStrategy: 'phased', growthFactor: 1 })
    const result = assessExistingHardware({ hardware: hw, policy: growing, tiers: defaultTiers(), vms })
    const cpu = result.resources.find((row) => row.resource === 'cpu')!
    expect(result.exhaustionNote).toMatch(/re-running the capacity calculation for each year/)
    expect(cpu.exhaustionYear).not.toBeNull()
    const year = cpu.exhaustionYear!
    const at = (factor: number) => assessExistingHardware({ hardware: hw, policy: policy({ annualGrowthPct: 0, growthStrategy: 'phased', growthFactor: factor }), tiers: defaultTiers(), vms }).resources.find((row) => row.resource === 'cpu')!
    expect(at(1.1 ** year).used).toBeGreaterThan(at(1.1 ** year).available)
    if (year > 0) expect(at(1.1 ** (year - 1)).used).toBeLessThanOrEqual(at(1.1 ** (year - 1)).available)
  })
})

describe('persistence and cross-surface agreement', () => {
  function payload(overrides: Partial<ProjectPayload> = {}): ProjectPayload {
    return {
      engagementMode: 'new-platform', managementDecision: 'unassessed', customerName: 'Synthetic Co',
      vms: fleet(60, { guestOs: 'Microsoft Windows Server 2008 R2 (64-bit)', firmware: 'bios' }),
      cfg: structuredClone(DEFAULT_PROPOSED_CONFIG), tiers: defaultTiers(), chosenKey: 'san',
      existingCapacityCfg: policy(), existingCapacityTiers: defaultTiers(), existingCapacityNodes: 8, existingHardware: blankExistingHardware(),
      managementDeploymentInputs: null, includeManagementInSizing: true, placementInputs: structuredClone(DEFAULT_PLACEMENT_INPUTS),
      networkDesignInputs: normalizeNetworkDesignInputs({ ...DEFAULT_NETWORK_INPUTS, bmcPortsPerNode: 2, san: { ...DEFAULT_NETWORK_INPUTS.san, protocol: 'iscsi', adaptersPerHost: 2, speedGbps: 25 } }),
      drDesignInputs: { ...DEFAULT_DR_INPUTS, strategy: 'backup-only', restoreThroughputMBps: 500 },
      reportMetadata: structuredClone(DEFAULT_REPORT_METADATA), dataSources: [], storageDecisionAnswers: {},
      ...overrides,
    }
  }

  it('migrates older network inputs to intents and keeps them in projects, browser state and links', () => {
    const legacy = normalizeNetworkDesignInputs({ adaptersPerNode: 6, adapterSpeedGbps: 10, rdmaProtocol: 'roce-v2' })
    expect(legacy.intents.map((intent) => intent.adapters)).toEqual([4, 2])
    expect(legacy.rdmaProtocol).toBe('roce-v2')
    expect(legacy.san.protocol).toBe('fc')
    const migrated = migratePersistedState({ networkDesignInputs: { adaptersPerNode: 2, adapterSpeedGbps: 25 }, drDesignInputs: { strategy: 'none' } })
    expect(migrated.networkDesignInputs.intents).toHaveLength(1)
    expect(migrated.drDesignInputs.failoverHours).toBe(DEFAULT_DR_INPUTS.failoverHours)
    const state = payload()
    const reopened = parseProject(JSON.stringify(createProject(state)))
    expect(reopened.payload.networkDesignInputs.san.protocol).toBe('iscsi')
    expect(reopened.payload.networkDesignInputs.bmcPortsPerNode).toBe(2)
    expect(reopened.payload.drDesignInputs.restoreThroughputMBps).toBe(500)
    expect(normalizeProjectPayload({ ...state, networkDesignInputs: { adaptersPerNode: 4 } }).networkDesignInputs.intents).toHaveLength(2)
    const link = readSharedLink(toUrl({ ...state, vms: state.vms.slice(0, 5) }))!.scenario
    expect(link.networkDesignInputs?.san.protocol).toBe('iscsi')
    expect(link.drDesignInputs?.strategy).toBe('backup-only')
  })

  it('gives the same readiness, ports and recovery on the page data, report and workbook', () => {
    const state = payload()
    const design = resolvePlatformDesign(platformDesignInputs(state))
    const report = buildSolutionReport({ ...state, generatedAt: '2026-11-05T00:00:00.000Z' })
    const sheets = designWorkbookSheets(design, state.vms)
    const metric = (id: string, label: string) => report.sections.find((section) => section.id === id)!.metrics.find((item) => item.label === label)?.value
    const { readiness, network, recovery } = design.implementation
    expect(readiness!.ready).toBe(0)
    expect(metric('readiness', 'Review')).toBe(readiness!.review.toLocaleString('en-US'))
    expect(sheets.find((sheet) => sheet.name === 'Readiness')!.rows.find((row) => row[0] === 'Review')![1]).toBe(readiness!.review)
    expect(metric('network', 'Host switch ports')).toBe(network!.totalHostPorts.toLocaleString('en-US'))
    expect(metric('network', 'BMC ports')).toBe(network!.bmcPorts.toLocaleString('en-US'))
    expect(sheets.find((sheet) => sheet.name === 'Network')!.rows.find((row) => row[0] === 'BMC ports')![1]).toBe(network!.bmcPorts)
    expect(design.bom.lines.find((line) => /BMC/.test(line.item))!.quantity).toContain(`${network!.bmcPorts} in total`)
    expect(metric('recovery', 'Recovery estimate')).toBe(`${recovery!.estimatedRecoveryHours!.toLocaleString('en-US', { maximumFractionDigits: 1 })} hr`)
    expect(sheets.find((sheet) => sheet.name === 'Recovery')!.rows.find((row) => row[0] === 'Protected VMs')![1]).toBe(recovery!.protectedVms)
  })

  it('reports no protected scope or WAN verdict when no strategy is chosen', () => {
    const state = payload({ drDesignInputs: { ...DEFAULT_DR_INPUTS, strategy: 'none' } })
    const report = buildSolutionReport(state)
    const recovery = report.sections.find((section) => section.id === 'recovery')!
    expect(recovery.metrics.map((item) => item.label)).toEqual(['Strategy'])
    expect(JSON.stringify(recovery)).not.toMatch(/WAN passes|Protected VMs/)
  })

  it('uses the split design\'s storage for recovery, the same on every surface (F14)', () => {
    const state = payload({ placementInputs: { ...DEFAULT_PLACEMENT_INPUTS, clusterLayout: 'split', targetVmsPerCluster: 20 }, drDesignInputs: { ...DEFAULT_DR_INPUTS } })
    const design = resolvePlatformDesign(platformDesignInputs(state))
    expect(design.status).toBe('split')
    expect(design.implementation.recovery!.protectedStorageTiB).toBeCloseTo(design.storage!.requiredTiB, 6)
  })
})
