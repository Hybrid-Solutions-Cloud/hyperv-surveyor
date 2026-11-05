/**
 * Existing hardware: the hosts you already own, as clusters of host groups, and what they can carry.
 *
 * Two questions are answered here, for the existing-capacity and fit-workloads paths:
 *   - "I have hardware, what can it carry?"  capacity, headroom by resource, the first resource to run
 *     out, how many more VMs of a chosen profile fit, and the year growth uses each resource up.
 *   - "I have both. Does it fit?"  a verdict that reflects placement on real hosts, every limit and
 *     storage performance, with separate remedies for compute, storage and performance.
 *
 * Rules, stated once:
 *   SPARE HOSTS  Spare hosts are removed from the largest hosts first, for each resource on its own:
 *                for CPU the hosts with the most usable cores, for memory the hosts with the most
 *                usable memory. The result then holds whichever hosts are down.
 *   PLACEMENT    One cluster: every VM goes to it. More than one cluster: a VM whose source cluster
 *                matches a cluster name is placed there; every other VM is placed first-fit decreasing
 *                by its largest resource, into the first cluster with room. Each VM must fit on one
 *                host, and each cluster must hold its own limits.
 *
 * The function is pure. It never invents hardware: with no hosts entered it says so.
 */
import { computeDemand, giBToTiB, licensableCores, totalCores, usableCoresPerHost, usableRamPerHost } from './compute'
import { s2dCapacity, sanCapacityTiB, sanFreeSpaceTarget } from './capacity'
import { hybridS2dShareForTier, solveReverse } from './solve'
import { resolveGrowthPlan } from './growth'
import { LIMITS, RESILIENCY, TIER_IDS } from './rules'
import type {
  ClusterConfig, CpuVendor, Finding, NodeSpec, Resiliency, ReverseResult, S2dMedia, SanSpec,
  StorageArchitecture, TierId, TierPolicy, Vm,
} from './types'

// ---------------------------------------------------------------------------------------------
// Data shape
// ---------------------------------------------------------------------------------------------

/** Hosts of one specification inside a cluster. */
export interface HostGroup {
  id: string
  count: number
  sockets: number
  coresPerSocket: number
  ramGiB: number
  cpuVendor: CpuVendor
  /** Processor model as imported, kept so you can tell groups apart. */
  cpuModel?: string
}

/** S2D drives are per cluster: every host in a cluster carries the same capacity layout. */
export interface ExistingS2dLayout {
  media: S2dMedia
  capacityDrivesPerNode: number
  capacityDriveTB: number
  cacheDrivesPerNode: number
  cacheDriveTB: number
  /** Validated sustainable performance per host; 0 means not entered. */
  iopsPerNode: number
  throughputMBpsPerNode: number
}

export interface ExistingCluster {
  id: string
  name: string
  hostGroups: HostGroup[]
  /** Hosts kept free for failure or maintenance. Taken from the largest hosts first. */
  spareNodes: number
  architecture: StorageArchitecture
  resiliency: Resiliency
  nestedMapMirrorPct: 0.1 | 0.2 | 0.3
  s2d: ExistingS2dLayout
  /** This cluster's own array. Ignored when the SAN is shared. */
  san: SanSpec
}

/** Each cluster has its own array, or every SAN-backed cluster uses one shared array. */
export type SanScope = 'per-cluster' | 'shared'

/** The VM profile for "how many more fit": a tier's average, or your own numbers. */
export interface VmProfileChoice {
  mode: 'tier' | 'custom'
  /** The tier whose average is used, and whose vCPU ratio applies to a custom profile. */
  tier: TierId
  vCpu: number
  ramGiB: number
  storageGiB: number
  /** Optional sustained IOPS per VM; 0 means not limited by performance. */
  iops: number
}

export interface ExistingHardware {
  /** True once you entered or confirmed the hardware. */
  confirmed: boolean
  /** True when values carried over from an older project exactly equal the old built-in defaults. */
  looksLikeOldDefaults: boolean
  source: 'manual' | 'import' | 'migrated'
  clusters: ExistingCluster[]
  sanScope: SanScope
  sharedSan: SanSpec
  /** Processor vendor of the hosts the workloads move to. Drives the migration-readiness check. */
  targetCpuVendor: CpuVendor
  vmProfile: VmProfileChoice
  /** Host group whose specification compute remedies add. Absent means the most common one. */
  addSpecGroupId?: string
}

// ---------------------------------------------------------------------------------------------
// Defaults, migration and normalization
// ---------------------------------------------------------------------------------------------

/** The values the existing-hardware form used to be pre-filled with. Only used to recognise them. */
export const OLD_EXISTING_DEFAULTS = { nodes: 8, sockets: 2, coresPerSocket: 48, ramGiB: 1536, sanUsableTiB: 500, drr: 2.5, spareNodes: 2 } as const

export const DEFAULT_VM_PROFILE: VmProfileChoice = { mode: 'tier', tier: 'general', vCpu: 4, ramGiB: 16, storageGiB: 200, iops: 0 }

const BLANK_SAN: SanSpec = { usableTiB: 0, drr: 1, thinProvisioningSavings: 0, maxIops: 0, maxThroughputMBps: 0 }
const BLANK_S2D: ExistingS2dLayout = { media: 'all-flash', capacityDrivesPerNode: 0, capacityDriveTB: 0, cacheDrivesPerNode: 0, cacheDriveTB: 0, iopsPerNode: 0, throughputMBpsPerNode: 0 }

