/**
 * Hyper-V Surveyor — core types
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
export type CpuVendor = 'intel' | 'amd' | 'unknown'

export type Resiliency =
  | 'two-way-mirror'
  | 'three-way-mirror'
  | 'nested-two-way-mirror'
  | 'nested-map'
  | 'dual-parity'
  | 'mirror-accelerated-parity'

export type BackupMethod = 'rct' | 'vss-volsnap'

export type StorageTier = 'performance' | 'capacity'

export type HybridPlacement = 's2d' | 'san' | 'split'

export type WitnessType = 'cloud' | 'file-share' | 'disk' | 'none'

export type PowerState = 'poweredOn' | 'poweredOff' | 'suspended'

export type GrowthStrategy = 'build-now' | 'phased'

export type SizingBasis = 'allocation' | 'measured-p95'

export type PerformanceSource = 'manual' | 'live-optics' | 'aria-operations' | 'azure-migrate' | 'scom' | 'other'

export interface VmPerformanceMetrics {
  cpuP95Pct?: number
  memoryP95Pct?: number
  storageIopsP95?: number
  storageThroughputMBpsP95?: number
  storageLatencyMsP95?: number
  networkMbpsP95?: number
  observationDays?: number
  source?: PerformanceSource
}

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
  sourceCpuVendor?: CpuVendor
  firmware?: 'bios' | 'efi' | 'unknown'
  diskCount?: number
  nicCount?: number
  snapshotCount?: number
  hasRdm?: boolean
  encrypted?: boolean
  hasVtpm?: boolean
  performance?: VmPerformanceMetrics
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
  /** Storage domain used by this tier when the selected architecture is hybrid. */
  hybridPlacement: HybridPlacement
  /** [TOOL] target for recovery grouping — Microsoft imposes no VMs-per-CSV limit. */
  maxVmsPerCsv: number
  /** [TOOL] maximum logical size of one recovery unit, in TiB. */
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
  cpuVendor?: CpuVendor
  /** Validated sustainable S2D performance delivered per node; 0 means not entered. */
  s2dIopsPerNode?: number
  s2dThroughputMBpsPerNode?: number
}

export interface SanSpec {
  /** Usable capacity, NOT effective. Effective already has DRR baked in. */
  usableTiB: number
  /** Data reduction ratio. Dedupe + compression + pattern removal ONLY. */
  drr: number
  /** Modelled separately from DRR and never folded into it. */
  thinProvisioningSavings: number
  /** Validated sustainable array performance; 0 means not entered. */
  maxIops?: number
  maxThroughputMBps?: number
}

export interface ClusterConfig {
  architecture: StorageArchitecture
  spareNodes: number
  resiliency: Resiliency
  /** Fraction of a nested-MAP volume that is mirror. Only used for nested-map. */
  nestedMapMirrorPct: 0.1 | 0.2 | 0.3
  backupMethod: BackupMethod
  /** Quorum witness selected for the cluster design. */
  witnessType?: WitnessType
  node: NodeSpec
  san: SanSpec
  /** S2D share used only by tiers whose hybrid placement is explicitly set to split. */
  hybridS2dShare: number
  /** One-time multiplier on current demand. 1.25 reserves 25% immediate headroom. */
  growthFactor: number
  /** Expected compound annual workload growth. 0.1 = 10% per year. */
  annualGrowthPct?: number
  /** Number of annual forecast points after today. */
  growthHorizonYears?: number
  /** Build the terminal forecast now, or add nodes as demand crosses thresholds. */
  growthStrategy?: GrowthStrategy
  /** Allocation is conservative. Measured mode uses per-VM P95 metrics where present. */
  sizingBasis?: SizingBasis
  /** Safety multiplier applied to measured P95 CPU and memory demand. */
  performanceComfortFactor?: number
  /** Target/source per-core benchmark ratio. Applied only in measured P95 mode. */
  cpuPerformanceFactor?: number
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
  byTier: Record<TierId, {
    pCores: number
    ramGiB: number
    /** VMs present in the source inventory. */
    vms: number
    /** Equivalent VM count after the selected workload-growth factor. */
    plannedVms: number
    storageGiB: number
  }>
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
  plannedVms: number
  vmsPerCsv: number
  maxSizeTiB: number
  countByCapacity: number
  countByVmLimit: number
  maxVmsPerCsv: number
  driver: 'capacity' | 'vm-count' | 'both' | 'node-count'
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
  requiredS2dTiB: number
  requiredSanTiB: number
  csvPlans: CsvPlan[]
  totalCsvs: number
  findings: Finding[]
  utilisationCeiling: number
  resiliencyOverheadPct: number
  licensableCoresPerNode: number
  totalLicensableCores: number
  performanceAssessment: PerformanceAssessment
  storagePerformance: StoragePerformanceAssessment
}

export interface StoragePerformanceAssessment {
  measuredVmCoveragePct: number
  requiredS2dIops: number
  requiredS2dThroughputMBps: number
  requiredSanIops: number
  requiredSanThroughputMBps: number
  availableS2dIops: number | null
  availableS2dThroughputMBps: number | null
  availableSanIops: number | null
  availableSanThroughputMBps: number | null
  validated: boolean
}

export type DataConfidence = 'allocation-only' | 'low' | 'medium' | 'high'

export interface PerformanceAssessment {
  basis: SizingBasis
  confidence: DataConfidence
  score: number
  includedVms: number
  cpuCoveragePct: number
  memoryCoveragePct: number
  storagePerformanceCoveragePct: number
  observationCoveragePct: number
  measuredVms: number
  fallbackVms: number
  observationDaysMedian: number | null
  sources: string[]
  notes: string[]
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
  storageDomains: Array<{ domain: 's2d' | 'san'; availableTiB: number; usedTiB: number; headroomTiB: number; utilisationPct: number }>
}
