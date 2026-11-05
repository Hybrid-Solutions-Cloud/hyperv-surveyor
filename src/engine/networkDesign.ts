/**
 * Host networking for the Implementation plan: Network ATC intents with the adapters mapped to each,
 * BMC ports, SAN connectivity (Fibre Channel or iSCSI adapters, paths, fabrics, MPIO), VLAN checks
 * and a comparison of imported network P95 against the compute bandwidth.
 *
 * Microsoft facts used here, each cited where it is applied:
 * - S2D: 10 Gbps minimum for 2 to 3 nodes; for 4 or more, RDMA-capable NICs, "iWARP (recommended) or
 *   RoCE", 25 Gbps or faster. storage-spaces-direct-hardware-requirements
 * - Network ATC: one intent per adapter; at most one management and one storage intent; compute
 *   intents unlimited. RoCE needs a nonzero VLAN for PFC markings. network-atc
 * - SET: up to eight adapters in one team. DCB is required for RoCE, optional for iWARP.
 *   azure-local host-network-requirements
 * - Failover clusters: an iSCSI adapter should be dedicated to iSCSI or to network communication, not
 *   both; use multipath I/O or teamed adapters. clustering-requirements
 */
import type { ClusterConfig, Vm } from './types'

export type RdmaProtocol = 'none' | 'roce-v2' | 'iwarp'
export type IntentType = 'management' | 'compute' | 'storage'
export type SanProtocol = 'fc' | 'iscsi' | 'other' | 'none'

export interface NetworkIntent {
  id: string
  name: string
  types: IntentType[]
  /** Physical adapter ports per host in this intent. */
  adapters: number
  speedGbps: number
}

export interface SanConnectivityInputs {
  protocol: SanProtocol
  /** Fibre Channel HBAs or iSCSI adapters per host. */
  adaptersPerHost: number
  portsPerAdapter: number
  speedGbps: number
  pathsPerLun: number
  /** Separate fabrics, such as A and B. */
  fabrics: number
  /** Array target ports in each fabric. */
  arrayPortsPerFabric: number
  /** Free switch or fabric ports you have for this design, all fabrics together. 0 means not entered. */
  fabricPortsAvailable: number
  mpio: boolean
  /** iSCSI only: the iSCSI adapters carry no other traffic. */
  dedicatedIscsi: boolean
}

export interface NetworkDesignInputs {
  /** Derived from the intents: total data adapters per host. Kept for older saves and links. */
  adaptersPerNode: number
  /** Derived from the intents: the fastest adapter. Kept for older saves and links. */
  adapterSpeedGbps: number
  intents: NetworkIntent[]
  bmcPortsPerNode: number
  rdmaProtocol: RdmaProtocol
  dataCenterBridging: boolean
  separateStorageFabric: boolean
  managementVlan: string
  computeVlans: string
  liveMigrationVlan: string
  storageVlans: string
  liveMigrationNetworks: number
  switchRedundancy: boolean
  san: SanConnectivityInputs
}

export const DEFAULT_SAN_CONNECTIVITY: SanConnectivityInputs = {
  protocol: 'fc',
  adaptersPerHost: 2,
  portsPerAdapter: 1,
  speedGbps: 32,
  pathsPerLun: 4,
  fabrics: 2,
  arrayPortsPerFabric: 2,
  fabricPortsAvailable: 0,
  mpio: true,
  dedicatedIscsi: true,
}

/** Intents built from an adapter count and speed, the way older saves described the host. */
export function intentsFromAdapters(adapters: number, speedGbps: number): NetworkIntent[] {
  const count = Math.max(1, Math.round(adapters))
  if (count >= 4) {
    return [
      { id: 'intent-1', name: 'Management and compute', types: ['management', 'compute'], adapters: count - 2, speedGbps },
      { id: 'intent-2', name: 'Storage', types: ['storage'], adapters: 2, speedGbps },
    ]
  }
  return [{ id: 'intent-1', name: 'Converged', types: ['management', 'compute', 'storage'], adapters: count, speedGbps }]
}