let seq = 0
const newId = (prefix: string) => {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

export function blankHostGroup(partial: Partial<HostGroup> = {}): HostGroup {
  return { id: newId('group'), count: 0, sockets: 0, coresPerSocket: 0, ramGiB: 0, cpuVendor: 'unknown', ...partial }
}

export function blankCluster(name = 'Cluster 1', partial: Partial<ExistingCluster> = {}): ExistingCluster {
  return {
    id: newId('cluster'),
    name,
    hostGroups: [blankHostGroup()],
    spareNodes: 1,
    architecture: 'san',
    resiliency: 'three-way-mirror',
    nestedMapMirrorPct: 0.1,
    s2d: { ...BLANK_S2D },
    san: { ...BLANK_SAN },
    ...partial,
  }
}

/** A blank profile: one cluster with one empty host group. Nothing is invented. */
export function blankExistingHardware(): ExistingHardware {
  return {
    confirmed: false,
    looksLikeOldDefaults: false,
    source: 'manual',
    clusters: [blankCluster()],
    sanScope: 'per-cluster',
    sharedSan: { ...BLANK_SAN },
    targetCpuVendor: 'unknown',
    vmProfile: { ...DEFAULT_VM_PROFILE },
  }
}

/** True when a one-cluster profile from an older project equals the old built-in defaults exactly. */
export function matchesOldDefaults(cfg: ClusterConfig, nodes: number): boolean {
  const d = OLD_EXISTING_DEFAULTS
  return nodes === d.nodes && cfg.architecture === 'san' && cfg.node.sockets === d.sockets
    && cfg.node.coresPerSocket === d.coresPerSocket && cfg.node.ramGiB === d.ramGiB
    && cfg.san.usableTiB === d.sanUsableTiB && cfg.san.drr === d.drr && cfg.spareNodes === d.spareNodes
}

/**
 * An older single-spec profile (one config and a host count) as one cluster with one host group.
 * The values stay as they were. When they equal the old defaults, the profile is not confirmed and a
 * notice asks you to confirm them.
 */
export function existingHardwareFromConfig(cfg: ClusterConfig, nodes: number): ExistingHardware {
  const count = Math.max(0, Math.round(Number.isFinite(nodes) ? nodes : 0))
  const looksLikeOldDefaults = matchesOldDefaults(cfg, count)
  return {
    confirmed: !looksLikeOldDefaults,
    looksLikeOldDefaults,
    source: 'migrated',
    clusters: [{
      id: 'cluster-1',
      name: 'Cluster 1',
      hostGroups: [{ id: 'group-1', count, sockets: cfg.node.sockets, coresPerSocket: cfg.node.coresPerSocket, ramGiB: cfg.node.ramGiB, cpuVendor: 'unknown' }],
      spareNodes: Math.max(0, Math.round(cfg.spareNodes)),
      architecture: cfg.architecture,
      resiliency: cfg.resiliency,
      nestedMapMirrorPct: cfg.nestedMapMirrorPct,
      s2d: {
        media: cfg.node.media,
        capacityDrivesPerNode: cfg.node.capacityDrivesPerNode,
        capacityDriveTB: cfg.node.capacityDriveTB,
        cacheDrivesPerNode: cfg.node.cacheDrivesPerNode,
        cacheDriveTB: cfg.node.cacheDriveTB,
        iopsPerNode: cfg.node.s2dIopsPerNode ?? 0,
        throughputMBpsPerNode: cfg.node.s2dThroughputMBpsPerNode ?? 0,
      },
      san: { ...cfg.san },
    }],
    sanScope: 'per-cluster',
    sharedSan: { ...cfg.san },
    // The old form had no vendor field and fixed AMD, so it was never your answer.
    targetCpuVendor: 'unknown',
    vmProfile: { ...DEFAULT_VM_PROFILE },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const num = (value: unknown, fallback = 0, min = 0) => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? Math.max(min, parsed) : fallback
}
const vendor = (value: unknown): CpuVendor => value === 'intel' || value === 'amd' ? value : 'unknown'
const ARCHITECTURES: StorageArchitecture[] = ['san', 's2d', 'hybrid']

function normalizeSan(value: unknown, fallback: SanSpec): SanSpec {
  const input = isRecord(value) ? value : {}
  return {
    usableTiB: num(input.usableTiB, fallback.usableTiB),
    drr: Math.max(1, num(input.drr, fallback.drr, 1)),
    thinProvisioningSavings: num(input.thinProvisioningSavings, fallback.thinProvisioningSavings),
    maxIops: num(input.maxIops, fallback.maxIops ?? 0),
    maxThroughputMBps: num(input.maxThroughputMBps, fallback.maxThroughputMBps ?? 0),
  }
}

function normalizeCluster(value: unknown, index: number): ExistingCluster | null {
  if (!isRecord(value)) return null
  const blank = blankCluster(`Cluster ${index + 1}`)
  const groups = Array.isArray(value.hostGroups) ? value.hostGroups.filter(isRecord).map((group, groupIndex): HostGroup => ({
    id: typeof group.id === 'string' ? group.id : `group-${index + 1}-${groupIndex + 1}`,
    count: Math.round(num(group.count)),
    sockets: Math.round(num(group.sockets)),
    coresPerSocket: Math.round(num(group.coresPerSocket)),
    ramGiB: num(group.ramGiB),
    cpuVendor: vendor(group.cpuVendor),
    ...(typeof group.cpuModel === 'string' && group.cpuModel ? { cpuModel: group.cpuModel } : {}),
  })) : []
  const s2d = isRecord(value.s2d) ? value.s2d : {}
  const resiliency = typeof value.resiliency === 'string' && value.resiliency in RESILIENCY ? value.resiliency as Resiliency : blank.resiliency
  const mirror = value.nestedMapMirrorPct === 0.2 || value.nestedMapMirrorPct === 0.3 ? value.nestedMapMirrorPct : 0.1
  return {
    id: typeof value.id === 'string' ? value.id : `cluster-${index + 1}`,
    name: typeof value.name === 'string' && value.name.trim() ? value.name : `Cluster ${index + 1}`,
    hostGroups: groups.length > 0 ? groups : [blankHostGroup()],
    spareNodes: Math.round(num(value.spareNodes, blank.spareNodes)),
    architecture: ARCHITECTURES.includes(value.architecture as StorageArchitecture) ? value.architecture as StorageArchitecture : 'san',
    resiliency,
    nestedMapMirrorPct: mirror,
    s2d: {
      media: s2d.media === 'hybrid' ? 'hybrid' : 'all-flash',
      capacityDrivesPerNode: Math.round(num(s2d.capacityDrivesPerNode)),
      capacityDriveTB: num(s2d.capacityDriveTB),
      cacheDrivesPerNode: Math.round(num(s2d.cacheDrivesPerNode)),
      cacheDriveTB: num(s2d.cacheDriveTB),
      iopsPerNode: num(s2d.iopsPerNode),
      throughputMBpsPerNode: num(s2d.throughputMBpsPerNode),
    },
    san: normalizeSan(value.san, BLANK_SAN),
  }
}

function normalizeProfile(value: unknown): VmProfileChoice {
  const input = isRecord(value) ? value : {}
  const tier = TIER_IDS.includes(input.tier as TierId) ? input.tier as TierId : DEFAULT_VM_PROFILE.tier
  return {
    mode: input.mode === 'custom' ? 'custom' : 'tier',
    tier,
    vCpu: num(input.vCpu, DEFAULT_VM_PROFILE.vCpu),
    ramGiB: num(input.ramGiB, DEFAULT_VM_PROFILE.ramGiB),
    storageGiB: num(input.storageGiB, DEFAULT_VM_PROFILE.storageGiB),
    iops: num(input.iops, 0),
  }
}

/**
 * Saved existing hardware in the current shape. A save without it is migrated from the older
 * single-spec fields (legacyCfg and legacyNodes); with neither, the profile starts blank.
 */
export function normalizeExistingHardware(value: unknown, legacyCfg?: ClusterConfig, legacyNodes?: number): ExistingHardware {
  if (isRecord(value) && Array.isArray(value.clusters)) {
    const clusters = value.clusters.map(normalizeCluster).filter((cluster): cluster is ExistingCluster => cluster !== null)
    return {
      confirmed: value.confirmed === true,
      looksLikeOldDefaults: value.looksLikeOldDefaults === true,
      source: value.source === 'import' || value.source === 'migrated' ? value.source : 'manual',
      clusters: clusters.length > 0 ? clusters : [blankCluster()],
      sanScope: value.sanScope === 'shared' ? 'shared' : 'per-cluster',
      sharedSan: normalizeSan(value.sharedSan, BLANK_SAN),
      targetCpuVendor: vendor(value.targetCpuVendor),
      vmProfile: normalizeProfile(value.vmProfile),
      ...(typeof value.addSpecGroupId === 'string' ? { addSpecGroupId: value.addSpecGroupId } : {}),
    }
  }
  if (legacyCfg) return existingHardwareFromConfig(legacyCfg, legacyNodes ?? 0)
  return blankExistingHardware()
}

// ---------------------------------------------------------------------------------------------
// Fill from import
// ---------------------------------------------------------------------------------------------

/** The vHost fields the fill reads. HostRecord from the RVTools import has them all. */
export interface ImportedHost {
  name: string
  cluster: string
  sockets: number
  coresPerSocket: number
  totalCores?: number
  ramGiB: number
  cpuModel: string
  cpuVendor?: CpuVendor
}

/** CPU vendor from a processor model string. */
export function cpuVendorFromCpuModel(model: string): CpuVendor {
  return /amd|epyc|opteron|ryzen/i.test(model) ? 'amd' : /intel|xeon/i.test(model) ? 'intel' : 'unknown'
}

/**
 * Host groups from imported hosts: one cluster per source cluster, and inside each cluster one group
 * per matching specification (sockets, cores per socket, memory to the nearest GiB, CPU vendor).
 * Storage and spares come from the profile you already have, so nothing you typed is lost; a new
 * cluster copies the first cluster's storage settings.
 */
export function existingHardwareFromImport(hosts: ImportedHost[], current: ExistingHardware): ExistingHardware {
  const usable = hosts.filter((host) => host.sockets > 0 && (host.coresPerSocket > 0 || (host.totalCores ?? 0) > 0) && host.ramGiB > 0)
  if (usable.length === 0) return current
  const template = current.clusters[0] ?? blankCluster()
  const byCluster = new Map<string, ImportedHost[]>()
  usable.forEach((host) => {
    const name = host.cluster.trim() || 'Standalone hosts'
    byCluster.set(name, [...(byCluster.get(name) ?? []), host])
  })
  const clusters: ExistingCluster[] = [...byCluster.entries()].map(([name, members], index) => {
    const previous = current.clusters.find((cluster) => cluster.name.toLowerCase() === name.toLowerCase())
    const base = previous ?? template
    const groups = new Map<string, HostGroup>()
    members.forEach((host) => {
      const coresPerSocket = host.coresPerSocket > 0 ? host.coresPerSocket : Math.round((host.totalCores ?? 0) / host.sockets)
      const ramGiB = Math.round(host.ramGiB)
      const hostVendor = host.cpuVendor && host.cpuVendor !== 'unknown' ? host.cpuVendor : cpuVendorFromCpuModel(host.cpuModel)
      const key = `${host.sockets}|${coresPerSocket}|${ramGiB}|${hostVendor}`
      const group = groups.get(key)
      if (group) group.count += 1
      else groups.set(key, { id: `group-${index + 1}-${groups.size + 1}`, count: 1, sockets: host.sockets, coresPerSocket, ramGiB, cpuVendor: hostVendor, ...(host.cpuModel ? { cpuModel: host.cpuModel } : {}) })
    })
    const hostGroups = [...groups.values()].sort((a, b) => b.count - a.count)
    const hostCount = members.length
    return {
      ...structuredClone(base),
      id: previous?.id ?? `cluster-${index + 1}`,
      name,
      hostGroups,
      spareNodes: Math.min(base.spareNodes, Math.max(0, hostCount - 1)),
    }
  })
  const vendorCounts = new Map<CpuVendor, number>()
  clusters.forEach((cluster) => cluster.hostGroups.forEach((group) => {
    if (group.cpuVendor !== 'unknown') vendorCounts.set(group.cpuVendor, (vendorCounts.get(group.cpuVendor) ?? 0) + group.count)
  }))
  const detectedVendor = [...vendorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return {
    ...current,
    confirmed: true,
    looksLikeOldDefaults: false,
    source: 'import',
    clusters,
    targetCpuVendor: detectedVendor ?? current.targetCpuVendor,
    addSpecGroupId: undefined,
  }
}

// ---------------------------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------------------------

const groupHasSpec = (group: HostGroup) => group.count >= 1 && group.sockets >= 1 && group.coresPerSocket >= 1 && group.ramGiB > 0
export const clusterHostCount = (cluster: ExistingCluster) => cluster.hostGroups.filter(groupHasSpec).reduce((sum, group) => sum + Math.round(group.count), 0)
export const totalHostCount = (hardware: ExistingHardware) => hardware.clusters.reduce((sum, cluster) => sum + clusterHostCount(cluster), 0)

/** True once at least one host with sockets, cores and memory is entered. */
export function hardwareEntered(hardware: ExistingHardware): boolean {
  return hardware.clusters.some((cluster) => clusterHostCount(cluster) > 0)
}

function usesSan(architecture: StorageArchitecture) {
  return architecture === 'san' || architecture === 'hybrid'
}
function usesS2d(architecture: StorageArchitecture) {
  return architecture === 's2d' || architecture === 'hybrid'
}

/** The most common host group across every cluster, the default specification to add. */
export function mostCommonHostGroup(hardware: ExistingHardware): { cluster: ExistingCluster; group: HostGroup } | null {
  let best: { cluster: ExistingCluster; group: HostGroup } | null = null
  hardware.clusters.forEach((cluster) => cluster.hostGroups.filter(groupHasSpec).forEach((group) => {
    if (!best || group.count > best.group.count) best = { cluster, group }
  }))
  return best
}

export function hostGroupLabel(group: Pick<HostGroup, 'sockets' | 'coresPerSocket' | 'ramGiB' | 'cpuVendor'>): string {
  const vendorText = group.cpuVendor !== 'unknown' ? ` ${group.cpuVendor.toUpperCase()}` : ''
  return `${group.sockets} × ${group.coresPerSocket} cores, ${Math.round(group.ramGiB).toLocaleString('en-US')} GiB${vendorText}`
}

function nodeFor(group: Pick<HostGroup, 'sockets' | 'coresPerSocket' | 'ramGiB'>, cfg: ClusterConfig): NodeSpec {
  return { ...cfg.node, sockets: group.sockets, coresPerSocket: group.coresPerSocket, ramGiB: group.ramGiB }
}

/**
 * The configuration the engine uses for one cluster: your planning assumptions, this cluster's storage
 * and spares, and a host specification for per-VM checks made of the most cores and the most memory
 * any host in the cluster has. Per-VM fit on one real host is checked separately, host by host.
 */
export function clusterConfig(policy: ClusterConfig, hardware: ExistingHardware, cluster: ExistingCluster): ClusterConfig {
  const groups = cluster.hostGroups.filter(groupHasSpec)
  const mostCores = groups.reduce<HostGroup | null>((best, group) => !best || totalCores(nodeFor(group, policy)) > totalCores(nodeFor(best, policy)) ? group : best, null)
  const mostRam = groups.reduce((max, group) => Math.max(max, group.ramGiB), 0)
  return {
    ...policy,
    architecture: cluster.architecture,
    resiliency: cluster.resiliency,
    nestedMapMirrorPct: cluster.nestedMapMirrorPct,
    spareNodes: cluster.spareNodes,
    sanSizingMode: 'fixed',
    nodeCeiling: undefined,
    node: {
      ...policy.node,
      sockets: mostCores?.sockets ?? 0,
      coresPerSocket: mostCores?.coresPerSocket ?? 0,
      ramGiB: mostRam,
      media: cluster.s2d.media,
      capacityDrivesPerNode: cluster.s2d.capacityDrivesPerNode,
      capacityDriveTB: cluster.s2d.capacityDriveTB,
      cacheDrivesPerNode: cluster.s2d.cacheDrivesPerNode,
      cacheDriveTB: cluster.s2d.cacheDriveTB,
      s2dIopsPerNode: cluster.s2d.iopsPerNode,
      s2dThroughputMBpsPerNode: cluster.s2d.throughputMBpsPerNode,
      cpuVendor: hardware.targetCpuVendor,
    },
    san: hardware.sanScope === 'shared' ? { ...hardware.sharedSan } : { ...cluster.san },
  }
}

export interface ClusterComputeCapacity {
  hosts: number
  spareNodes: number
  workloadNodes: number
  availablePCores: number
  availableRamGiB: number
}

/** Compute capacity of a set of host groups, with spares removed from the largest hosts first. */
export function computeCapacityOf(groups: Array<Pick<HostGroup, 'count' | 'sockets' | 'coresPerSocket' | 'ramGiB'>>, spareNodes: number, cfg: ClusterConfig): ClusterComputeCapacity {
  const cores: number[] = []
  const ram: number[] = []
  groups.filter((group) => group.count >= 1 && group.sockets >= 1 && group.coresPerSocket >= 1 && group.ramGiB > 0).forEach((group) => {
    const node = nodeFor(group, cfg)
    const hostCores = usableCoresPerHost(node, cfg)
    const hostRam = usableRamPerHost(node, cfg)
    for (let i = 0; i < Math.round(group.count); i++) { cores.push(hostCores); ram.push(hostRam) }
  })
  const hosts = cores.length
  const spare = Math.min(Math.max(0, Math.round(spareNodes)), hosts)
  const sumWithoutLargest = (values: number[]) => values.sort((a, b) => b - a).slice(spare).reduce((sum, value) => sum + value, 0)
  return { hosts, spareNodes: spare, workloadNodes: hosts - spare, availablePCores: sumWithoutLargest(cores), availableRamGiB: sumWithoutLargest(ram) }
}

/** True when a VM's configured vCPU and memory fit on at least one host of the cluster. */
function fitsOneHost(vm: Pick<Vm, 'vCpu' | 'ramGiB'>, cluster: ExistingCluster, cfg: ClusterConfig): boolean {
  return cluster.hostGroups.filter(groupHasSpec).some((group) => {
    const node = nodeFor(group, cfg)
    return vm.vCpu <= totalCores(node) * cfg.smtFactor && vm.ramGiB <= usableRamPerHost(node, cfg)
  })
}

function largestHostText(cluster: ExistingCluster, cfg: ClusterConfig): string {
  const groups = cluster.hostGroups.filter(groupHasSpec)
  if (groups.length === 0) return 'no hosts'
  const cores = Math.max(...groups.map((group) => totalCores(nodeFor(group, cfg)) * cfg.smtFactor))
  const ram = Math.max(...groups.map((group) => usableRamPerHost(nodeFor(group, cfg), cfg)))
  return `${Math.round(cores)} cores and ${Math.round(ram).toLocaleString('en-US')} GiB usable memory on its largest host`
}

// ---------------------------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------------------------

export type ExistingResource = 'cpu' | 'memory' | 's2d-storage' | 'san-storage' | 's2d-iops' | 's2d-throughput' | 'san-iops' | 'san-throughput' | 'vm-count'

export const RESOURCE_LABELS: Record<ExistingResource, string> = {
  cpu: 'CPU',
  memory: 'Memory',
  's2d-storage': 'S2D storage',
  'san-storage': 'SAN storage',
  's2d-iops': 'S2D IOPS',
  's2d-throughput': 'S2D throughput',
  'san-iops': 'SAN IOPS',
  'san-throughput': 'SAN throughput',
  'vm-count': 'VMs per host limit',
}

export interface ResourceRow {
  resource: ExistingResource
  label: string
  unit: string
  available: number
  used: number
  headroom: number
  /** Used share of the whole estate. */
  pct: number
  /** Used share in the fullest cluster. VMs do not move between clusters, so this is what runs out first. */
  worstPct: number
  worstCluster: string | null
  /** Year it runs out at the entered annual growth: 0 means already short, null means not within the search. */
  exhaustionYear: number | null
}

export interface UnplacedVm {
  id: string
  name: string
  vCpu: number
  ramGiB: number
  reason: 'larger-than-any-host' | 'larger-than-source-hosts' | 'no-room'
  detail: string
}

export interface ExistingClusterResult {
  id: string
  name: string
  hosts: number
  spareNodes: number
  workloadNodes: number
  hostGroups: HostGroup[]
  cfg: ClusterConfig
  vms: Vm[]
  fixedVms: Vm[]
  /** VMs placed here because their source cluster matches. */
  sourceMatched: number
  reverse: ReverseResult
  /** Null when nothing is placed on the cluster. */
  fits: boolean | null
  licensableCores: number
  nodeLimit: number
}

export interface ComputeRemedy {
  cluster: string
  hostsToAdd: number
  spec: Pick<HostGroup, 'sockets' | 'coresPerSocket' | 'ramGiB' | 'cpuVendor'>
  specLabel: string
  /** True when the cluster would pass its node limit; the hosts then need another cluster. */
  overNodeLimit: boolean
  nodeLimit: number
  reason: string
}

export interface StorageRemedy {
  scope: string
  domain: 'san' | 's2d'
  shortTiB: number
  /** SAN: usable capacity to add to fit, and to keep the free-space target. */
  sanUsableToAddTiB?: number
  sanUsableToTargetTiB?: number
  /** S2D: capacity drives per host needed at the current drive size, or hosts to add with the same drives. */
  s2dDrivesPerHost?: number | null
  s2dHostsToAdd?: number | null
  detail: string
}

export interface PerformanceRemedy {
  scope: string
  domain: 'san' | 's2d'
  metric: 'iops' | 'throughput'
  required: number
  available: number
  shortfall: number
  /** S2D only: hosts to add at the entered per-host figure. */
  s2dHostsToAdd?: number | null
  detail: string
}

export interface WhatToAddItem {
  category: 'compute' | 'storage' | 'performance' | 'vm'
  scope: string
  quantity: number
  unit: string
  item: string
  detail: string
}

export interface ProfileFit {
  label: string
  vCpu: number
  ramGiB: number
  storageGiB: number
  /** Per-VM demand in physical cores and memory after the tier policy. */
  pCores: number
  demandRamGiB: number
  count: number
  limitedBy: ExistingResource | 'host-size' | null
  perCluster: Array<{ cluster: string; count: number }>
  note: string
}

export interface ExistingGrowthYear {
  year: number
  demandFactor: number
  worstResource: ExistingResource | null
  worstPct: number
  fits: boolean
  hostsToAdd: number | null
}

export type ExistingVerdict = 'no-hardware' | 'no-workload' | 'fits' | 'does-not-fit'

export interface ExistingAssessment {
  verdict: ExistingVerdict
  headline: string
  explanation: string
  entered: boolean
  confirmed: boolean
  looksLikeOldDefaults: boolean
  notices: string[]
  clusters: ExistingClusterResult[]
  totalHosts: number
  workloadHosts: number
  includedVms: number
  managementVms: number
  placement: { method: 'single' | 'multi'; sourceMatched: number; firstFit: number; rule: string }
  unplaced: UnplacedVm[]
  resources: ResourceRow[]
  firstToRunOut: ResourceRow | null
  profile: ProfileFit
  annualGrowthPct: number
  growthYears: ExistingGrowthYear[]
  remedies: { compute: ComputeRemedy[]; storage: StorageRemedy[]; performance: PerformanceRemedy[]; unplaceable: UnplacedVm[]; blockers: string[] }
  whatToAdd: WhatToAddItem[]
  findings: Finding[]
  /** Sum of licensable cores over every entered host. */
  licensableCores: number
  addSpec: { group: HostGroup; cluster: string } | null
  spareRule: string
  /**
   * More VMs per tier at each tier's average profile. Each cluster's answer is summed, then capped by
   * a shared array's room and IOPS, which the clusters use together.
   */
  additionalVmsByTier: Record<TierId, number>
  /** How the run-out year is worked out. */
  exhaustionNote: string
}

export const SPARE_RULE = 'Spare hosts are removed from the largest hosts first, for each resource on its own: the hosts with the most usable cores for CPU and the hosts with the most usable memory for memory. The result holds whichever hosts are down.'
export const PLACEMENT_RULE = 'With more than one cluster, a VM whose source cluster matches a cluster name is placed there. Every other VM is placed first-fit decreasing by its largest resource, into the first cluster with room. Each VM must fit on one host.'

const EXHAUSTION_SEARCH_YEARS = 50
const fmt = (value: number, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits })
const plural = (count: number, word: string) => `${fmt(count)} ${word}${count === 1 ? '' : 's'}`

interface VmNeed {
  vm: Vm
  fixed: boolean
  pCores: number
  ramGiB: number
  storageGiB: number
}

function storageSplit(architecture: StorageArchitecture, cfg: ClusterConfig, policy: TierPolicy, storageGiB: number) {
  const s2dShare = architecture === 's2d' ? 1 : architecture === 'san' ? 0 : hybridS2dShareForTier(cfg, policy)
  return { s2dTiB: giBToTiB(storageGiB) * s2dShare, sanTiB: giBToTiB(storageGiB) * (1 - s2dShare) }
}

interface ClusterRoom {
  cluster: ExistingCluster
  cfg: ClusterConfig
  capacity: ClusterComputeCapacity
  cores: number
  ram: number
  s2d: number
  san: number
  vmSlots: number
}

/** First-fit decreasing placement over several clusters. Returns VM lists per cluster id. */
function placeVms(
  needs: VmNeed[],
  rooms: ClusterRoom[],
  sharedSan: { remaining: number } | null,
  tiers: Record<TierId, TierPolicy>,
): { placed: Map<string, VmNeed[]>; unplaced: UnplacedVm[]; sourceMatched: number; firstFit: number; overflow: VmNeed[] } {
  const placed = new Map<string, VmNeed[]>(rooms.map((room) => [room.cluster.id, []]))
  const unplaced: UnplacedVm[] = []
  const overflow: VmNeed[] = []
  let sourceMatched = 0
  let firstFit = 0
  const byName = new Map(rooms.map((room) => [room.cluster.name.trim().toLowerCase(), room]))
  const take = (room: ClusterRoom, need: VmNeed) => {
    const split = storageSplit(room.cluster.architecture, room.cfg, tiers[need.vm.tier], need.storageGiB)
    room.cores -= need.pCores
    room.ram -= need.ramGiB
    room.s2d -= split.s2dTiB
    if (sharedSan && usesSan(room.cluster.architecture)) sharedSan.remaining -= split.sanTiB
    else room.san -= split.sanTiB
    room.vmSlots -= 1
    placed.get(room.cluster.id)!.push(need)
  }
  const hasRoom = (room: ClusterRoom, need: VmNeed) => {
    const split = storageSplit(room.cluster.architecture, room.cfg, tiers[need.vm.tier], need.storageGiB)
    const sanLeft = sharedSan && usesSan(room.cluster.architecture) ? sharedSan.remaining : room.san
    return need.pCores <= room.cores + 1e-9 && need.ramGiB <= room.ram + 1e-9 && room.vmSlots >= 1
      && split.s2dTiB <= room.s2d + 1e-9 && split.sanTiB <= sanLeft + 1e-9
  }
  // 1. Source cluster first. A VM stays with its source cluster even when that cluster is full.
  const rest: VmNeed[] = []
  for (const need of needs) {
    const source = need.vm.sourceCluster?.trim().toLowerCase()
    const room = source ? byName.get(source) : undefined
    if (!room || need.fixed) { rest.push(need); continue }
    if (!fitsOneHost(need.vm, room.cluster, room.cfg)) {
      unplaced.push({ id: need.vm.id, name: need.vm.name, vCpu: need.vm.vCpu, ramGiB: need.vm.ramGiB, reason: 'larger-than-source-hosts', detail: `Larger than any host in its source cluster ${room.cluster.name}, which has ${largestHostText(room.cluster, room.cfg)}.` })
      continue
    }
    take(room, need)
    sourceMatched += 1
  }
  // 2. First-fit decreasing by the largest resource, as a share of the whole estate.
  const totals = rooms.reduce((sum, room) => ({ cores: sum.cores + Math.max(0, room.capacity.availablePCores), ram: sum.ram + Math.max(0, room.capacity.availableRamGiB) }), { cores: 0, ram: 0 })
  const totalStorage = rooms.reduce((sum, room) => sum + Math.max(0, room.s2d) + (sharedSan ? 0 : Math.max(0, room.san)), sharedSan ? Math.max(0, sharedSan.remaining) : 0)
  const largestShare = (need: VmNeed) => Math.max(
    totals.cores > 0 ? need.pCores / totals.cores : 0,
    totals.ram > 0 ? need.ramGiB / totals.ram : 0,
    totalStorage > 0 ? giBToTiB(need.storageGiB) / totalStorage : 0,
  )
  rest.sort((a, b) => largestShare(b) - largestShare(a) || a.vm.name.localeCompare(b.vm.name))
  for (const need of rest) {
    const candidates = rooms.filter((room) => fitsOneHost(need.vm, room.cluster, room.cfg))
    if (candidates.length === 0) {
      unplaced.push({ id: need.vm.id, name: need.vm.name, vCpu: need.vm.vCpu, ramGiB: need.vm.ramGiB, reason: 'larger-than-any-host', detail: `${need.vm.vCpu} vCPU and ${fmt(need.vm.ramGiB)} GiB is larger than any entered host.` })
      continue
    }
    const room = candidates.find((candidate) => hasRoom(candidate, need))
    if (room) { take(room, need); firstFit += 1; continue }
    if (need.fixed) {
      // Management VMs are always counted: they go where they fit one host, even if that cluster is full.
      take(candidates[0], need)
      continue
    }
    overflow.push(need)
    unplaced.push({ id: need.vm.id, name: need.vm.name, vCpu: need.vm.vCpu, ramGiB: need.vm.ramGiB, reason: 'no-room', detail: 'No cluster has room left for it. The compute remedy below counts it.' })
  }
  return { placed, unplaced, sourceMatched, firstFit, overflow }
}

/** Smallest number of hosts of a spec that makes a cluster carry the given compute demand. */
function hostsToCarry(
  cluster: ExistingCluster,
  cfg: ClusterConfig,
  spec: Pick<HostGroup, 'sockets' | 'coresPerSocket' | 'ramGiB'>,
  demand: { cores: number; ram: number; vms: number },
): number | null {
  const fits = (extra: number) => {
    const capacity = computeCapacityOf([...cluster.hostGroups, { ...spec, count: extra }], cluster.spareNodes, cfg)
    return demand.cores <= capacity.availablePCores + 1e-9 && demand.ram <= capacity.availableRamGiB + 1e-9 && demand.vms <= capacity.workloadNodes * LIMITS.MAX_VMS_PER_HOST
  }
  if (fits(0)) return 0
  for (let extra = 1; extra <= 512; extra++) if (fits(extra)) return extra
  return null
}

function clusterNodeLimit(cfg: ClusterConfig) {
  return usesS2d(cfg.architecture) ? Math.min(LIMITS.S2D_MAX_NODES, RESILIENCY[cfg.resiliency].maxNodes) : LIMITS.CLUSTER_MAX_NODES
}

export interface ExistingAssessmentInput {
  hardware: ExistingHardware
  /** Planning assumptions: reserves, growth, sizing basis, free-space target, hybrid split share. */
  policy: ClusterConfig
  tiers: Record<TierId, TierPolicy>
  vms: Vm[]
  /** VMs at a fixed size that share this hardware, such as the management plane. */
  fixedVms?: Vm[]
}

/** Workload VMs at a growth factor, counted the same way for remedies and growth years. */
function grownVmCount(vms: Vm[], factor: number): number {
  return Math.ceil(vms.length * factor)
}

/** Per-VM demand as the engine counts it, at a growth factor. */
function vmNeed(vm: Vm, tiers: Record<TierId, TierPolicy>, factor: number, policy: ClusterConfig, fixed: boolean): VmNeed {
  const demand = computeDemand([vm], tiers, factor, policy)
  return { vm, fixed, pCores: demand.requiredPCores, ramGiB: demand.requiredRamGiB, storageGiB: demand.byTier[vm.tier].storageGiB }
}

export function assessExistingHardware(input: ExistingAssessmentInput): ExistingAssessment {
  const { hardware, policy, tiers } = input
  const fixedVms = (input.fixedVms ?? []).filter((vm) => vm.include)
  const workloadVms = input.vms.filter((vm) => vm.include)
  const growth = resolveGrowthPlan(policy)
  const factor = growth.currentDesignGrowthFactor
  // Demand in a given year starts from the base factor; build-now already carries the horizon in factor.
  const yearDemandFactor = (year: number) => growth.baseGrowthFactor * (1 + growth.annualGrowthPct) ** year
  const entered = hardwareEntered(hardware)
  const activeClusters = hardware.clusters.filter((cluster) => clusterHostCount(cluster) > 0)
  const notices: string[] = []
  if (hardware.looksLikeOldDefaults && !hardware.confirmed) {
    notices.push(`These values look like the old built-in defaults (${OLD_EXISTING_DEFAULTS.nodes} hosts of ${OLD_EXISTING_DEFAULTS.sockets} × ${OLD_EXISTING_DEFAULTS.coresPerSocket} cores, ${fmt(OLD_EXISTING_DEFAULTS.ramGiB)} GiB, a ${OLD_EXISTING_DEFAULTS.sanUsableTiB} TiB array). Confirm they are your hardware or change them.`)
  }
  const multi = activeClusters.length > 1
  const sharedSan = hardware.sanScope === 'shared' && activeClusters.filter((cluster) => usesSan(cluster.architecture)).length > 0
  if (sharedSan && !(hardware.sharedSan.usableTiB > 0)) notices.push('Enter the shared array\'s usable capacity. Until then it counts as 0 TiB.')
  activeClusters.forEach((cluster) => {
    const prefix = multi ? `${cluster.name}: ` : ''
    if (usesSan(cluster.architecture) && !sharedSan && !(cluster.san.usableTiB > 0)) notices.push(`${prefix}enter the array's usable capacity. Until then it counts as 0 TiB.`.replace(/^e/, multi ? 'e' : 'E'))
    if (cluster.spareNodes >= clusterHostCount(cluster)) notices.push(`${prefix}every host is a spare (${cluster.spareNodes} spare of ${clusterHostCount(cluster)}), so no host is left to carry workload. Lower the spare hosts or add hosts.`.replace(/^e/, multi ? 'e' : 'E'))
    if (usesS2d(cluster.architecture) && !(cluster.s2d.capacityDrivesPerNode > 0 && cluster.s2d.capacityDriveTB > 0)) notices.push(`${prefix}enter the S2D capacity drives per host and their size. Until then S2D counts as 0 TiB.`.replace(/^e/, multi ? 'e' : 'E'))
  })

  const configs = new Map(activeClusters.map((cluster) => [cluster.id, clusterConfig(policy, hardware, cluster)]))
  const capacities = new Map(activeClusters.map((cluster) => [cluster.id, computeCapacityOf(cluster.hostGroups, cluster.spareNodes, configs.get(cluster.id)!)]))
  const s2dUsable = (cluster: ExistingCluster) => usesS2d(cluster.architecture) ? s2dCapacity(configs.get(cluster.id)!, clusterHostCount(cluster)).usableTiB : 0
  const sharedSanEffective = sanCapacityTiB(hardware.sharedSan)

  // Placement.
  const needs = [
    ...workloadVms.map((vm) => vmNeed(vm, tiers, factor, policy, false)),
    ...fixedVms.map((vm) => vmNeed(vm, tiers, 1, policy, true)),
  ]
  const rooms: ClusterRoom[] = activeClusters.map((cluster) => {
    const capacity = capacities.get(cluster.id)!
    return {
      cluster,
      cfg: configs.get(cluster.id)!,
      capacity,
      cores: capacity.availablePCores,
      ram: capacity.availableRamGiB,
      s2d: s2dUsable(cluster),
      san: usesSan(cluster.architecture) && !sharedSan ? sanCapacityTiB(cluster.san) : 0,
      vmSlots: Math.min(capacity.workloadNodes * LIMITS.MAX_VMS_PER_HOST, LIMITS.MAX_VMS_PER_CLUSTER),
    }
  })
  let placed = new Map<string, VmNeed[]>()
  let unplaced: UnplacedVm[] = []
  let overflow: VmNeed[] = []
  let sourceMatched = 0
  let firstFit = 0
  if (rooms.length === 1) {
    const room = rooms[0]
    const list: VmNeed[] = []
    needs.forEach((need) => {
      if (fitsOneHost(need.vm, room.cluster, room.cfg)) list.push(need)
      else unplaced.push({ id: need.vm.id, name: need.vm.name, vCpu: need.vm.vCpu, ramGiB: need.vm.ramGiB, reason: 'larger-than-any-host', detail: `${need.vm.vCpu} vCPU and ${fmt(need.vm.ramGiB)} GiB is larger than any host, which has ${largestHostText(room.cluster, room.cfg)}. Adding hosts does not help.` })
    })
    placed.set(room.cluster.id, list)
  } else if (rooms.length > 1) {
    const result = placeVms(needs, rooms, sharedSan ? { remaining: sharedSanEffective } : null, tiers)
    placed = result.placed
    unplaced = result.unplaced
    overflow = result.overflow
    sourceMatched = result.sourceMatched
    firstFit = result.firstFit
  }

  // Per-cluster results on the engine's reverse solve, with compute capacity from the host groups.
  const clusters: ExistingClusterResult[] = activeClusters.map((cluster) => {
    const cfg = configs.get(cluster.id)!
    const capacity = capacities.get(cluster.id)!
    const list = placed.get(cluster.id) ?? []
    const clusterVms = list.filter((need) => !need.fixed).map((need) => need.vm)
    const clusterFixed = list.filter((need) => need.fixed).map((need) => need.vm)
    const reverse = solveReverse(cfg, capacity.hosts, clusterVms, tiers, clusterFixed, capacity)
    const nothing = clusterVms.length === 0 && clusterFixed.length === 0
    return {
      id: cluster.id,
      name: cluster.name,
      hosts: capacity.hosts,
      spareNodes: capacity.spareNodes,
      workloadNodes: capacity.workloadNodes,
      hostGroups: cluster.hostGroups.filter(groupHasSpec),
      cfg,
      vms: clusterVms,
      fixedVms: clusterFixed,
      sourceMatched: rooms.length > 1 ? clusterVms.filter((vm) => vm.sourceCluster?.trim().toLowerCase() === cluster.name.trim().toLowerCase()).length : clusterVms.length,
      reverse,
      fits: nothing ? (reverse.blockers.length > 0 ? false : null) : reverse.status === 'fits',
      licensableCores: cluster.hostGroups.filter(groupHasSpec).reduce((sum, group) => sum + licensableCores(nodeFor(group, cfg)) * Math.round(group.count), 0),
      nodeLimit: clusterNodeLimit(cfg),
    }
  })

  // Findings: every cluster's, named when there is more than one, plus estate-level checks.
  const findings: Finding[] = []
  const seen = new Set<string>()
  clusters.forEach((cluster) => cluster.reverse.findings.forEach((finding) => {
    const message = multi ? `${cluster.name}: ${finding.message}` : finding.message
    const key = `${finding.code}|${multi && finding.severity !== 'info' ? message : finding.message}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push(multi && finding.severity !== 'info' ? { ...finding, message } : finding)
  }))

  // Shared array: the clusters together must fit it.
  let sharedSanUsed = 0
  let sharedIops = 0
  let sharedThroughput = 0
  if (sharedSan) {
    clusters.forEach((cluster) => {
      sharedSanUsed += cluster.reverse.storageDomains.find((domain) => domain.domain === 'san')?.usedTiB ?? 0
      sharedIops += cluster.reverse.storagePerformance.requiredSanIops
      sharedThroughput += cluster.reverse.storagePerformance.requiredSanThroughputMBps
    })
    if (sharedSanUsed > sharedSanEffective && clusters.length > 1) {
      findings.push({ severity: 'error', code: 'SHARED_SAN_CAPACITY', message: `The clusters together need ${fmt(sharedSanUsed, 1)} TiB on the shared array, which has ${fmt(sharedSanEffective, 1)} TiB effective.`, basis: 'TOOL' })
    }
    const iopsLimit = hardware.sharedSan.maxIops ?? 0
    const throughputLimit = hardware.sharedSan.maxThroughputMBps ?? 0
    if (clusters.length > 1 && ((iopsLimit > 0 && sharedIops > iopsLimit) || (throughputLimit > 0 && sharedThroughput > throughputLimit))) {
      findings.push({ severity: 'error', code: 'SHARED_SAN_PERFORMANCE', message: 'The clusters together exceed the shared array\'s entered sustainable IOPS or throughput.', basis: 'TOOL' })
    }
  }
  if (unplaced.length > 0) {
    const tooLarge = unplaced.filter((vm) => vm.reason !== 'no-room')
    if (tooLarge.length > 0) findings.push({ severity: 'error', code: 'VM_LARGER_THAN_HOST', message: `${plural(tooLarge.length, 'VM')} cannot fit on any single host${tooLarge.length <= 5 ? `: ${tooLarge.map((vm) => vm.name).join(', ')}` : ''}. Adding hosts of the same size does not help: use a larger host or resize the VM.`, basis: 'TOOL' })
    const noRoom = unplaced.filter((vm) => vm.reason === 'no-room')
    if (noRoom.length > 0) findings.push({ severity: 'error', code: 'VMS_NOT_PLACED', message: `${plural(noRoom.length, 'VM')} could not be placed: no cluster has room left for them.`, basis: 'TOOL' })
  }
  if (hardware.looksLikeOldDefaults && !hardware.confirmed) findings.push({ severity: 'warning', code: 'EXISTING_LOOKS_LIKE_DEFAULTS', message: notices[0], basis: 'TOOL' })

  // Resources across the estate.
  const sum = (pick: (cluster: ExistingClusterResult) => number) => clusters.reduce((total, cluster) => total + pick(cluster), 0)
  type RowItem = { cluster: ExistingClusterResult; available: number; used: number; fixed: number }
  type Row = Omit<ResourceRow, 'exhaustionYear'> & { perCluster: RowItem[] }
  const fixedDemand = (cluster: ExistingClusterResult) => {
    const demand = computeDemand(cluster.fixedVms, tiers, 1, policy)
    let s2d = 0
    let san = 0
    cluster.fixedVms.forEach((vm) => {
      const split = storageSplit(cluster.cfg.architecture, cluster.cfg, tiers[vm.tier], vm.storageGiB)
      s2d += split.s2dTiB
      san += split.sanTiB
    })
    return { cores: demand.requiredPCores, ram: demand.requiredRamGiB, s2d, san }
  }
  const fixedByCluster = new Map(clusters.map((cluster) => [cluster.id, fixedDemand(cluster)]))
  const sanIopsShared = sharedSan && (hardware.sharedSan.maxIops ?? 0) > 0 ? hardware.sharedSan.maxIops : undefined
  const sanThroughputShared = sharedSan && (hardware.sharedSan.maxThroughputMBps ?? 0) > 0 ? hardware.sharedSan.maxThroughputMBps : undefined
  /** Resource rows from a reverse result per cluster: today's, or a re-run at a later year's demand. */
  const buildRows = (rev: (cluster: ExistingClusterResult) => ReverseResult): Row[] => {
    const out: Row[] = []
    const domain = (cluster: ExistingClusterResult, name: 's2d' | 'san') => rev(cluster).storageDomains.find((item) => item.domain === name)
    const addRow = (resource: ExistingResource, unit: string, perCluster: RowItem[], sharedAvailable?: number) => {
      if (perCluster.length === 0) return
      const available = sharedAvailable ?? perCluster.reduce((total, item) => total + item.available, 0)
      const used = perCluster.reduce((total, item) => total + item.used, 0)
      const share = (u: number, a: number) => a > 0 ? u / a : u > 0 ? Infinity : 0
      let worstPct = share(used, available)
      let worstCluster: string | null = null
      if (sharedAvailable === undefined) {
        worstPct = 0
        perCluster.forEach((item) => {
          const pct = share(item.used, item.available)
          if (pct > worstPct || worstCluster === null) { worstPct = pct; worstCluster = item.cluster.name }
        })
      }
      out.push({ resource, label: RESOURCE_LABELS[resource], unit, available, used, headroom: available - used, pct: share(used, available), worstPct, worstCluster: multi ? worstCluster : null, perCluster })
    }
    addRow('cpu', 'physical cores', clusters.map((cluster) => ({ cluster, available: rev(cluster).availablePCores, used: rev(cluster).usedPCores, fixed: fixedByCluster.get(cluster.id)!.cores })))
    addRow('memory', 'GiB', clusters.map((cluster) => ({ cluster, available: rev(cluster).availableRamGiB, used: rev(cluster).usedRamGiB, fixed: fixedByCluster.get(cluster.id)!.ram })))
    addRow('s2d-storage', 'TiB', clusters.filter((cluster) => domain(cluster, 's2d')).map((cluster) => ({ cluster, available: domain(cluster, 's2d')!.availableTiB, used: domain(cluster, 's2d')!.usedTiB, fixed: fixedByCluster.get(cluster.id)!.s2d })))
    addRow('san-storage', 'TiB effective', clusters.filter((cluster) => domain(cluster, 'san')).map((cluster) => ({ cluster, available: domain(cluster, 'san')!.availableTiB, used: domain(cluster, 'san')!.usedTiB, fixed: fixedByCluster.get(cluster.id)!.san })), sharedSan ? sharedSanEffective : undefined)
    const perf = (pick: (cluster: ExistingClusterResult) => { required: number; available: number | null }) => clusters
      .map((cluster) => ({ cluster, ...pick(cluster) }))
      .filter((item) => item.available !== null)
      .map((item) => ({ cluster: item.cluster, available: item.available!, used: item.required, fixed: 0 }))
    addRow('s2d-iops', 'IOPS', perf((cluster) => ({ required: rev(cluster).storagePerformance.requiredS2dIops, available: rev(cluster).storagePerformance.availableS2dIops })))
    addRow('s2d-throughput', 'MB/s', perf((cluster) => ({ required: rev(cluster).storagePerformance.requiredS2dThroughputMBps, available: rev(cluster).storagePerformance.availableS2dThroughputMBps })))
    addRow('san-iops', 'IOPS', perf((cluster) => ({ required: rev(cluster).storagePerformance.requiredSanIops, available: rev(cluster).storagePerformance.availableSanIops })), sanIopsShared)
    addRow('san-throughput', 'MB/s', perf((cluster) => ({ required: rev(cluster).storagePerformance.requiredSanThroughputMBps, available: rev(cluster).storagePerformance.availableSanThroughputMBps })), sanThroughputShared)
    return out
  }
  const rows = buildRows((cluster) => cluster.reverse)
  const domain = (cluster: ExistingClusterResult, name: 's2d' | 'san') => cluster.reverse.storageDomains.find((item) => item.domain === name)
  const isShared = (resource: ExistingResource) => (resource === 'san-storage' && sharedSan) || (resource === 'san-iops' && sanIopsShared !== undefined) || (resource === 'san-throughput' && sanThroughputShared !== undefined)
  const shortIn = (row: Row) => isShared(row.resource)
    ? row.used > row.available + 1e-9
    : row.perCluster.some((item) => item.used > item.available + 1e-9)

  // The year each resource runs out: the capacity calculation is re-run for each year's demand, with
  // every VM where it is placed today. Workload demand grows each year; management VMs do not.
  const annual = growth.annualGrowthPct
  const exhaustion = new Map<ExistingResource, number | null>(rows.map((row) => [row.resource, shortIn(row) ? 0 : null]))
  if (annual > 0 && clusters.some((cluster) => cluster.vms.length > 0)) {
    // A straight-line estimate bounds the search, so a resource that never runs out costs nothing.
    const linearYear = (item: { available: number; used: number; fixed: number }) => {
      const workload = Math.max(0, item.used - item.fixed) * (growth.baseGrowthFactor / factor)
      if (workload <= 0) return null
      const room = item.available - item.fixed
      if (room <= 0) return 0
      const years = Math.log(room / workload) / Math.log(1 + annual)
      return years > EXHAUSTION_SEARCH_YEARS ? null : Math.max(0, Math.ceil(years))
    }
    const bound = rows.reduce((max, row) => {
      const items = isShared(row.resource) ? [{ available: row.available, used: row.used, fixed: row.perCluster.reduce((t, i) => t + i.fixed, 0) }] : row.perCluster
      const known = items.map(linearYear).filter((year): year is number => year !== null)
      return known.length > 0 ? Math.max(max, Math.min(...known)) : max
    }, 0)
    const lastYear = Math.min(EXHAUSTION_SEARCH_YEARS, bound + 3)
    const capacityOf = new Map(activeClusters.map((cluster) => [cluster.id, capacities.get(cluster.id)!]))
    for (let year = 1; year <= lastYear && [...exhaustion.values()].some((value) => value === null); year++) {
      const yearFactor = yearDemandFactor(year)
      const reverses = new Map(clusters.map((cluster) => [cluster.id, solveReverse(
        { ...cluster.cfg, growthFactor: yearFactor, annualGrowthPct: 0, growthStrategy: 'phased' },
        cluster.hosts, cluster.vms, tiers, cluster.fixedVms, capacityOf.get(cluster.id),
      )]))
      buildRows((cluster) => reverses.get(cluster.id)!).forEach((row) => {
        if (exhaustion.get(row.resource) === null && shortIn(row)) exhaustion.set(row.resource, year)
      })
    }
  }
  const resources: ResourceRow[] = rows.map(({ perCluster: _perCluster, ...row }) => ({ ...row, exhaustionYear: exhaustion.get(row.resource) ?? null }))
  const anyWorkload = workloadVms.length + fixedVms.length > 0
  const firstToRunOut = anyWorkload && resources.length > 0
    ? resources.reduce((worst, row) => row.worstPct > worst.worstPct ? row : worst)
    : null

  // How many more VMs of the chosen profile fit.
  const sharedSanRoomTiB = sharedSan ? Math.max(0, sharedSanEffective * (1 - sanFreeSpaceTarget(policy)) - sharedSanUsed) : null
  const profile = profileFit(hardware, clusters, tiers, policy, sharedSanRoomTiB, workloadVms, factor)

  // More VMs per tier. With one shared array the clusters' answers cannot each use the whole array.
  const sanClusters = clusters.filter((cluster) => usesSan(cluster.cfg.architecture))
  const tierRoom = Object.fromEntries(TIER_IDS.map((id) => {
    let total = clusters.reduce((sum, cluster) => {
      const value = cluster.reverse.additionalVmsByTier[id]
      return sum + (Number.isFinite(value) ? value : 0)
    }, 0)
    if (sharedSanRoomTiB !== null && sanClusters.length > 1 && total > 0) {
      const tierVms = workloadVms.filter((vm) => vm.tier === id)
      const averageGiB = tierVms.length > 0 ? computeDemand(tierVms, tiers, factor, policy).byTier[id].storageGiB / tierVms.length : 200
      const perVmTiB = Math.max(0, ...sanClusters.map((cluster) => storageSplit(cluster.cfg.architecture, cluster.cfg, tiers[id], averageGiB).sanTiB))
      if (perVmTiB > 0) total = Math.min(total, Math.floor(sharedSanRoomTiB / perVmTiB))
      const averageIops = tierVms.length > 0 ? tierVms.reduce((t, vm) => t + (vm.performance?.storageIopsP95 ?? 0), 0) / tierVms.length * factor : 0
      if (sanIopsShared !== undefined && averageIops > 0 && perVmTiB > 0) total = Math.min(total, Math.max(0, Math.floor((sanIopsShared - sharedIops) / averageIops)))
    }
    return [id, Math.max(0, total)]
  })) as Record<TierId, number>

  // Remedies.
  const addSpec = (() => {
    const chosen = hardware.addSpecGroupId
      ? hardware.clusters.flatMap((cluster) => cluster.hostGroups.filter(groupHasSpec).map((group) => ({ cluster, group }))).find((item) => item.group.id === hardware.addSpecGroupId)
      : undefined
    return chosen ?? mostCommonHostGroup(hardware)
  })()
  const overflowTarget = clusters.length === 0 ? null : (addSpec ? clusters.find((cluster) => cluster.id === addSpec.cluster.id) : undefined) ?? clusters[0]
  const overflowDemand = overflow.reduce((total, need) => ({
    cores: total.cores + need.pCores,
    ram: total.ram + need.ramGiB,
    vms: total.vms + 1,
    storage: total.storage + need.storageGiB,
    vmList: [...total.vmList, need],
  }), { cores: 0, ram: 0, vms: 0, storage: 0, vmList: [] as VmNeed[] })
  const compute: ComputeRemedy[] = []
  const storage: StorageRemedy[] = []
  const performance: PerformanceRemedy[] = []
  if (anyWorkload && addSpec) {
    clusters.forEach((cluster) => {
      const extra = overflowTarget?.id === cluster.id ? overflowDemand : { cores: 0, ram: 0, vms: 0 }
      const plannedVms = grownVmCount(cluster.vms, factor) + cluster.fixedVms.length
      const demand = { cores: cluster.reverse.usedPCores + extra.cores, ram: cluster.reverse.usedRamGiB + extra.ram, vms: plannedVms + extra.vms }
      const source = hardware.clusters.find((item) => item.id === cluster.id)!
      const hosts = hostsToCarry(source, cluster.cfg, addSpec.group, demand)
      if (hosts === null || hosts > 0) {
        const short: string[] = []
        if (demand.cores > cluster.reverse.availablePCores) short.push(`${fmt(demand.cores - cluster.reverse.availablePCores, 1)} physical cores`)
        if (demand.ram > cluster.reverse.availableRamGiB) short.push(`${fmt(demand.ram - cluster.reverse.availableRamGiB)} GiB of memory`)
        if (cluster.workloadNodes > 0 && demand.vms > cluster.workloadNodes * LIMITS.MAX_VMS_PER_HOST) short.push(`room for ${fmt(demand.vms - cluster.workloadNodes * LIMITS.MAX_VMS_PER_HOST)} VMs under the ${fmt(LIMITS.MAX_VMS_PER_HOST)} VMs per host limit`)
        const count = hosts ?? 0
        const overNodeLimit = hosts === null || cluster.hosts + count > cluster.nodeLimit
        const shortText = short.length > 1 ? `${short.slice(0, -1).join(', ')} and ${short[short.length - 1]}` : short[0] ?? 'compute'
        const { id: _id, count: _count, ...spec } = addSpec.group
        compute.push({
          cluster: cluster.name,
          hostsToAdd: count,
          spec,
          specLabel: hostGroupLabel(addSpec.group),
          overNodeLimit,
          nodeLimit: cluster.nodeLimit,
          reason: `${cluster.name} is short of ${shortText}${extra.vms > 0 ? `, counting ${plural(extra.vms, 'VM')} no cluster had room for` : ''}.${overNodeLimit ? ` That passes the ${cluster.nodeLimit}-node limit for one cluster, so the extra hosts need another cluster.` : ''}`,
        })
      }
      // Storage capacity.
      const extraSplit = overflowTarget?.id === cluster.id
        ? overflowDemand.vmList.reduce((total, need) => {
            const split = storageSplit(cluster.cfg.architecture, cluster.cfg, tiers[need.vm.tier], need.storageGiB)
            return { s2d: total.s2d + split.s2dTiB, san: total.san + split.sanTiB }
          }, { s2d: 0, san: 0 })
        : { s2d: 0, san: 0 }
      const s2d = domain(cluster, 's2d')
      if (s2d && s2d.usedTiB + extraSplit.s2d > s2d.availableTiB + 1e-9) {
        const need = s2d.usedTiB + extraSplit.s2d
        let drives: number | null = null
        for (let d = cluster.cfg.node.capacityDrivesPerNode + 1; d <= 64; d++) {
          if (cluster.cfg.node.capacityDriveTB > 0 && s2dCapacity({ ...cluster.cfg, node: { ...cluster.cfg.node, capacityDrivesPerNode: d } }, cluster.hosts).usableTiB >= need) { drives = d; break }
        }
        let hostsAdd: number | null = null
        for (let k = 1; cluster.hosts + k <= cluster.nodeLimit; k++) {
          if (s2dCapacity(cluster.cfg, cluster.hosts + k).usableTiB >= need) { hostsAdd = k; break }
        }
        storage.push({
          scope: cluster.name,
          domain: 's2d',
          shortTiB: need - s2d.availableTiB,
          s2dDrivesPerHost: drives,
          s2dHostsToAdd: hostsAdd,
          detail: `S2D on ${cluster.name} is ${fmt(need - s2d.availableTiB, 1)} TiB short. ${drives !== null ? `Fill to ${drives} capacity drives of ${cluster.cfg.node.capacityDriveTB} TB per host, if the hosts have free slots` : 'More drives of this size per host cannot close it'}${hostsAdd !== null ? `, or add ${plural(hostsAdd, 'host')} with the same drives` : `; adding hosts with the same drives cannot close it within ${cluster.nodeLimit} nodes`}.`,
        })
      }
      const san = domain(cluster, 'san')
      if (san && !sharedSan && san.usedTiB + extraSplit.san > san.availableTiB + 1e-9) {
        storage.push(sanRemedy(cluster.name, san.usedTiB + extraSplit.san, san.availableTiB, cluster.cfg))
      }
      if (sharedSan && overflowTarget?.id === cluster.id) sharedSanUsed += extraSplit.san
      // Performance.
      const sp = cluster.reverse.storagePerformance
      const perfRow = (domainName: 's2d' | 'san', metric: 'iops' | 'throughput', required: number, available: number | null) => {
        if (available === null || required <= available) return
        if (domainName === 'san' && sharedSan && clusters.length > 1) return
        const perHost = metric === 'iops' ? cluster.cfg.node.s2dIopsPerNode ?? 0 : cluster.cfg.node.s2dThroughputMBpsPerNode ?? 0
        const hostsAdd = domainName === 's2d' && perHost > 0 ? Math.ceil((required - available) / perHost) : undefined
        const unitText = metric === 'iops' ? 'IOPS' : 'MB/s'
        performance.push({
          scope: cluster.name, domain: domainName, metric, required, available, shortfall: required - available,
          s2dHostsToAdd: hostsAdd,
          detail: `${domainName === 'san' ? 'The array' : 'S2D'} on ${cluster.name} needs ${fmt(required)} ${unitText} and sustains ${fmt(available)}: ${fmt(required - available)} ${unitText} short.${hostsAdd !== undefined ? ` At the entered per-host figure, ${plural(hostsAdd, 'more host')} would cover it.` : domainName === 'san' ? ' Add array performance or move workload off it.' : ''}`,
        })
      }
      perfRow('s2d', 'iops', sp.requiredS2dIops, sp.availableS2dIops)
      perfRow('s2d', 'throughput', sp.requiredS2dThroughputMBps, sp.availableS2dThroughputMBps)
      perfRow('san', 'iops', sp.requiredSanIops, sp.availableSanIops)
      perfRow('san', 'throughput', sp.requiredSanThroughputMBps, sp.availableSanThroughputMBps)
    })
    if (sharedSan && sharedSanUsed > sharedSanEffective + 1e-9) {
      storage.push(sanRemedy('Shared array', sharedSanUsed, sharedSanEffective, { ...policy, san: hardware.sharedSan }))
    }
    if (sharedSan && clusters.length > 1) {
      const pairs: Array<['iops' | 'throughput', number, number]> = [['iops', sharedIops, hardware.sharedSan.maxIops ?? 0], ['throughput', sharedThroughput, hardware.sharedSan.maxThroughputMBps ?? 0]]
      pairs.forEach(([metric, required, available]) => {
        if (available > 0 && required > available) {
          const unitText = metric === 'iops' ? 'IOPS' : 'MB/s'
          performance.push({ scope: 'Shared array', domain: 'san', metric, required, available, shortfall: required - available, detail: `The shared array needs ${fmt(required)} ${unitText} and sustains ${fmt(available)}: ${fmt(required - available)} ${unitText} short.` })
        }
      })
    }
  }
  const unplaceable = unplaced.filter((vm) => vm.reason !== 'no-room')
  const blockers = [...new Set(clusters.flatMap((cluster) => cluster.reverse.blockers.map((blocker) => multi ? `${cluster.name}: ${blocker}` : blocker)))]

  const whatToAdd: WhatToAddItem[] = [
    ...compute.map((item): WhatToAddItem => ({ category: 'compute', scope: item.cluster, quantity: item.hostsToAdd, unit: item.hostsToAdd === 1 ? 'host' : 'hosts', item: `Hosts of ${item.specLabel}`, detail: item.reason })),
    ...storage.map((item): WhatToAddItem => item.domain === 'san'
      ? { category: 'storage', scope: item.scope, quantity: Math.ceil((item.sanUsableToAddTiB ?? 0) * 10) / 10, unit: 'TiB usable', item: 'SAN capacity', detail: item.detail }
      : item.s2dDrivesPerHost != null
        ? { category: 'storage', scope: item.scope, quantity: item.s2dDrivesPerHost, unit: 'capacity drives per host', item: 'S2D capacity drives', detail: item.detail }
        : { category: 'storage', scope: item.scope, quantity: item.s2dHostsToAdd ?? 0, unit: 'hosts with the same drives', item: 'S2D hosts', detail: item.detail }),
    ...performance.map((item): WhatToAddItem => ({ category: 'performance', scope: item.scope, quantity: Math.ceil(item.shortfall), unit: item.metric === 'iops' ? 'IOPS' : 'MB/s', item: `${item.domain === 'san' ? 'Array' : 'S2D'} ${item.metric === 'iops' ? 'IOPS' : 'throughput'}`, detail: item.detail })),
    ...(unplaceable.length > 0 ? [{ category: 'vm' as const, scope: 'Estate', quantity: unplaceable.length, unit: unplaceable.length === 1 ? 'VM' : 'VMs', item: 'Larger hosts, or resize these VMs', detail: unplaceable.slice(0, 10).map((vm) => `${vm.name} (${vm.vCpu} vCPU, ${fmt(vm.ramGiB)} GiB)`).join(', ') + (unplaceable.length > 10 ? ` and ${unplaceable.length - 10} more` : '') }] : []),
  ]

  // Growth by year.
  const horizon = growth.horizonYears
  const growthYears: ExistingGrowthYear[] = !anyWorkload || !addSpec ? [] : Array.from({ length: horizon + 1 }, (_, year) => {
    // Used figures are at the design factor; scale them to this year's demand.
    const scale = yearDemandFactor(year) / factor
    let worstPct = 0
    let worstResource: ExistingResource | null = null
    rows.forEach((row) => {
      const items = (row.resource === 'san-storage' && sharedSan) ? [{ available: row.available, used: row.used, fixed: row.perCluster.reduce((t, i) => t + i.fixed, 0) }] : row.perCluster
      items.forEach((item) => {
        const used = Math.max(0, item.used - item.fixed) * scale + item.fixed
        const pct = item.available > 0 ? used / item.available : used > 0 ? Infinity : 0
        if (pct > worstPct) { worstPct = pct; worstResource = row.resource }
      })
    })
    let hostsToAdd: number | null = 0
    clusters.forEach((cluster) => {
      const fixed = fixedByCluster.get(cluster.id)!
      const extra = overflowTarget?.id === cluster.id ? overflowDemand : { cores: 0, ram: 0, vms: 0 }
      const demand = {
        cores: (cluster.reverse.usedPCores - fixed.cores + extra.cores) * scale + fixed.cores,
        ram: (cluster.reverse.usedRamGiB - fixed.ram + extra.ram) * scale + fixed.ram,
        vms: grownVmCount(cluster.vms, yearDemandFactor(year)) + Math.ceil(extra.vms * scale) + cluster.fixedVms.length,
      }
      const hosts = hostsToCarry(hardware.clusters.find((item) => item.id === cluster.id)!, cluster.cfg, addSpec.group, demand)
      hostsToAdd = hosts === null || hostsToAdd === null ? null : hostsToAdd + hosts
    })
    return { year, demandFactor: yearDemandFactor(year), worstResource, worstPct, fits: worstPct <= 1 + 1e-9 && unplaced.length === 0 && blockers.length === 0, hostsToAdd }
  })

  const errorFindings = findings.filter((finding) => finding.severity === 'error')
  const allFit = clusters.every((cluster) => cluster.fits !== false)
  let verdict: ExistingVerdict
  if (!entered) verdict = 'no-hardware'
  else if (!anyWorkload) verdict = 'no-workload'
  else verdict = allFit && unplaced.length === 0 && errorFindings.length === 0 ? 'fits' : 'does-not-fit'

  const totalHosts = sum((cluster) => cluster.hosts)
  const workloadHosts = sum((cluster) => cluster.workloadNodes)
  const clusterWord = multi ? ` across ${plural(clusters.length, 'cluster')}` : ''
  let headline: string
  let explanation: string
  if (verdict === 'no-hardware') {
    headline = 'Enter your hardware'
    explanation = 'No hosts are entered yet, so nothing is calculated. Enter your hosts, or use the hosts from your import.'
  } else if (verdict === 'no-workload' && errorFindings.length > 0) {
    // Capacity is not offered as headroom while the hardware itself is not valid.
    headline = 'Not valid as entered'
    explanation = `Resolve first: ${errorFindings.map((finding) => finding.message).join(' ')}`
  } else if (verdict === 'no-workload') {
    headline = `Capacity of your ${plural(totalHosts, 'host')}${clusterWord}`
    explanation = `No workloads are included, so this shows capacity and how many VMs of your chosen profile fit: ${fmt(profile.count)}.`
  } else if (verdict === 'fits') {
    headline = `Fits on your ${plural(totalHosts, 'host')}${clusterWord}`
    explanation = firstToRunOut ? `${firstToRunOut.label} runs out first, at ${fmt(Math.min(firstToRunOut.worstPct, 9.99) * 100, 1)}% used${firstToRunOut.worstCluster ? ` on ${firstToRunOut.worstCluster}` : ''}.` : 'Every resource holds the workload.'
  } else {
    headline = `Does not fit your ${plural(totalHosts, 'host')}${clusterWord}`
    const parts: string[] = []
    if (compute.length > 0) parts.push(`compute: add ${compute.map((item) => `${plural(item.hostsToAdd, 'host')} to ${item.cluster}`).join(', ')}`)
    if (storage.length > 0) parts.push(`storage: ${storage.map((item) => item.domain === 'san' ? `${fmt(item.sanUsableToAddTiB ?? 0, 1)} TiB usable on ${item.scope}` : `${fmt(item.shortTiB, 1)} TiB S2D on ${item.scope}`).join(', ')}`)
    if (performance.length > 0) parts.push(`performance: ${performance.map((item) => `${fmt(item.shortfall)} ${item.metric === 'iops' ? 'IOPS' : 'MB/s'} on ${item.scope}`).join(', ')}`)
    if (unplaceable.length > 0) parts.push(`${plural(unplaceable.length, 'VM')} larger than any host`)
    explanation = parts.length > 0 ? `What it needs: ${parts.join('; ')}.` : `Resolve first: ${blockers[0] ?? errorFindings[0]?.message ?? 'see the findings'}`
    if (blockers.length > 0 && parts.length > 0) explanation += ` Also resolve: ${blockers[0]}`
  }

  return {
    verdict,
    headline,
    explanation,
    entered,
    confirmed: hardware.confirmed,
    looksLikeOldDefaults: hardware.looksLikeOldDefaults && !hardware.confirmed,
    notices,
    clusters,
    totalHosts,
    workloadHosts,
    includedVms: workloadVms.length,
    managementVms: fixedVms.length,
    placement: { method: multi ? 'multi' : 'single', sourceMatched, firstFit, rule: multi ? PLACEMENT_RULE : 'One cluster: every VM is placed on it. Each VM must fit on one host.' },
    unplaced,
    resources: entered ? resources : [],
    firstToRunOut: entered ? firstToRunOut : null,
    profile,
    annualGrowthPct: annual,
    growthYears,
    remedies: { compute, storage, performance, unplaceable, blockers },
    whatToAdd,
    findings,
    licensableCores: sum((cluster) => cluster.licensableCores),
    addSpec: addSpec ? { group: addSpec.group, cluster: addSpec.cluster.name } : null,
    spareRule: SPARE_RULE,
    additionalVmsByTier: tierRoom,
    exhaustionNote: 'The year each resource runs out comes from re-running the capacity calculation for each year at your growth rate, with every VM where it is placed today.',
  }
}

/** One-word verdict for pages, the report and the workbook. */
export function existingVerdictLabel(verdict: ExistingVerdict): string {
  switch (verdict) {
    case 'no-hardware': return 'Enter your hardware'
    case 'no-workload': return 'Not assessed'
    case 'fits': return 'Fits'
    default: return 'Does not fit'
  }
}

/** A used share as text. Nothing entered to hold something reads as such, not as a percentage. */
export function usedShareText(pct: number): string {
  return Number.isFinite(pct) ? `${(pct * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%` : 'No capacity entered'
}

/** When a resource runs out at the entered annual growth. */
export function exhaustionText(row: Pick<ResourceRow, 'exhaustionYear'>, annualGrowthPct: number): string {
  if (row.exhaustionYear === 0) return 'Already short'
  if (row.exhaustionYear !== null) return `Year ${row.exhaustionYear}`
  return annualGrowthPct > 0 ? `Not within ${EXHAUSTION_SEARCH_YEARS} years` : 'No growth entered'
}

/** Total hosts the compute remedies add. */
export const computeHostsToAdd = (assessment: Pick<ExistingAssessment, 'remedies'>) => assessment.remedies.compute.reduce((total, item) => total + item.hostsToAdd, 0)

/** Additional VMs per tier at each tier's average profile, summed over the clusters. */
export function additionalVmsByTier(assessment: Pick<ExistingAssessment, 'clusters'> & Partial<Pick<ExistingAssessment, 'additionalVmsByTier'>>): Record<TierId, number> {
  if (assessment.additionalVmsByTier) return assessment.additionalVmsByTier
  return Object.fromEntries(TIER_IDS.map((id) => [id, assessment.clusters.reduce((total, cluster) => {
    const value = cluster.reverse.additionalVmsByTier[id]
    return total + (Number.isFinite(value) ? value : 0)
  }, 0)])) as Record<TierId, number>
}

function sanRemedy(scope: string, usedTiB: number, effectiveTiB: number, cfg: Pick<ClusterConfig, 'san' | 'sanFreeSpaceTargetPct'>): StorageRemedy {
  const drr = Math.max(1, cfg.san.drr)
  const target = sanFreeSpaceTarget(cfg)
  const toFit = Math.max(0, (usedTiB - effectiveTiB) / drr)
  const toTarget = Math.max(0, (usedTiB / (1 - target) - effectiveTiB) / drr)
  return {
    scope,
    domain: 'san',
    shortTiB: usedTiB - effectiveTiB,
    sanUsableToAddTiB: toFit,
    sanUsableToTargetTiB: toTarget,
    detail: `${scope === 'Shared array' ? 'The shared array' : `The array on ${scope}`} needs ${fmt(usedTiB, 1)} TiB effective and has ${fmt(effectiveTiB, 1)}. Add ${fmt(toFit, 1)} TiB usable to fit, or ${fmt(toTarget, 1)} TiB usable to keep ${fmt(target * 100)}% free (at ${drr}:1 data reduction). Adding hosts does not change the array.`,
  }
}

function profileFit(
  hardware: ExistingHardware,
  clusters: ExistingClusterResult[],
  tiers: Record<TierId, TierPolicy>,
  policy: ClusterConfig,
  sharedSanRoomTiB: number | null,
  workloadVms: Vm[],
  factor: number,
): ProfileFit {
  const choice = hardware.vmProfile
  const tier = tiers[choice.tier]
  const tierVms = workloadVms.filter((vm) => vm.tier === choice.tier)
  let vCpu = choice.vCpu
  let ramGiB = choice.ramGiB
  let storageGiB = choice.storageGiB
  let iops = choice.iops
  let label: string
  let note: string
  if (choice.mode === 'tier' && tierVms.length > 0) {
    const average = (pick: (vm: Vm) => number) => tierVms.reduce((total, vm) => total + pick(vm), 0) / tierVms.length
    vCpu = average((vm) => vm.vCpu)
    ramGiB = average((vm) => vm.ramGiB)
    storageGiB = average((vm) => vm.storageGiB)
    iops = average((vm) => vm.performance?.storageIopsP95 ?? 0)
    label = `Average ${tier.label} VM`
    note = `The average of your ${plural(tierVms.length, `${tier.label} VM`)}.`
  } else if (choice.mode === 'tier') {
    vCpu = 4; ramGiB = 16; storageGiB = 200; iops = 0
    label = `${tier.label} VM (nominal)`
    note = `You have no ${tier.label} VMs, so a nominal 4 vCPU, 16 GiB, 200 GiB profile is used. That fallback is a tool assumption.`
  } else {
    label = 'Your profile'
    note = `Your profile, at the ${tier.label} tier's ${tier.oversubscription}:1 vCPU ratio.`
  }
  const sample: Vm = { id: 'profile', name: 'profile', tier: choice.tier, vCpu, ramGiB, storageGiB, provisionedGiB: storageGiB, powerState: 'poweredOn', include: true, performance: iops > 0 ? { storageIopsP95: iops } : undefined }
  const demand = computeDemand([sample], tiers, factor, choice.mode === 'custom' ? { ...policy, sizingBasis: 'allocation' } : policy)
  const pCores = demand.requiredPCores
  const demandRam = demand.requiredRamGiB
  const demandStorage = demand.byTier[choice.tier].storageGiB
  const iopsGrown = iops * factor
  const perCluster: ProfileFit['perCluster'] = []
  const limits = new Map<ExistingResource | 'host-size', number>()
  let total = 0
  let sharedPerVmTiB = 0
  clusters.forEach((cluster) => {
    const r = cluster.reverse
    const source = hardware.clusters.find((item) => item.id === cluster.id)!
    if (!fitsOneHost(sample, source, cluster.cfg)) { perCluster.push({ cluster: cluster.name, count: 0 }); limits.set('host-size', (limits.get('host-size') ?? 0) + 1); return }
    if (r.status === 'blocked' || r.status === 'over') { perCluster.push({ cluster: cluster.name, count: 0 }); return }
    const split = storageSplit(cluster.cfg.architecture, cluster.cfg, tier, demandStorage)
    const s2d = r.storageDomains.find((item) => item.domain === 's2d')
    const san = r.storageDomains.find((item) => item.domain === 'san')
    const share = r.storagePerformance
    const candidates: Array<[ExistingResource, number]> = [
      ['cpu', pCores > 0 ? r.headroomPCores / pCores : Infinity],
      ['memory', demandRam > 0 ? r.headroomRamGiB / demandRam : Infinity],
      ['vm-count', Math.min(cluster.workloadNodes * LIMITS.MAX_VMS_PER_HOST, LIMITS.MAX_VMS_PER_CLUSTER) - Math.ceil(cluster.vms.length * factor) - cluster.fixedVms.length],
      ['s2d-storage', s2d && split.s2dTiB > 0 ? s2d.headroomToTargetTiB / split.s2dTiB : Infinity],
      ['san-storage', san && split.sanTiB > 0 && sharedSanRoomTiB === null ? san.headroomToTargetTiB / split.sanTiB : Infinity],
      ['s2d-iops', share.availableS2dIops !== null && iopsGrown * (split.s2dTiB > 0 ? 1 : 0) > 0 ? (share.availableS2dIops - share.requiredS2dIops) / iopsGrown : Infinity],
      ['san-iops', share.availableSanIops !== null && iopsGrown * (split.sanTiB > 0 ? 1 : 0) > 0 ? (share.availableSanIops - share.requiredSanIops) / iopsGrown : Infinity],
    ]
    const [resource, value] = candidates.reduce((min, item) => item[1] < min[1] ? item : min)
    const count = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
    if (Number.isFinite(value)) limits.set(resource, (limits.get(resource) ?? 0) + 1)
    perCluster.push({ cluster: cluster.name, count })
    total += count
    if (sharedSanRoomTiB !== null && count > 0) sharedPerVmTiB = Math.max(sharedPerVmTiB, split.sanTiB)
  })
  let limitedBy: ProfileFit['limitedBy'] = [...limits.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  if (sharedSanRoomTiB !== null && sharedPerVmTiB > 0 && total > 0) {
    // One shared array: the clusters' counts together cannot pass its room.
    const cap = Math.max(0, Math.floor(sharedSanRoomTiB / sharedPerVmTiB))
    if (cap < total) { total = cap; limitedBy = 'san-storage' }
  }
  if (clusters.length === 0) limitedBy = null
  return { label, vCpu, ramGiB, storageGiB, pCores, demandRamGiB: demandRam, count: total, limitedBy, perCluster, note }
}
