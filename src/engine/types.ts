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

/** How externally shared SAN CSV/LUN counts are selected. */
export type SanCsvLayoutMode = 'balanced' | 'granular' | 'custom'

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
  /** Allocated/provisioned storage. Shown and exported so the thin gap is visible; never sized. */
  provisionedGiB: number
  powerState: PowerState
  include: boolean
  guestOs?: string
  sourceCluster?: string
  sourceHost?: string
  sourceDatacenter?: string
  /** vCenter (RVTools VI SDK Server). With the name, the identity used to merge two imports. */
  sourceVCenter?: string
  sourceVmUuid?: string
  sourceVmId?: string
  /** A disk is shared with another VM (multi-writer or bus sharing). */
  hasSharedDisk?: boolean
  /** Shared space removed from this VM because another VM in the group already counts it. */
  sharedStorageDedupedGiB?: number
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
  /** True when a large VM stayed in General and a person should confirm its tier. */
  sizeReview?: boolean
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

/**
 * fixed       the array size is an input and a hard limit (existing hardware, known array).
 * calculated  the array is an output: Surveyor reports the capacity to buy (new designs).
 * Absent means fixed, so every existing-hardware profile keeps its entered array size.
 */
export type SanSizingMode = 'fixed' | 'calculated'

export interface ClusterConfig {
  architecture: StorageArchitecture
  sanSizingMode?: SanSizingMode
  /**
   * Free space to keep on the SAN, calculated or fixed. Default 20%. A calculated array is sized to
   * it; a fixed array above it gets a warning, and only a fixed array above 100% fails. [TOOL]
   */
  sanFreeSpaceTargetPct?: number
  spareNodes: number
  resiliency: Resiliency
  /** Fraction of a nested-MAP volume that is mirror. Only used for nested-map. */
  nestedMapMirrorPct: 0.1 | 0.2 | 0.3
  backupMethod: BackupMethod
  /** SAN only. Balanced is the operational default; granular enforces tier recovery targets. */
  sanCsvLayoutMode: SanCsvLayoutMode
  /** Requested cluster-wide SAN CSV/LUN total when sanCsvLayoutMode is custom. */
  sanCustomCsvCount: number
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
  /**
   * Allocation divides vCPU by the tier ratio. Measured mode sizes a VM with a CPU P95 on that actual
   * use, with no oversubscription division; VMs without a measurement stay on allocation.
   */
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
  /** Free space included in sizeTiB. SAN only; S2D volumes report 0. totalTiB stays the data held. */
  freeSpaceTargetPct?: number
  /** Count that would result if the editable per-tier recovery targets were enforced. */
  granularAdvisoryCount: number
  /** True when the editable recovery-unit size and VM grouping targets control this plan. */
  recoveryGroupingApplied: boolean
  layoutMode: SanCsvLayoutMode | 's2d'
  driver: 'capacity' | 'vm-count' | 'both' | 'node-count' | 'operational-balance' | 'custom-target'
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

export type BindingConstraint = 'cpu' | 'memory' | 'storage' | 'node-floor' | 'vm-count' | 'none'

/** The array a new design needs. Present only when the SAN is calculated. */
export interface SanSizing {
  /** Data the SAN domain must hold, after growth. */
  requiredTiB: number
  freeSpaceTargetPct: number
  drr: number
  /** Effective capacity including the free-space target. */
  effectiveTiB: number
  /** Usable capacity to buy: effective capacity divided by the data reduction ratio. */
  usableToBuyTiB: number
}

export interface SizingResult {
  architecture: StorageArchitecture
  resiliency: Resiliency
  feasible: boolean
  /** The design's node count when feasible. When infeasible this is the ceiling, not a design. */
  nodes: number
  workloadNodes: number
  /**
   * Nodes the workload needs in one cluster, even above the limit. Null when no count can work,
   * such as a fixed array that is too small or a VM larger than one host.
   */
  nodesNeeded: number | null
  /** Nodes needed for CPU, memory and VM count alone, shown even when storage blocks the design. */
  computeNodesNeeded: number | null
  /** Most nodes one cluster of this storage type and resiliency may have. */
  clusterNodeLimit: number
  sanSizing: SanSizing | null
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

/**
 * no-workload  nothing to test; the result states capacity only.
 * fits         every resource holds the workload and no hard finding blocks the design.
 * over         a resource is above 100%, which forward sizing also fails.
 * blocked      a hard finding makes the design invalid whatever the utilization is.
 */
export type ReverseStatus = 'no-workload' | 'fits' | 'over' | 'blocked'

export interface ReverseResult {
  status: ReverseStatus
  /** Short statement of the status, safe to use as a heading. */
  headline: string
  /** Hard findings that make the design invalid, excluding resource shortfalls. */
  blockers: string[]
  storagePerformance: StoragePerformanceAssessment
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
  storageDomains: Array<{
    domain: 's2d' | 'san'
    availableTiB: number
    usedTiB: number
    /** Up to 100% of the domain. */
    headroomTiB: number
    utilisationPct: number
    /** Free space kept on this domain; 0 on S2D, which has its own reserve. */
    freeSpaceTargetPct: number
    /** Room left before the free-space target. Negative once the target is exceeded. */
    headroomToTargetTiB: number
  }>
}