export const DEFAULT_NETWORK_INPUTS: NetworkDesignInputs = {
  adaptersPerNode: 4,
  adapterSpeedGbps: 25,
  intents: intentsFromAdapters(4, 25),
  bmcPortsPerNode: 1,
  // Microsoft lists iWARP as recommended for 4+ node S2D; RoCE stays selectable.
  rdmaProtocol: 'iwarp',
  dataCenterBridging: true,
  separateStorageFabric: true,
  managementVlan: '10',
  computeVlans: '100-199',
  liveMigrationVlan: '20',
  storageVlans: '711,712',
  liveMigrationNetworks: 2,
  switchRedundancy: true,
  san: { ...DEFAULT_SAN_CONNECTIVITY },
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown, fallback: number, min = 0, max = 64) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const INTENT_TYPES: IntentType[] = ['management', 'compute', 'storage']

function normalizeIntent(value: unknown, index: number): NetworkIntent | null {
  if (!isRecord(value)) return null
  const types = Array.isArray(value.types) ? INTENT_TYPES.filter((type) => (value.types as unknown[]).includes(type)) : []
  return {
    id: typeof value.id === 'string' && value.id ? value.id : `intent-${index + 1}`,
    name: typeof value.name === 'string' ? value.name : `Intent ${index + 1}`,
    types,
    adapters: Math.round(count(value.adapters, 2, 0, 16)),
    speedGbps: count(value.speedGbps, 25, 0, 800),
  }
}

/**
 * Brings saved network inputs to the current shape. Older saves have an adapter count and speed but
 * no intents: they become intents with the same adapters. Their RDMA choice is kept as saved.
 */
export function normalizeNetworkDesignInputs(value: unknown): NetworkDesignInputs {
  const input = isRecord(value) ? value : {}
  const merged = { ...DEFAULT_NETWORK_INPUTS, ...(input as Partial<NetworkDesignInputs>) }
  const legacyAdapters = count(input.adaptersPerNode, DEFAULT_NETWORK_INPUTS.adaptersPerNode, 1, 16)
  const legacySpeed = count(input.adapterSpeedGbps, DEFAULT_NETWORK_INPUTS.adapterSpeedGbps, 0, 800)
  const intents = Array.isArray(input.intents)
    ? input.intents.map(normalizeIntent).filter((intent): intent is NetworkIntent => intent !== null)
    : intentsFromAdapters(legacyAdapters, legacySpeed)
  const san = isRecord(input.san) ? input.san : {}
  const protocol = (['fc', 'iscsi', 'other', 'none'] as SanProtocol[]).includes(san.protocol as SanProtocol) ? san.protocol as SanProtocol : DEFAULT_SAN_CONNECTIVITY.protocol
  return {
    ...merged,
    intents,
    adaptersPerNode: intents.reduce((total, intent) => total + intent.adapters, 0),
    adapterSpeedGbps: intents.reduce((max, intent) => Math.max(max, intent.speedGbps), 0),
    bmcPortsPerNode: Math.round(count(input.bmcPortsPerNode, DEFAULT_NETWORK_INPUTS.bmcPortsPerNode, 0, 4)),
    rdmaProtocol: merged.rdmaProtocol === 'roce-v2' || merged.rdmaProtocol === 'none' ? merged.rdmaProtocol : 'iwarp',
    managementVlan: String(merged.managementVlan ?? ''),
    computeVlans: String(merged.computeVlans ?? ''),
    liveMigrationVlan: String(merged.liveMigrationVlan ?? ''),
    storageVlans: String(merged.storageVlans ?? ''),
    san: {
      protocol,
      adaptersPerHost: Math.round(count(san.adaptersPerHost, DEFAULT_SAN_CONNECTIVITY.adaptersPerHost, 0, 16)),
      portsPerAdapter: Math.round(count(san.portsPerAdapter, DEFAULT_SAN_CONNECTIVITY.portsPerAdapter, 1, 8)),
      speedGbps: count(san.speedGbps, DEFAULT_SAN_CONNECTIVITY.speedGbps, 0, 800),
      pathsPerLun: Math.round(count(san.pathsPerLun, DEFAULT_SAN_CONNECTIVITY.pathsPerLun, 1, 64)),
      fabrics: Math.round(count(san.fabrics, DEFAULT_SAN_CONNECTIVITY.fabrics, 1, 4)),
      arrayPortsPerFabric: Math.round(count(san.arrayPortsPerFabric, DEFAULT_SAN_CONNECTIVITY.arrayPortsPerFabric, 1, 64)),
      fabricPortsAvailable: Math.round(count(san.fabricPortsAvailable, 0, 0, 100000)),
      mpio: typeof san.mpio === 'boolean' ? san.mpio : DEFAULT_SAN_CONNECTIVITY.mpio,
      dedicatedIscsi: typeof san.dedicatedIscsi === 'boolean' ? san.dedicatedIscsi : DEFAULT_SAN_CONNECTIVITY.dedicatedIscsi,
    },
  }
}

