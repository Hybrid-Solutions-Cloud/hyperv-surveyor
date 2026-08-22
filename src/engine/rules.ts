/**
 * RULE TABLES — every value carries its basis and source.
 *
 * BASIS TAGS
 *   MS      Microsoft-documented hard rule. Engine enforces it; invalid designs are errors.
 *   MS-REC  Microsoft recommendation. Engine defaults to it; overrides produce warnings.
 *   TOOL    Our assumption. No vendor publishes it. Must be visibly labelled in the UI.
 *
 * If you change a number here, change its SOURCE too, or delete the source and retag it TOOL.
 * A number with a stale citation is worse than a number with none.
 */
import type { Resiliency, S2dMedia, TierId, TierPolicy } from './types'

export const TB_TO_GIB = 931.3225746154785 // 1 decimal TB = 1e12 bytes = 931.32 GiB
export const GIB_TO_TIB = 1 / 1024

export const SRC = {
  s2dHardware:
    'https://learn.microsoft.com/windows-server/storage/storage-spaces/storage-spaces-direct-hardware-requirements',
  faultTolerance:
    'https://learn.microsoft.com/windows-server/storage/storage-spaces/fault-tolerance',
  nestedResiliency:
    'https://learn.microsoft.com/windows-server/storage/storage-spaces/nested-resiliency',
  planVolumes: 'https://learn.microsoft.com/windows-server/storage/storage-spaces/plan-volumes',
  csv: 'https://learn.microsoft.com/windows-server/failover-clustering/failover-cluster-csvs',
  quorum: 'https://learn.microsoft.com/windows-server/storage/storage-spaces/quorum',
  maxScale:
    'https://learn.microsoft.com/windows-server/virtualization/hyper-v/maximum-scale-limits',
  numa:
    'https://learn.microsoft.com/windows-server/virtualization/hyper-v/manage/non-uniform-memory-access',
  storageArchitectures:
    'https://learn.microsoft.com/windows-server/failover-clustering/storage-architectures',
  dynamicMemory:
    'https://learn.microsoft.com/windows-server/virtualization/hyper-v/dynamic-memory',
  sqlBestPractice:
    'https://learn.microsoft.com/sql/linux/configure/performance-best-practices-operating-system',
  s2dOverview:
    'https://learn.microsoft.com/windows-server/storage/storage-spaces/storage-spaces-direct-overview',
  networkAtc: 'https://learn.microsoft.com/windows-server/networking/network-atc/network-atc',
  removedFeatures:
    'https://learn.microsoft.com/windows-server/get-started/removed-deprecated-features-windows-server-2022',
} as const

// ---------------------------------------------------------------------------
// Hard limits [MS]
// ---------------------------------------------------------------------------
export const LIMITS = {
  /** [MS] S2D clusters: 2-16 nodes. NOT 64 - that is the general failover cluster max. */
  S2D_MIN_NODES: 2,
  S2D_MAX_NODES: 16,
  /** [MS] General failover cluster maximum. Applies when S2D is NOT enabled. */
  CLUSTER_MAX_NODES: 64,
  /** [MS] Max running VMs per cluster / per host, WS2025. */
  MAX_VMS_PER_CLUSTER: 8000,
  MAX_VMS_PER_HOST: 1024,
  /** [MS] WS2025 Gen 2 VM maxima. */
  MAX_VCPU_PER_VM: 2048,
  MAX_RAM_PER_VM_GIB: 240 * 1024,
  MAX_VHDX_TIB: 64,
  /** [MS] Logical processors per host, WS2025. */
  MAX_LOGICAL_PROCESSORS: 2048,
  /** [MS-REC] Soft cap on raw capacity per server - longer resync above this. */
  S2D_MAX_RAW_PER_SERVER_TB: 400,
  /** [MS] Storage pool maximum, WS2019+. */
  S2D_MAX_POOL_TB: 4000,
  /** [MS-REC] Volume/CSV recommendations. */
  MAX_CSVS_PER_CLUSTER: 64,
  MAX_CSV_SIZE_TIB: 64,
  /** [MS] VSS/volsnap-based backup reliability limit. */
  VSS_CSV_LIMIT_TIB: 10,
  /** [MS] Minimum capacity drives per server, Windows Server (not Azure Local). */
  MIN_CAPACITY_DRIVES: 4,
  /** [MS] Minimum cache drives per server when a cache tier is used. */
  MIN_CACHE_DRIVES: 2,
  /** [MS] Minimum cache device size. */
  MIN_CACHE_DRIVE_GIB: 32,
  /** [MS] SET team maximum adapters. */
  MAX_SET_ADAPTERS: 8,
  /** [MS] Windows Server core licensing minimums. */
  LICENSE_MIN_CORES_PER_SERVER: 16,
  LICENSE_MIN_CORES_PER_SOCKET: 8,
  /** [MS] S2D dynamic quorum tolerates at most 2 simultaneous node failures, any node count. */
  S2D_MAX_SIMULTANEOUS_FAILURES: 2,
  /** [MS] S2D host RAM for pool metadata: 4 GiB per TB of cache capacity per server. */
  S2D_RAM_PER_TB_CACHE_GIB: 4,
  /** [MS-REC] Cache:capacity starting ratios. Azure Local imposes a hard 15% for hybrid. */
  CACHE_RATIO_HYBRID: 0.1,
  CACHE_RATIO_ALLFLASH: 0.05,
  CACHE_RATIO_AZURE_LOCAL_HYBRID: 0.15,
  /** [MS] Minimum cache drive endurance. */
  MIN_CACHE_DWPD: 3,
  /** [MS] WS2025 campus cluster maximum. */
  CAMPUS_MAX_NODES: 10,
} as const

