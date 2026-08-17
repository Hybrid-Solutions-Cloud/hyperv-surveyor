/**
 * HAAS Hyper-V Surveyor — core types
 *
 * UNITS CONVENTION (enforced throughout the engine):
 *   RAM      -> GiB  (base-2)
 *   Storage  -> GiB  (base-2) internally; displayed as TiB
 *   Drives   -> TB   (decimal, as drives are sold). Converted via TB_TO_GIB.
 *   Cores    -> physical cores, never logical processors.
 *
 * Mixing units is the single commonest source of silent error in sizing tools.
 * Every field name below carries its unit.
 */

export type TierId = 'general' | 'database' | 'vdi' | 'infrastructure'

export type StorageArchitecture = 'san' | 's2d' | 'hybrid'

export type S2dMedia = 'all-flash' | 'hybrid'

export type Resiliency =
  | 'two-way-mirror'
  | 'three-way-mirror'
  | 'nested-two-way-mirror'
  | 'nested-map'
  | 'dual-parity'
  | 'mirror-accelerated-parity'

export type BackupMethod = 'rct' | 'vss-volsnap'

export type StorageTier = 'performance' | 'capacity'

export type PowerState = 'poweredOn' | 'poweredOff' | 'suspended'

/** A single workload. Imported from RVTools, or entered by hand. Always editable. */
export interface Vm {
  id: string
  name: string
  tier: TierId
  vCpu: number
  ramGiB: number
  /** Real consumed storage — from vPartition where available. */
  storageGiB: number
  /** Allocated/provisioned storage. Shown alongside so the thin gap is visible. */
  provisionedGiB: number
  powerState: PowerState
  include: boolean
  guestOs?: string
  sourceCluster?: string
  sourceHost?: string
  /** True when the tier was assigned by auto-classification and not reviewed. */
  autoClassified?: boolean
  notes?: string
}

/** Per-tier policy. Every numeric default here is a [TOOL] assumption — see rules.ts. */
export interface TierPolicy {
  id: TierId
  label: string
  /** vCPU : physical core. [TOOL] — Microsoft publishes no ratio. */
  oversubscription: number
  /** Multiplier applied to allocated vCPU/vRAM. 1.0 = size on allocation (conservative). */
  rightSizingFactor: number
  allowDynamicMemory: boolean
  storageTier: StorageTier
  /** [TOOL] — Microsoft imposes no VMs-per-CSV limit. */
  maxVmsPerCsv: number
  /** [TOOL] — recovery blast radius, in TiB, for one CSV/LUN. */
  blastRadiusTiB: number
}

/** Physical node specification. */
export interface NodeSpec {
  sockets: number
  coresPerSocket: number
  ramGiB: number
  /** S2D / hybrid only. */
  capacityDrivesPerNode: number
  capacityDriveTB: number
  cacheDrivesPerNode: number
  cacheDriveTB: number
  media: S2dMedia
}

export interface SanSpec {
  /** Usable capacity, NOT effective. Effective already has DRR baked in. */
  usableTiB: number
  /** Data reduction ratio. Dedupe + compression + pattern removal ONLY. */
  drr: number
  /** Modelled separately from DRR and never folded into it. */
  thinProvisioningSavings: number
}

export interface ClusterConfig {
  architecture: StorageArchitecture
  spareNodes: number
  resiliency: Resiliency
  /** Fraction of a nested-MAP volume that is mirror. Only used for nested-map. */
  nestedMapMirrorPct: 0.1 | 0.2 | 0.3
  backupMethod: BackupMethod
  node: NodeSpec
  san: SanSpec
  /** Fraction of workload storage placed on S2D in a hybrid design. Remainder on SAN. */
  hybridS2dShare: number
  growthFactor: number
  smtFactor: number
  hostCoreReservePct: number
  hostRamReserveGiB: number
  hostRamReservePct: number
}

export interface ComputeDemand {
  requiredPCores: number
  requiredRamGiB: number
  totalVCpu: number
  vmCount: number
  byTier: Record<TierId, { pCores: number; ramGiB: number; vms: number; storageGiB: number }>
}

export interface CapacityResult {
  rawTiB: number
  reserveTiB: number
  availableTiB: number
  usableTiB: number
  efficiency: number
  efficiencyLabel: string
}

export interface CsvPlan {
  tier: TierId
  storageTier: StorageTier
  domain: 's2d' | 'san'
  count: number
  sizeTiB: number
  totalTiB: number
  vmsPerCsv: number
  driver: 'capacity' | 'blast-radius' | 'node-count'
  roundedUpFrom: number
  filesystem: 'ReFS' | 'NTFS'
}

export type Severity = 'error' | 'warning' | 'info'

export interface Finding {
  severity: Severity
  code: string
  message: string
  /** [MS] hard rule | [MS-REC] recommendation | [TOOL] our assumption */
  basis: 'MS' | 'MS-REC' | 'TOOL'
  source?: string
}

export type BindingConstraint = 'cpu' | 'memory' | 'storage' | 'node-floor' | 'none'

export interface SizingResult {
  architecture: StorageArchitecture
  resiliency: Resiliency
  feasible: boolean
  nodes: number
  workloadNodes: number
  binding: BindingConstraint
  bindingExplanation: string
  nodesIfCpuOnly: number
  nodesIfMemoryOnly: number
  nodesIfStorageOnly: number
  demand: ComputeDemand
  capacity: CapacityResult | null
  sanCapacityTiB: number | null
  requiredStorageTiB: number
  csvPlans: CsvPlan[]
  totalCsvs: number
  findings: Finding[]
  utilisationCeiling: number
  resiliencyOverheadPct: number
  licensableCoresPerNode: number
  totalLicensableCores: number
}

export interface ReverseResult {
  nodes: number
  workloadNodes: number
  availablePCores: number
  availableRamGiB: number
  availableStorageTiB: number
  usedPCores: number
  usedRamGiB: number
  usedStorageTiB: number
  headroomPCores: number
  headroomRamGiB: number
  headroomStorageTiB: number
  binding: BindingConstraint
  bindingExplanation: string
  additionalVmsByTier: Record<TierId, number>
  findings: Finding[]
  capacity: CapacityResult | null
}