export interface NetworkFinding {
  severity: 'error' | 'warning' | 'info'
  message: string
  source?: string
}

export interface IntentRow extends NetworkIntent {
  /** True when Network ATC builds a SET virtual switch for this intent (it carries compute). */
  setTeam: boolean
  portsTotal: number
}

export interface SanConnectivityPlan {
  protocol: SanProtocol
  hostPortsPerNode: number
  totalHostPorts: number
  hostPortsPerFabric: number
  arrayPorts: number
  /** Host ports plus array ports, all fabrics together. */
  fabricPortsNeeded: number
  maxPathsPerLun: number
  /** iSCSI ports land on Ethernet switches. */
  onEthernet: boolean
}

export interface NetworkTraffic {
  measuredVms: number
  includedVms: number
  totalP95Mbps: number
  peakVmMbps: number
  peakVmName: string | null
  computeMbps: number
  computeMbpsOneAdapterDown: number
}

export interface NetworkDesign {
  /** Data ports per host for the intents (BMC and SAN fabric ports are separate). */
  hostPortsPerNode: number
  totalHostPorts: number
  bmcPorts: number
  aggregateGbpsPerNode: number
  intents: IntentRow[]
  intentSummary: string[]
  san: SanConnectivityPlan | null
  traffic: NetworkTraffic | null
  findings: NetworkFinding[]
}

export interface NetworkContext {
  /** Hosts that carry workload, for the compute bandwidth. Defaults to the node count. */
  workloadNodes?: number
  /** The smallest cluster's node count, for the 4-node S2D guidance. Defaults to the node count. */
  smallestClusterNodes?: number
  /** Included VMs with imported networkMbpsP95, compared with compute bandwidth. */
  vms?: Vm[]
}

export const NETWORK_SOURCES = {
  s2dHardware: 'https://learn.microsoft.com/windows-server/storage/storage-spaces/storage-spaces-direct-hardware-requirements',
  networkAtc: 'https://learn.microsoft.com/windows-server/networking/network-atc/network-atc',
  hostNetwork: 'https://learn.microsoft.com/azure/azure-local/concepts/host-network-requirements',
  clustering: 'https://learn.microsoft.com/windows-server/failover-clustering/clustering-requirements',
} as const

/** Shown beside the RDMA selector: older saves may carry RoCE v2 as a default, which cannot be told from a choice. */
export const RDMA_RECOMMENDATION_NOTE = {
  text: 'Microsoft recommends iWARP for Storage Spaces Direct; RoCE is supported with Data Center Bridging on every switch. If RoCE v2 came from an earlier save, confirm it is your choice.',
  source: NETWORK_SOURCES.s2dHardware,
} as const

