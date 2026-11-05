/**
 * What to buy for the selected new-platform design: a class-level bill of materials. Quantities come
 * from the resolved design; nothing is recalculated here. It names component classes, not products,
 * and every line says whether it is a Microsoft rule, a Microsoft recommendation, a tool assumption,
 * or a calculated figure.
 */
import { RESILIENCY, SRC } from './rules'
import { licensableCores, totalCores } from './compute'
import type { PlatformDesign } from './platformDesign'

export interface BomLine {
  category: 'Servers' | 'Drives' | 'Network' | 'Switching' | 'SAN' | 'Licensing'
  item: string
  quantity: string
  detail: string
  basis: 'Calculated' | 'MS' | 'MS-REC' | 'TOOL'
  source?: string
}

export interface BillOfMaterials {
  available: boolean
  /** Why no bill of materials is given, when it is not available. */
  reason: string | null
  title: string
  lines: BomLine[]
  /** Phase 8 hook: SAN connectivity (HBA or iSCSI NICs, MPIO, zoning) is not modelled yet. */
  sanConnectivity: { required: boolean; status: 'not-modelled'; note: string }
  caveats: string[]
}

export const BOM_CAVEATS = [
  'Recommended starting points, not a quote. Validate every line with your hardware vendor.',
  'Choose servers, network adapters and drives listed in the Windows Server Catalog for Windows Server 2025; for Storage Spaces Direct, prefer components with the Software-Defined Data Center (SDDC) Standard or Premium qualification.',
  'The fully configured cluster must pass cluster validation (Test-Cluster) before production.',
]

/** Microsoft S2D network guidance: 10 GbE minimum for 2-3 nodes; 25 GbE or faster with RDMA for 4+ nodes. [MS-REC] */
export const S2D_NETWORK_SOURCE = SRC.s2dHardware

const fmt = (value: number, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits })

