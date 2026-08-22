import type { ClusterConfig } from './types'

export type RdmaProtocol = 'none' | 'roce-v2' | 'iwarp'

export interface NetworkDesignInputs {
  adaptersPerNode: number
  adapterSpeedGbps: number
  rdmaProtocol: RdmaProtocol
  dataCenterBridging: boolean
  separateStorageFabric: boolean
  managementVlan: string
  computeVlans: string
  liveMigrationVlan: string
  storageVlans: string
  liveMigrationNetworks: number
  switchRedundancy: boolean
}

export const DEFAULT_NETWORK_INPUTS: NetworkDesignInputs = {
  adaptersPerNode: 4,
  adapterSpeedGbps: 25,
  rdmaProtocol: 'roce-v2',
  dataCenterBridging: true,
  separateStorageFabric: true,
  managementVlan: '10',
  computeVlans: '100-199',
  liveMigrationVlan: '20',
  storageVlans: '30,31',
  liveMigrationNetworks: 2,
  switchRedundancy: true,
}

export interface NetworkFinding {
  severity: 'error' | 'warning' | 'info'
  message: string
  source?: string
}

export interface NetworkDesign {
  totalHostPorts: number
  aggregateGbpsPerNode: number
  intentSummary: string[]
  findings: NetworkFinding[]
}

const SRC = {
  s2dNetwork: 'https://learn.microsoft.com/windows-server/storage/storage-spaces/deploy-storage-spaces-direct',
  networkAtc: 'https://learn.microsoft.com/windows-server/networking/network-atc/network-atc',
  set: 'https://learn.microsoft.com/windows-server/networking/technologies/hpn/hpn-software-only-features',
}

export function designNetwork(cfg: ClusterConfig, nodes: number, requested: Partial<NetworkDesignInputs> = {}): NetworkDesign {
  const inputs = { ...DEFAULT_NETWORK_INPUTS, ...requested }
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'
  const usesSan = cfg.architecture === 'san' || cfg.architecture === 'hybrid'
  const findings: NetworkFinding[] = []
  if (usesS2d && inputs.adapterSpeedGbps < 10) findings.push({ severity: 'error', message: 'Storage Spaces Direct requires at least 10 GbE networking between every node.', source: SRC.s2dNetwork })
  if (usesS2d && inputs.rdmaProtocol === 'none') findings.push({ severity: 'warning', message: 'RDMA is not selected. Microsoft recommends RDMA for S2D, especially with all-flash media.', source: SRC.s2dNetwork })
  if (usesS2d && inputs.rdmaProtocol === 'roce-v2' && !inputs.dataCenterBridging) findings.push({ severity: 'error', message: 'RoCE v2 is selected without Data Center Bridging. Configure lossless priority flow control and QoS end to end, or use iWARP.', source: SRC.s2dNetwork })
  if (usesS2d && inputs.adaptersPerNode < 2) findings.push({ severity: 'error', message: 'At least two host adapters are required to avoid a single network-adapter failure taking storage and cluster traffic offline.', source: SRC.s2dNetwork })
  if (!inputs.switchRedundancy) findings.push({ severity: 'warning', message: 'The design does not confirm redundant top-of-rack switching. A single switch failure can isolate multiple hosts.' })
  if (cfg.architecture === 'hybrid' && !inputs.separateStorageFabric) findings.push({ severity: 'warning', message: 'S2D east-west traffic and SAN traffic share a fabric. Validate QoS and failure isolation so SAN load or resync cannot starve the other storage domain.' })
  if (inputs.adaptersPerNode > 8) findings.push({ severity: 'error', message: 'Switch Embedded Teaming supports a maximum of eight adapters in one team.', source: SRC.set })
  findings.push({ severity: 'info', message: 'Use Network ATC intents where the selected Windows Server edition and topology support them, and validate the final switch configuration before production.', source: SRC.networkAtc })
  const intentSummary = [
    `Management: VLAN ${inputs.managementVlan || 'TBD'}`,
    `Compute: VLANs ${inputs.computeVlans || 'TBD'}`,
    `Live migration: ${inputs.liveMigrationNetworks} network(s), VLAN ${inputs.liveMigrationVlan || 'TBD'}`,
  ]
  if (usesS2d) intentSummary.push(`S2D storage: ${inputs.rdmaProtocol === 'none' ? 'TCP' : inputs.rdmaProtocol.toUpperCase()}, VLANs ${inputs.storageVlans || 'TBD'}`)
  if (usesSan) intentSummary.push('SAN: validate FC or Ethernet fabric ports, MPIO paths, zoning, and array host-personality configuration separately')
  return {
    totalHostPorts: Math.max(0, nodes) * Math.max(0, inputs.adaptersPerNode),
    aggregateGbpsPerNode: Math.max(0, inputs.adaptersPerNode) * Math.max(0, inputs.adapterSpeedGbps),
    intentSummary,
    findings,
  }
}