/** Parses "10", "100-199" or "30,31". Returns the bad parts, so a VLAN like "abc" is reported. */
export function parseVlans(value: string): { ids: number[]; invalid: string[] } {
  const ids: number[] = []
  const invalid: string[] = []
  value.split(/[,;\s]+/).map((part) => part.trim()).filter(Boolean).forEach((part) => {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part)
    const single = /^\d+$/.test(part) ? Number(part) : null
    const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 4094
    if (range) {
      const [low, high] = [Number(range[1]), Number(range[2])]
      if (valid(low) && valid(high) && low <= high) { ids.push(low, high) } else invalid.push(part)
    } else if (single !== null && valid(single)) ids.push(single)
    else invalid.push(part)
  })
  return { ids, invalid }
}

const fmt = (value: number, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits })

export function designNetwork(cfg: ClusterConfig, nodes: number, requested: Partial<NetworkDesignInputs> = {}, context: NetworkContext = {}): NetworkDesign {
  // Callers that pass only an adapter count and speed, as older code and links did, get intents from them.
  const legacy = requested.intents === undefined && (requested.adaptersPerNode !== undefined || requested.adapterSpeedGbps !== undefined)
  const inputs = normalizeNetworkDesignInputs(legacy
    ? { ...requested, intents: intentsFromAdapters(requested.adaptersPerNode ?? DEFAULT_NETWORK_INPUTS.adaptersPerNode, requested.adapterSpeedGbps ?? DEFAULT_NETWORK_INPUTS.adapterSpeedGbps) }
    : { ...DEFAULT_NETWORK_INPUTS, ...requested })
  const hosts = Math.max(0, nodes)
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'
  const usesSan = cfg.architecture === 'san' || cfg.architecture === 'hybrid'
  const smallest = context.smallestClusterNodes ?? hosts
  const findings: NetworkFinding[] = []
  const intents: IntentRow[] = inputs.intents.map((intent) => ({ ...intent, setTeam: intent.types.includes('compute'), portsTotal: intent.adapters * hosts }))
  const hostPortsPerNode = intents.reduce((total, intent) => total + intent.adapters, 0)
  const withType = (type: IntentType) => intents.filter((intent) => intent.types.includes(type))
  const management = withType('management')
  const compute = withType('compute')
  const storage = withType('storage')

  // Intents, the Network ATC way.
  if (intents.length === 0 || hostPortsPerNode === 0) findings.push({ severity: 'error', message: 'No host adapters are mapped to an intent. Add at least one intent with adapters.', source: NETWORK_SOURCES.networkAtc })
  if (management.length === 0) findings.push({ severity: 'error', message: 'No intent carries management traffic. Add management to one intent.', source: NETWORK_SOURCES.networkAtc })
  if (management.length > 1) findings.push({ severity: 'error', message: `${management.length} intents carry management. Network ATC allows one management intent.`, source: NETWORK_SOURCES.networkAtc })
  if (storage.length > 1) findings.push({ severity: 'error', message: `${storage.length} intents carry storage. Network ATC allows one storage intent.`, source: NETWORK_SOURCES.networkAtc })
  if (compute.length === 0) findings.push({ severity: 'error', message: 'No intent carries compute (VM) traffic. Add compute to one intent.', source: NETWORK_SOURCES.networkAtc })
  intents.filter((intent) => intent.types.length === 0).forEach((intent) => findings.push({ severity: 'warning', message: `${intent.name} has adapters but no traffic type. Choose management, compute or storage, or remove it.`, source: NETWORK_SOURCES.networkAtc }))
  intents.filter((intent) => intent.setTeam && intent.adapters > 8).forEach((intent) => findings.push({ severity: 'error', message: `${intent.name} puts ${intent.adapters} adapters in one Switch Embedded Teaming team. SET supports up to eight adapters in a team; split them into another compute intent.`, source: NETWORK_SOURCES.hostNetwork }))
  if (hostPortsPerNode === 1) findings.push({ severity: 'error', message: 'One adapter per host: a single adapter failure takes management, VM and cluster traffic offline. Use at least two.', source: NETWORK_SOURCES.clustering })
  intents.filter((intent) => intent.adapters === 1 && hostPortsPerNode > 1).forEach((intent) => findings.push({ severity: 'warning', message: `${intent.name} has one adapter, so it has no redundancy.` }))

  // S2D storage network.
  if (usesS2d) {
    const storageIntent = storage[0]
    const storageSpeed = storageIntent?.speedGbps ?? 0
    if (!storageIntent) findings.push({ severity: 'error', message: 'Storage Spaces Direct needs a storage intent for the east-west storage traffic. Add storage to an intent.', source: NETWORK_SOURCES.networkAtc })
    else {
      if (storageSpeed < 10) findings.push({ severity: 'error', message: `The storage intent runs at ${fmt(storageSpeed, 1)} Gbps. Storage Spaces Direct needs 10 Gbps or faster between every node.`, source: NETWORK_SOURCES.s2dHardware })
      else if (smallest >= 4 && storageSpeed < 25) findings.push({ severity: 'warning', message: `With ${smallest} or more nodes per cluster Microsoft recommends 25 Gbps or faster RDMA adapters for storage; yours run at ${fmt(storageSpeed, 1)} Gbps.`, source: NETWORK_SOURCES.s2dHardware })
      if (storageIntent.adapters < 2) findings.push({ severity: 'warning', message: 'The storage intent has one adapter. Microsoft recommends two or more network connections from each node.', source: NETWORK_SOURCES.s2dHardware })
    }
    if (inputs.rdmaProtocol === 'none') {
      findings.push(smallest >= 4
        ? { severity: 'warning', message: 'RDMA is not selected. For 4 or more nodes Microsoft recommends RDMA-capable adapters (iWARP recommended, or RoCE) at 25 Gbps or faster.', source: NETWORK_SOURCES.s2dHardware }
        : { severity: 'info', message: 'RDMA is not selected. For 2 to 3 nodes 10 Gbps is the minimum; RDMA improves storage performance.', source: NETWORK_SOURCES.s2dHardware })
    }
    if (inputs.rdmaProtocol === 'roce-v2' && !inputs.dataCenterBridging) findings.push({ severity: 'error', message: 'RoCE is selected without Data Center Bridging. DCB is required for RoCE (and optional for iWARP): configure PFC and ETS end to end, or use iWARP.', source: NETWORK_SOURCES.hostNetwork })
    if (inputs.rdmaProtocol === 'roce-v2' && smallest >= 4) findings.push({ severity: 'info', message: 'Microsoft lists iWARP as recommended for 4 or more nodes; RoCE is supported with DCB on every switch.', source: NETWORK_SOURCES.s2dHardware })
  } else if (storage.length > 0) {
    findings.push({ severity: 'info', message: 'The storage intent carries SMB traffic such as live migration. This design has no Storage Spaces Direct, so the array connects through the SAN connectivity below.' })
  }

  // VLANs.
  const vlanFields: Array<[string, string, boolean]> = [
    ['Management VLAN', inputs.managementVlan, false],
    ['Compute VLANs', inputs.computeVlans, true],
    ['Live migration VLAN', inputs.liveMigrationVlan, false],
    ...(usesS2d || storage.length > 0 ? [['Storage VLANs', inputs.storageVlans, true] as [string, string, boolean]] : []),
  ]
  vlanFields.forEach(([label, value]) => {
    const parsed = parseVlans(value)
    if (parsed.invalid.length > 0) findings.push({ severity: 'error', message: `${label}: "${parsed.invalid.join('", "')}" is not a valid VLAN ID. Use numbers from 1 to 4094, a range such as 100-199, or a list such as 711,712.` })
  })
  const storageVlans = parseVlans(inputs.storageVlans)
  if (usesS2d && inputs.rdmaProtocol === 'roce-v2' && storageVlans.ids.length === 0 && storageVlans.invalid.length === 0) {
    findings.push({ severity: 'error', message: 'Enter the storage VLANs. RoCE needs a nonzero VLAN so Priority Flow Control markings can be added (Network ATC defaults to 711 and 712).', source: NETWORK_SOURCES.networkAtc })
  }

  if (!inputs.switchRedundancy) findings.push({ severity: 'warning', message: 'You have not confirmed redundant top-of-rack switching. A single switch failure can isolate multiple hosts.' })
  if (cfg.architecture === 'hybrid' && !inputs.separateStorageFabric) findings.push({ severity: 'warning', message: 'S2D east-west traffic and SAN traffic share a fabric. Validate QoS and failure isolation so SAN load or resync cannot starve the other storage domain.' })

  // SAN connectivity.
  let san: SanConnectivityPlan | null = null
  if (usesSan) {
    const s = inputs.san
    const hostPortsPerNodeSan = s.protocol === 'none' ? 0 : s.adaptersPerHost * s.portsPerAdapter
    const totalSanPorts = hostPortsPerNodeSan * hosts
    const arrayPorts = s.protocol === 'none' ? 0 : s.arrayPortsPerFabric * s.fabrics
    san = {
      protocol: s.protocol,
      hostPortsPerNode: hostPortsPerNodeSan,
      totalHostPorts: totalSanPorts,
      hostPortsPerFabric: Math.ceil(totalSanPorts / Math.max(1, s.fabrics)),
      arrayPorts,
      fabricPortsNeeded: totalSanPorts + arrayPorts,
      // Each host port can be zoned to every array port in its own fabric.
      maxPathsPerLun: hostPortsPerNodeSan * s.arrayPortsPerFabric,
      onEthernet: s.protocol === 'iscsi',
    }
    const name = s.protocol === 'fc' ? 'Fibre Channel HBA' : s.protocol === 'iscsi' ? 'iSCSI adapter' : 'storage adapter'
    if (s.protocol === 'none') {
      findings.push({ severity: 'error', message: 'Your design uses an external array, but no SAN connectivity is chosen. Choose Fibre Channel, iSCSI or other, with adapters per host.', source: NETWORK_SOURCES.clustering })
    } else {
      if (s.protocol === 'other') findings.push({ severity: 'info', message: 'Other SAN connectivity (such as shared SAS or NVMe over fabrics): validate adapters, paths and multipathing with your array vendor.' })
      if (s.adaptersPerHost === 0) findings.push({ severity: 'error', message: `No ${name}s per host are entered. Each clustered server needs one or more adapters or HBAs dedicated to cluster storage.`, source: NETWORK_SOURCES.clustering })
      else if (s.adaptersPerHost === 1) findings.push({ severity: 'warning', message: `One ${name} per host is a single point of failure for every LUN. Use two adapters, one per fabric.`, source: NETWORK_SOURCES.clustering })
      if (hostPortsPerNodeSan === 1) findings.push({ severity: 'error', message: `Each host has one ${name} port, so every LUN has one path. Use multipath I/O over at least two ports.`, source: NETWORK_SOURCES.clustering })
      if (s.speedGbps > 0 && s.speedGbps < 10) findings.push({ severity: 'warning', message: `${name}s at ${fmt(s.speedGbps, 1)} Gbps are below 10 Gbps. Check the bandwidth against your storage throughput (tool assumption: 10 Gbps or faster for cluster storage).` })
      if (!s.mpio && (hostPortsPerNodeSan > 1 || s.pathsPerLun > 1)) findings.push({ severity: 'error', message: 'More than one path is planned without MPIO. Each LUN would appear once per path. Enable multipath I/O with the same DSM on every node.', source: NETWORK_SOURCES.clustering })
      if (!s.mpio && hostPortsPerNodeSan <= 1) findings.push({ severity: 'warning', message: 'MPIO is off and each LUN has one path. Use multipath I/O software or teamed adapters for redundancy.', source: NETWORK_SOURCES.clustering })
      if (s.pathsPerLun < 2) findings.push({ severity: 'warning', message: 'One path per LUN gives no path redundancy. Plan at least two paths, across both fabrics.' })
      if (s.pathsPerLun > san.maxPathsPerLun && hostPortsPerNodeSan > 0) findings.push({ severity: 'error', message: `${s.pathsPerLun} paths per LUN are planned, but ${hostPortsPerNodeSan} host port(s) × ${s.arrayPortsPerFabric} array port(s) per fabric give at most ${san.maxPathsPerLun}.` })
      if (s.fabrics < 2) findings.push({ severity: 'warning', message: 'One fabric: a fabric or switch failure takes every path down. Use two separate fabrics (A and B). Tool assumption.' })
      if (s.fabrics > hostPortsPerNodeSan && hostPortsPerNodeSan > 0) findings.push({ severity: 'error', message: `${s.fabrics} fabrics need at least ${s.fabrics} ports per host, one in each; each host has ${hostPortsPerNodeSan}.` })
      if (s.fabricPortsAvailable > 0 && s.fabricPortsAvailable < san.fabricPortsNeeded) findings.push({ severity: 'error', message: `The fabrics need ${fmt(san.fabricPortsNeeded)} ports (${fmt(totalSanPorts)} host and ${fmt(arrayPorts)} array) and you have ${fmt(s.fabricPortsAvailable)}.` })
      if (s.fabricPortsAvailable === 0) findings.push({ severity: 'info', message: `Fabric ports you have are not entered. The design needs ${fmt(san.fabricPortsNeeded)} (${fmt(totalSanPorts)} host and ${fmt(arrayPorts)} array).` })
      if (s.protocol === 'iscsi' && !s.dedicatedIscsi) findings.push({ severity: 'warning', message: 'The iSCSI adapters also carry other traffic. Microsoft says to dedicate each adapter to either network communication or iSCSI, not both.', source: NETWORK_SOURCES.clustering })
      findings.push({ severity: 'info', message: 'Zone each host port to the array ports in its own fabric, set the array host personality for Windows, and run cluster validation with the storage connected.', source: NETWORK_SOURCES.clustering })
    }
  }

  // Imported network P95 against the compute bandwidth.
  let traffic: NetworkTraffic | null = null
  const included = (context.vms ?? []).filter((vm) => vm.include)
  const measured = included.filter((vm) => typeof vm.performance?.networkMbpsP95 === 'number' && Number.isFinite(vm.performance.networkMbpsP95))
  if (measured.length > 0) {
    const workloadHosts = Math.max(0, context.workloadNodes ?? hosts)
    const computeAdapters = compute.reduce((total, intent) => total + intent.adapters, 0)
    const computeMbpsPerHost = compute.reduce((total, intent) => total + intent.adapters * intent.speedGbps * 1000, 0)
    const slowest = compute.reduce((min, intent) => Math.min(min, intent.speedGbps), Infinity)
    const totalP95 = measured.reduce((total, vm) => total + (vm.performance!.networkMbpsP95 ?? 0), 0)
    const peak = measured.reduce((best, vm) => (vm.performance!.networkMbpsP95 ?? 0) > (best?.performance?.networkMbpsP95 ?? -1) ? vm : best, measured[0])
    const computeMbps = computeMbpsPerHost * workloadHosts
    const oneDown = computeAdapters > 1 ? (computeMbpsPerHost - (Number.isFinite(slowest) ? slowest * 1000 : 0)) * workloadHosts : 0
    traffic = {
      measuredVms: measured.length,
      includedVms: included.length,
      totalP95Mbps: totalP95,
      peakVmMbps: peak.performance!.networkMbpsP95 ?? 0,
      peakVmName: peak.name,
      computeMbps,
      computeMbpsOneAdapterDown: oneDown,
    }
    const coverage = `${fmt(measured.length)} of ${fmt(included.length)} included VMs have imported network P95`
    if (computeMbps > 0 && totalP95 > computeMbps) findings.push({ severity: 'error', message: `Your VMs' network P95 adds up to ${fmt(totalP95)} Mbps, above the ${fmt(computeMbps)} Mbps of compute adapters on ${workloadHosts} workload hosts (${coverage}).` })
    else if (oneDown > 0 && totalP95 > oneDown) findings.push({ severity: 'warning', message: `Your VMs' network P95 adds up to ${fmt(totalP95)} Mbps. It fits the ${fmt(computeMbps)} Mbps of compute adapters, but not with one adapter down on every host (${fmt(oneDown)} Mbps). ${coverage}.` })
    else findings.push({ severity: 'info', message: `Your VMs' network P95 adds up to ${fmt(totalP95)} Mbps against ${fmt(computeMbps)} Mbps of compute adapters on ${workloadHosts} workload hosts. P95 values do not peak at the same time, so this sum is conservative. ${coverage}.` })
    if (Number.isFinite(slowest) && traffic.peakVmMbps > slowest * 1000) findings.push({ severity: 'warning', message: `${peak.name} peaks at ${fmt(traffic.peakVmMbps)} Mbps, above one ${fmt(slowest, 1)} Gbps adapter. With SET each VM network adapter uses one team member at a time, so check this VM's placement and adapter speed.` })
  }

  findings.push({ severity: 'info', message: 'Deploy these intents with Network ATC where your Windows Server edition and topology support it, and validate the switch configuration before production.', source: NETWORK_SOURCES.networkAtc })

  const intentSummary = [
    ...intents.map((intent) => `${intent.name}: ${intent.types.join(', ') || 'no traffic type'} on ${intent.adapters} × ${fmt(intent.speedGbps, 1)} Gbps per host${intent.setTeam ? ' (SET team)' : ''}`),
    `Management VLAN ${inputs.managementVlan || 'TBD'}; compute VLANs ${inputs.computeVlans || 'TBD'}; live migration ${inputs.liveMigrationNetworks} network(s), VLAN ${inputs.liveMigrationVlan || 'TBD'}`,
    ...(usesS2d ? [`S2D storage: ${inputs.rdmaProtocol === 'none' ? 'TCP' : inputs.rdmaProtocol === 'iwarp' ? 'iWARP' : 'RoCE v2'}, VLANs ${inputs.storageVlans || 'TBD'}`] : []),
    ...(inputs.bmcPortsPerNode > 0 ? [`BMC: ${inputs.bmcPortsPerNode} port(s) per host on the out-of-band network`] : []),
    ...(san ? [san.protocol === 'none'
      ? 'SAN: no connectivity chosen'
      : `SAN: ${san.protocol === 'fc' ? 'Fibre Channel' : san.protocol === 'iscsi' ? 'iSCSI' : 'other'}, ${inputs.san.adaptersPerHost} adapter(s) × ${inputs.san.portsPerAdapter} port(s) at ${fmt(inputs.san.speedGbps, 1)} Gbps per host, ${inputs.san.pathsPerLun} paths per LUN, ${inputs.san.fabrics} fabric(s), MPIO ${inputs.san.mpio ? 'on' : 'off'}`] : []),
  ]
  return {
    hostPortsPerNode,
    totalHostPorts: hosts * hostPortsPerNode,
    bmcPorts: hosts * inputs.bmcPortsPerNode,
    aggregateGbpsPerNode: intents.reduce((total, intent) => total + intent.adapters * intent.speedGbps, 0),
    intents,
    intentSummary,
    san,
    traffic,
    findings,
  }
}