/** Builds the bill of materials from a resolved design. Only new-platform designs that fit get one. */
export function buildBillOfMaterials(design: PlatformDesign): BillOfMaterials {
  const usesSan = design.cfg.architecture === 'san' || design.cfg.architecture === 'hybrid'
  const sanConnectivity = {
    required: usesSan,
    status: 'not-modelled' as const,
    note: usesSan
      ? 'SAN connectivity (Fibre Channel HBAs or iSCSI adapters, MPIO, zoning, path counts) is not planned yet. Size it with your array vendor.'
      : 'Not applicable: this design has no external array.',
  }
  const empty = (reason: string): BillOfMaterials => ({ available: false, reason, title: 'What to buy', lines: [], sanConnectivity, caveats: BOM_CAVEATS })
  if (design.path !== 'new-platform') return empty('A bill of materials is given for new-platform designs only.')
  if (design.status === 'no-workload') return empty('Add workloads first.')
  if (design.feasible !== true || design.totalNodes === null) {
    return empty(design.status === 'split-failed'
      ? 'Not given: the selected split cannot place the workload.'
      : design.status === 'over-limit'
        ? 'Not given: the selected design does not fit one cluster. Choose a viable option on the Options or Shortlist page, or choose to split.'
        : `Not given: the selected design is blocked. ${design.explanation} Choose a viable option on the Options or Shortlist page.`)
  }

  const cfg = design.cfg
  const node = cfg.node
  const nodes = design.totalNodes
  const clusters = design.status === 'split' ? design.clusters.length : 1
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'
  const perNodeLicensable = licensableCores(node)
  const lines: BomLine[] = []

  lines.push({
    category: 'Servers',
    item: 'Hyper-V host servers',
    quantity: `${fmt(nodes)}`,
    detail: `${clusters > 1 ? `${clusters} clusters by your choice, ` : ''}${fmt(design.workloadNodes ?? 0)} carrying workload plus N+${cfg.spareNodes}${clusters > 1 ? ' in each cluster' : ''}. ${node.sockets} sockets × ${node.coresPerSocket} cores (${totalCores(node)} cores), ${fmt(node.ramGiB)} GiB RAM per server${node.cpuVendor && node.cpuVendor !== 'unknown' ? `, ${node.cpuVendor.toUpperCase()} processors` : ''}. All servers the same make and model.`,
    basis: 'Calculated',
  })
  lines.push({
    category: 'Servers',
    item: 'Boot drives',
    quantity: `${fmt(nodes * 2)} (2 per server)`,
    detail: 'Mirrored boot pair per server, 200 GB minimum recommended. RAID 1 for boot is supported, not required.',
    basis: 'MS-REC',
    source: SRC.s2dHardware,
  })

  if (usesS2d && design.storage?.showLocalDrives) {
    const rawPerNodeTB = node.capacityDrivesPerNode * node.capacityDriveTB
    lines.push({
      category: 'Drives',
      item: `Capacity drives (${node.media === 'hybrid' ? 'HDD' : 'NVMe or SSD flash'})`,
      quantity: `${node.capacityDrivesPerNode} per server, ${fmt(node.capacityDrivesPerNode * nodes)} in total`,
      detail: `${node.capacityDriveTB} TB each: ${fmt(rawPerNodeTB, 2)} TB raw per server, ${fmt(rawPerNodeTB * nodes, 1)} TB raw in total. ${RESILIENCY[cfg.resiliency].label} gives ${fmt(design.storage.s2dUsableTiB ?? 0, 1)} TiB usable. Same number and type of drives in every server; solid-state drives need power-loss protection.`,
      basis: 'Calculated',
      source: SRC.s2dHardware,
    })
    if (node.cacheDrivesPerNode > 0 && node.cacheDriveTB > 0) {
      lines.push({
        category: 'Drives',
        item: 'Cache drives',
        quantity: `${node.cacheDrivesPerNode} per server, ${fmt(node.cacheDrivesPerNode * nodes)} in total`,
        detail: `${node.cacheDriveTB} TB each, at least 3 drive writes per day endurance. Cache adds no usable capacity.`,
        basis: 'MS-REC',
        source: SRC.s2dHardware,
      })
    } else {
      lines.push({ category: 'Drives', item: 'Cache drives', quantity: 'None', detail: 'All-flash capacity drives do not need a storage bus cache.', basis: 'MS', source: SRC.s2dHardware })
    }
  }

  // Network classes. Storage: Microsoft's S2D guidance. Other traffic and BMC ports: tool assumptions.
  const smallestCluster = design.status === 'split' ? Math.min(...design.clusters.map((cluster) => cluster.nodes ?? Infinity)) : nodes
  let storagePorts = 0
  if (usesS2d) {
    storagePorts = 2
    lines.push({
      category: 'Network',
      item: smallestCluster >= 4 ? 'Storage network adapters: 25 GbE or faster, RDMA' : 'Storage network adapters: 10 GbE minimum (25 GbE RDMA recommended)',
      quantity: `2 ports per server, ${fmt(nodes * 2)} in total`,
      detail: smallestCluster >= 4
        ? 'For 4 or more nodes Microsoft recommends RDMA-capable adapters (iWARP recommended, or RoCE, which needs Data Center Bridging on the switches) at 25 Gbps or faster, with two or more connections per node.'
        : 'For 2 to 3 nodes Microsoft states a 10 Gbps minimum with two or more connections per node; RDMA at 25 Gbps is recommended for performance. Two-node clusters can be cabled switchless.',
      basis: 'MS-REC',
      source: S2D_NETWORK_SOURCE,
    })
  }
  const hostPorts = 2
  lines.push({
    category: 'Network',
    item: usesS2d ? 'Management, VM and live-migration adapters: 25 GbE' : 'Management, VM, live-migration and cluster adapters: 25 GbE',
    quantity: `${hostPorts} ports per server, ${fmt(nodes * hostPorts)} in total`,
    detail: 'A redundant pair teamed with Switch Embedded Teaming. Tool assumption: converging these onto the storage adapters with Network ATC is also valid; confirm in the network design.',
    basis: 'TOOL',
    source: SRC.networkAtc,
  })
  lines.push({
    category: 'Network',
    item: 'Out-of-band management (BMC) port',
    quantity: `1 per server, ${fmt(nodes)} in total`,
    detail: '1 GbE management port for the server baseboard controller. Tool assumption.',
    basis: 'TOOL',
  })
  const dataPorts = nodes * (storagePorts + hostPorts)
  lines.push({
    category: 'Switching',
    item: 'Top-of-rack switch ports',
    quantity: `${fmt(dataPorts)} × 25 GbE and ${fmt(nodes)} × 1 GbE`,
    detail: `Spread across a redundant switch pair (${fmt(Math.ceil(dataPorts / 2))} data ports on each). Add uplinks and inter-switch links.${usesS2d ? ' With RoCE, the switches must support Data Center Bridging (PFC and ETS).' : ''} Tool assumption for the pair; port counts are calculated.`,
    basis: 'TOOL',
  })

  if (usesSan && design.storage) {
    const storage = design.storage
    const terminal = design.growth?.points[design.growth.points.length - 1]
    if (storage.sanMode === 'calculated' && storage.sanToBuyUsableTiB !== null) {
      lines.push({
        category: 'SAN',
        item: 'External array, usable capacity to buy',
        quantity: `${fmt(storage.sanToBuyUsableTiB, 1)} TiB usable`,
        detail: `Holds ${fmt(storage.requiredSanTiB, 1)} TiB of data while keeping ${fmt((storage.sanFreeSpaceTargetPct ?? 0) * 100)}% free (${fmt(storage.sanToBuyEffectiveTiB ?? 0, 1)} TiB effective), assuming ${storage.sanDrr}:1 data reduction. Data reduction varies by data type: use a vendor guarantee or a measured figure.${terminal && terminal.year > 0 && terminal.sanToBuyUsableTiB !== null ? ` Year ${terminal.year} of the growth plan needs ${fmt(terminal.sanToBuyUsableTiB, 1)} TiB usable.` : ''}`,
        basis: 'Calculated',
      })
    } else if (storage.sanMode === 'fixed') {
      lines.push({
        category: 'SAN',
        item: 'External array (entered)',
        quantity: `${fmt(storage.sanUsableTiB ?? 0, 1)} TiB usable`,
        detail: `The array size you entered, ${fmt(storage.sanEffectiveTiB ?? 0, 1)} TiB effective at ${storage.sanDrr}:1. Nothing more to buy unless the growth plan says otherwise.`,
        basis: 'Calculated',
      })
    }
    lines.push({ category: 'SAN', item: 'SAN connectivity', quantity: 'Not planned yet', detail: sanConnectivity.note, basis: 'TOOL' })
  }

  lines.push({
    category: 'Licensing',
    item: usesS2d ? 'Windows Server Datacenter core licenses' : 'Windows Server core licenses',
    quantity: `${fmt(perNodeLicensable * nodes)} cores`,
    detail: `${perNodeLicensable} licensable cores per server (minimum 16 per server and 8 per socket) × ${fmt(nodes)} servers.${usesS2d ? ' Storage Spaces Direct requires Datacenter edition.' : ' Edition and pricing are decided in the cost model.'}`,
    basis: 'MS',
    source: usesS2d ? SRC.s2dOverview : undefined,
  })

  return {
    available: true,
    reason: null,
    title: `What to buy: ${design.platformLabel}`,
    lines,
    sanConnectivity,
    caveats: BOM_CAVEATS,
  }
}