// ---------------------------------------------------------------------------
// Resiliency [MS] — https://learn.microsoft.com/.../fault-tolerance
// ---------------------------------------------------------------------------
export interface ResiliencyDef {
  id: Resiliency
  label: string
  minNodes: number
  maxNodes: number
  toleratedFailures: number
  /** Fixed efficiency, or null when it varies by node count / drive count. */
  fixedEfficiency: number | null
  performance: 'highest' | 'high' | 'medium' | 'lowest'
  note: string
}

export const RESILIENCY: Record<Resiliency, ResiliencyDef> = {
  'two-way-mirror': {
    id: 'two-way-mirror',
    label: 'Two-way mirror',
    minNodes: 2,
    maxNodes: 16,
    toleratedFailures: 1,
    fixedEfficiency: 0.5,
    performance: 'highest',
    note: 'Microsoft recommends nested resiliency over this for 2-node production.',
  },
  'three-way-mirror': {
    id: 'three-way-mirror',
    label: 'Three-way mirror',
    minNodes: 3,
    maxNodes: 16,
    toleratedFailures: 2,
    fixedEfficiency: 1 / 3,
    performance: 'highest',
    note: 'The safe default. Highest performance, lowest capacity efficiency.',
  },
  'nested-two-way-mirror': {
    id: 'nested-two-way-mirror',
    label: 'Nested two-way mirror (2-node)',
    minNodes: 2,
    maxNodes: 2,
    toleratedFailures: 2,
    fixedEfficiency: 0.25,
    performance: 'highest',
    note: 'Effectively a 4-way mirror. 2-node only. Cannot be converted after creation.',
  },
  'nested-map': {
    id: 'nested-map',
    label: 'Nested mirror-accelerated parity (2-node)',
    minNodes: 2,
    maxNodes: 2,
    toleratedFailures: 2,
    fixedEfficiency: null,
    performance: 'medium',
    note: 'Efficiency varies with capacity-drive count and mirror ratio. 2-node only.',
  },
  'dual-parity': {
    id: 'dual-parity',
    label: 'Dual parity (erasure coding)',
    minNodes: 4,
    maxNodes: 16,
    toleratedFailures: 2,
    fixedEfficiency: null,
    performance: 'lowest',
    note: 'Best capacity efficiency. Highest write latency and CPU. Capacity-oriented workloads only.',
  },
  'mirror-accelerated-parity': {
    id: 'mirror-accelerated-parity',
    label: 'Mirror-accelerated parity',
    minNodes: 4,
    maxNodes: 16,
    toleratedFailures: 2,
    fixedEfficiency: null,
    performance: 'medium',
    note: 'Mixes three-way mirror and dual parity in one volume. Requires ReFS.',
  },
}

/**
 * [MS] Dual-parity efficiency by node count. Two tables — hybrid and all-flash diverge above
 * 8 nodes, which is a real modelling trap: a single table gives wrong answers at 9+ nodes.
 * Source: fault-tolerance, "Dual parity efficiency for hybrid/all-flash deployments".
 */
export function dualParityEfficiency(nodes: number, media: S2dMedia): { eff: number; label: string } {
  if (nodes < 4) return { eff: 0, label: 'n/a' }
  if (media === 'hybrid') {
    if (nodes <= 6) return { eff: 0.5, label: 'RS 2+2' }
    if (nodes <= 11) return { eff: 2 / 3, label: 'RS 4+2' }
    return { eff: 0.727, label: 'LRC (8,2,1)' }
  }
  if (nodes <= 6) return { eff: 0.5, label: 'RS 2+2' }
  if (nodes <= 8) return { eff: 2 / 3, label: 'RS 4+2' }
  if (nodes <= 15) return { eff: 0.75, label: 'RS 6+2' }
  return { eff: 0.8, label: 'LRC (12,2,1)' }
}

/**
 * [MS] Nested mirror-accelerated parity efficiency, 2-node only.
 * Rows = capacity drives per server, columns = mirror percentage.
 * Source: nested-resiliency, "Capacity efficiency".
 */
const NESTED_MAP_TABLE: Record<number, Record<number, number>> = {
  4: { 0.1: 0.357, 0.2: 0.341, 0.3: 0.326 },
  5: { 0.1: 0.377, 0.2: 0.357, 0.3: 0.339 },
  6: { 0.1: 0.391, 0.2: 0.368, 0.3: 0.347 },
  7: { 0.1: 0.4, 0.2: 0.375, 0.3: 0.353 },
}

export function nestedMapEfficiency(capacityDrives: number, mirrorPct: number): number {
  const row = NESTED_MAP_TABLE[Math.min(Math.max(capacityDrives, 4), 7)] ?? NESTED_MAP_TABLE[7]
  return row[mirrorPct] ?? row[0.1]
}

/**
 * Mirror-accelerated parity (4+ nodes): a blend of three-way mirror and dual parity.
 * Microsoft does not publish a single efficiency figure — it sits between the two,
 * proportional to the mirror:parity split. We compute the blend explicitly. [TOOL blend, MS inputs]
 */
export function mapEfficiency(nodes: number, media: S2dMedia, mirrorPct: number): number {
  const parity = dualParityEfficiency(nodes, media).eff
  const mirror = 1 / 3
  return 1 / (mirrorPct / mirror + (1 - mirrorPct) / parity)
}

export function resiliencyEfficiency(
  res: Resiliency,
  nodes: number,
  media: S2dMedia,
  capacityDrives: number,
  mirrorPct: number,
): { eff: number; label: string } {
  const def = RESILIENCY[res]
  if (def.fixedEfficiency !== null) {
    return { eff: def.fixedEfficiency, label: def.label }
  }
  if (res === 'nested-map') {
    return { eff: nestedMapEfficiency(capacityDrives, mirrorPct), label: 'Nested MAP' }
  }
  if (res === 'dual-parity') {
    const d = dualParityEfficiency(nodes, media)
    return { eff: d.eff, label: `Dual parity ${d.label}` }
  }
  return {
    eff: mapEfficiency(nodes, media, mirrorPct),
    label: `MAP ${Math.round(mirrorPct * 100)}% mirror`,
  }
}

// ---------------------------------------------------------------------------
// Tier policies — every number here is [TOOL]
// ---------------------------------------------------------------------------
export const DEFAULT_TIERS: Record<TierId, TierPolicy> = {
  general: {
    id: 'general',
    label: 'General Server',
    oversubscription: 4,
    rightSizingFactor: 1.0,
    allowDynamicMemory: true,
    storageTier: 'capacity',
    hybridPlacement: 'san',
    maxVmsPerCsv: 25,
    blastRadiusTiB: 16,
  },
  database: {
    id: 'database',
    label: 'Database / Heavy',
    oversubscription: 1,
    rightSizingFactor: 1.0,
    allowDynamicMemory: false,
    storageTier: 'performance',
    hybridPlacement: 's2d',
    maxVmsPerCsv: 5,
    blastRadiusTiB: 8,
  },
  vdi: {
    id: 'vdi',
    label: 'VDI',
    oversubscription: 8,
    rightSizingFactor: 1.0,
    allowDynamicMemory: true,
    storageTier: 'capacity',
    hybridPlacement: 'san',
    maxVmsPerCsv: 50,
    blastRadiusTiB: 16,
  },
  infrastructure: {
    id: 'infrastructure',
    label: 'Infrastructure',
    oversubscription: 6,
    rightSizingFactor: 1.0,
    allowDynamicMemory: true,
    storageTier: 'capacity',
    hybridPlacement: 'san',
    maxVmsPerCsv: 25,
    blastRadiusTiB: 16,
  },
}

export const TIER_IDS: TierId[] = ['general', 'database', 'vdi', 'infrastructure']

/**
 * Auto-classification heuristics. Deliberately conservative — anything promoted out of
 * "general" is flagged autoClassified so the SE reviews it rather than trusting it. [TOOL]
 */
export const DB_NAME_PATTERN = /(sql|mssql|oracle|ora\d|postgres|pgsql|mysql|mariadb|db2|sybase|mongo|\bdb\b|dbs\d)/i
export const VDI_NAME_PATTERN = /(vdi|ctx|citrix|xendesktop|wvd|avd|rds\d|session)/i
export const INFRA_NAME_PATTERN = /(^dc\d|domain|dns|dhcp|ntp|print|jump|bastion|wsus|\bad\d)/i

export const AUTO_CLASSIFY = {
  heavyVCpu: 8,
  heavyRamGiB: 64,
  heavyStorageGiB: 2048,
} as const
