/**
 * Backup and disaster recovery for the Implementation plan. RPO and RTO are checked against the
 * strategy you choose, with the assumptions stated:
 * - Hyper-V Replica sends changes every 30 seconds, 5 minutes or 15 minutes; a failover cluster needs
 *   the Hyper-V Replica Broker role. replication-overview
 * - Azure Site Recovery replicates Hyper-V VMs every 30 seconds (not to premium storage) or 5 minutes.
 *   hyper-v-azure-common-questions. Blockers come from hyper-v-azure-support-matrix.
 * - Storage replication: RPO and RTO depend on the array; validate with your array vendor.
 * - Backup only: RPO is the backup interval; RTO is the restore time at your recovery throughput.
 */
import type { SizingResult, Vm } from './types'

export type DrStrategy = 'none' | 'hyper-v-replica' | 'azure-site-recovery' | 'storage-replication' | 'backup-only'
export type SeedingMethod = 'network' | 'offline-media'

export const DR_STRATEGY_LABELS: Record<DrStrategy, string> = {
  'none': 'Not selected',
  'hyper-v-replica': 'Hyper-V Replica',
  'azure-site-recovery': 'Azure Site Recovery',
  'storage-replication': 'Storage replication',
  'backup-only': 'Backup restore only',
}

export interface DrDesignInputs {
  strategy: DrStrategy
  rpoMinutes: number
  rtoHours: number
  protectedWorkloadPct: number
  dailyChangeRatePct: number
  burstFactor: number
  availableWanMbps: number
  secondaryCapacityPct: number
  immutableCopy: boolean
  applicationConsistent: boolean
  testFrequencyMonths: number
  /** Backup only: hours between backups. */
  backupIntervalHours: number
  /** Backup only: sustained restore throughput, MB/s. */
  restoreThroughputMBps: number
  /** Replication: hours from the decision to fail over until the protected VMs run at the secondary. */
  failoverHours: number
  /** How the first full copy reaches the secondary. */
  seedingMethod: SeedingMethod
}

export const DEFAULT_DR_INPUTS: DrDesignInputs = {
  strategy: 'hyper-v-replica',
  rpoMinutes: 5,
  rtoHours: 4,
  protectedWorkloadPct: 100,
  dailyChangeRatePct: 5,
  burstFactor: 2,
  availableWanMbps: 1000,
  secondaryCapacityPct: 100,
  immutableCopy: true,
  applicationConsistent: true,
  testFrequencyMonths: 6,
  backupIntervalHours: 24,
  restoreThroughputMBps: 1000,
  failoverHours: 1,
  seedingMethod: 'network',
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const STRATEGIES: DrStrategy[] = ['none', 'hyper-v-replica', 'azure-site-recovery', 'storage-replication', 'backup-only']

/** Brings saved DR inputs to the current shape: new fields open with their defaults. */
export function normalizeDrDesignInputs(value: unknown): DrDesignInputs {
  const input = isRecord(value) ? value : {}
  const merged = { ...DEFAULT_DR_INPUTS, ...(input as Partial<DrDesignInputs>) }
  const n = (key: keyof DrDesignInputs, min: number) => {
    const raw = merged[key]
    const parsed = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
    return typeof parsed === 'number' && Number.isFinite(parsed) ? Math.max(min, parsed) : DEFAULT_DR_INPUTS[key] as number
  }
  return {
    ...merged,
    strategy: STRATEGIES.includes(merged.strategy) ? merged.strategy : DEFAULT_DR_INPUTS.strategy,
    rpoMinutes: n('rpoMinutes', 0),
    rtoHours: n('rtoHours', 0),
    protectedWorkloadPct: Math.min(100, n('protectedWorkloadPct', 0)),
    dailyChangeRatePct: n('dailyChangeRatePct', 0),
    burstFactor: n('burstFactor', 1),
    availableWanMbps: n('availableWanMbps', 0),
    secondaryCapacityPct: n('secondaryCapacityPct', 0),
    testFrequencyMonths: n('testFrequencyMonths', 1),
    backupIntervalHours: n('backupIntervalHours', 0),
    restoreThroughputMBps: n('restoreThroughputMBps', 0),
    failoverHours: n('failoverHours', 0),
    seedingMethod: merged.seedingMethod === 'offline-media' ? 'offline-media' : 'network',
  }
}

export interface DrFinding {
  severity: 'error' | 'warning' | 'info'
  message: string
  source?: string
}

export interface AsrBlocker {
  vmName: string
  reason: string
}

export interface DrDesign {
  protectedVms: number
  protectedStorageTiB: number
  secondaryStorageTiB: number
  /** Null when no replication runs (strategy none or backup only). */
  estimatedAverageMbps: number | null
  estimatedBurstMbps: number | null
  /** Null when there is no WAN verdict to give. */
  bandwidthPasses: boolean | null
  /** The replication interval that meets your RPO, in minutes; null when not applicable. */
  replicationIntervalMinutes: number | null
  rpoPasses: boolean | null
  /** Hours to recover, under the stated assumptions; null when not estimated. */
  estimatedRecoveryHours: number | null
  rtoPasses: boolean | null
  /** Days to send the first full copy over the WAN; null for offline media or no replication. */
  seedingDays: number | null
  /** Hosts at the secondary site, before any failure reserve there; null when Azure or none. */
  secondaryHosts: number | null
  asrBlockers: AsrBlocker[]
  assumptions: string[]
  findings: DrFinding[]
}

export interface DrContext {
  /** Required storage of the design (all clusters). Defaults to the sizing result's. */
  requiredStorageTiB?: number
  /** Workload hosts of the design, for the secondary-site compute need. */
  workloadNodes?: number | null
  /** True when the primary is a failover cluster, as every design here is. */
  clustered?: boolean
}

export const DR_SOURCES = {
  replica: 'https://learn.microsoft.com/windows-server/virtualization/hyper-v/replication-overview',
  replicaSetup: 'https://learn.microsoft.com/windows-server/virtualization/hyper-v/replication-virtual-machines',
  asrFaq: 'https://learn.microsoft.com/azure/site-recovery/hyper-v-azure-common-questions',
  asrMatrix: 'https://learn.microsoft.com/azure/site-recovery/hyper-v-azure-support-matrix',
} as const

/** Hyper-V Replica intervals, minutes. [MS] */
export const REPLICA_INTERVALS = [0.5, 5, 15] as const
/** Azure Site Recovery for Hyper-V intervals, minutes. 30 seconds is not available to premium storage. [MS] */
export const ASR_INTERVALS = [0.5, 5] as const
/** ASR normal churn limit per VM, MB/s. [MS] */
export const ASR_CHURN_LIMIT_MBPS = 54
/** ASR disks per VM. [MS] */
export const ASR_MAX_DISKS = 64

const fmt = (value: number, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits })
/** Bytes in a TiB; network rates are decimal megabits. */
const TIB_BYTES = 1024 ** 4

export function designDisasterRecovery(vms: Vm[], sizing: Pick<SizingResult, 'requiredStorageTiB'>, requested: Partial<DrDesignInputs> = {}, context: DrContext = {}): DrDesign {
  const inputs = normalizeDrDesignInputs({ ...DEFAULT_DR_INPUTS, ...requested })
  const included = vms.filter((vm) => vm.include)
  const strategy = inputs.strategy
  const none = strategy === 'none'
  const replicates = strategy === 'hyper-v-replica' || strategy === 'azure-site-recovery' || strategy === 'storage-replication'
  const requiredTiB = context.requiredStorageTiB ?? sizing.requiredStorageTiB
  // Protected scope: whole VMs, and storage in the same proportion, so the two always agree.
  const protectedVms = none ? 0 : Math.round(included.length * inputs.protectedWorkloadPct / 100)
  const share = none || included.length === 0 ? 0 : protectedVms / included.length
  const protectedStorageTiB = requiredTiB * share
  const secondaryStorageTiB = protectedStorageTiB * inputs.secondaryCapacityPct / 100
  const changedBytesPerDay = protectedStorageTiB * TIB_BYTES * inputs.dailyChangeRatePct / 100
  const estimatedAverageMbps = replicates ? changedBytesPerDay * 8 / 1e6 / 86_400 : null
  const estimatedBurstMbps = estimatedAverageMbps === null ? null : estimatedAverageMbps * inputs.burstFactor
  const bandwidthPasses = estimatedBurstMbps === null || protectedVms === 0 ? null : inputs.availableWanMbps >= estimatedBurstMbps
  const findings: DrFinding[] = []
  const assumptions: string[] = []

  if (none) {
    findings.push({ severity: 'warning', message: 'No disaster-recovery strategy is selected. Cluster high availability does not protect against site loss.' })
    return { protectedVms: 0, protectedStorageTiB: 0, secondaryStorageTiB: 0, estimatedAverageMbps: null, estimatedBurstMbps: null, bandwidthPasses: null, replicationIntervalMinutes: null, rpoPasses: null, estimatedRecoveryHours: null, rtoPasses: null, seedingDays: null, secondaryHosts: null, asrBlockers: [], assumptions, findings }
  }

  // RPO by strategy.
  let replicationIntervalMinutes: number | null = null
  let rpoPasses: boolean | null = null
  if (strategy === 'hyper-v-replica' || strategy === 'azure-site-recovery') {
    const intervals: readonly number[] = strategy === 'hyper-v-replica' ? REPLICA_INTERVALS : ASR_INTERVALS
    const fitting = intervals.filter((interval) => interval <= inputs.rpoMinutes)
    replicationIntervalMinutes = fitting.length > 0 ? Math.max(...fitting) : null
    rpoPasses = replicationIntervalMinutes !== null
    const product = strategy === 'hyper-v-replica' ? 'Hyper-V Replica' : 'Azure Site Recovery for Hyper-V'
    const list = strategy === 'hyper-v-replica' ? '30 seconds, 5 minutes or 15 minutes' : '30 seconds (not to premium storage) or 5 minutes'
    const source = strategy === 'hyper-v-replica' ? DR_SOURCES.replica : DR_SOURCES.asrFaq
    findings.push(rpoPasses
      ? { severity: 'info', message: `${product} replicates every ${list}. For your ${fmt(inputs.rpoMinutes, 1)}-minute RPO, use ${replicationIntervalMinutes === 0.5 ? '30 seconds' : `${replicationIntervalMinutes} minutes`}. The RPO holds only while the WAN keeps up with changes.`, source }
      : { severity: 'error', message: `Your ${fmt(inputs.rpoMinutes, 1)}-minute RPO is shorter than the fastest ${product} interval (30 seconds). Choose synchronous storage replication with your array vendor, or accept 30 seconds.`, source })
  } else if (strategy === 'storage-replication') {
    findings.push({ severity: 'info', message: 'Storage replication: RPO and RTO depend on the array, its replication mode (synchronous or asynchronous) and distance. Validate your targets with your array vendor.' })
  } else if (strategy === 'backup-only') {
    rpoPasses = inputs.backupIntervalHours * 60 <= inputs.rpoMinutes
    if (!rpoPasses) findings.push({ severity: 'error', message: `Backups every ${fmt(inputs.backupIntervalHours, 1)} hours give an RPO of up to ${fmt(inputs.backupIntervalHours * 60)} minutes, longer than your ${fmt(inputs.rpoMinutes, 1)}-minute RPO.` })
  }

  // RTO by strategy.
  let estimatedRecoveryHours: number | null = null
  if (strategy === 'backup-only') {
    estimatedRecoveryHours = inputs.restoreThroughputMBps > 0 ? protectedStorageTiB * TIB_BYTES / (inputs.restoreThroughputMBps * 1e6) / 3600 : null
    assumptions.push(`Restore runs at a sustained ${fmt(inputs.restoreThroughputMBps)} MB/s for all ${fmt(protectedVms)} protected VMs (${fmt(protectedStorageTiB, 1)} TiB), one stream after another. Measure your backup system's restore rate.`)
  } else {
    estimatedRecoveryHours = inputs.failoverHours
    assumptions.push(`Failover takes ${fmt(inputs.failoverHours, 2)} hours for all protected VMs together, from the decision to fail over to VMs running at the secondary. This is your estimate: confirm it with a recovery test.`)
  }
  const rtoPasses = estimatedRecoveryHours === null ? null : estimatedRecoveryHours <= inputs.rtoHours
  if (estimatedRecoveryHours === null) findings.push({ severity: 'warning', message: 'Enter a restore throughput to estimate recovery time against your RTO.' })
  else if (!rtoPasses) findings.push({ severity: 'error', message: strategy === 'backup-only'
    ? `Restoring ${fmt(protectedStorageTiB, 1)} TiB at ${fmt(inputs.restoreThroughputMBps)} MB/s takes about ${fmt(estimatedRecoveryHours, 1)} hours, longer than your ${fmt(inputs.rtoHours, 1)}-hour RTO. Restore in parallel, protect fewer VMs this way, or replicate the critical ones.`
    : `The failover estimate of ${fmt(estimatedRecoveryHours, 1)} hours is longer than your ${fmt(inputs.rtoHours, 1)}-hour RTO.` })

  // Initial seeding.
  let seedingDays: number | null = null
  if (replicates && inputs.seedingMethod === 'network' && protectedStorageTiB > 0) {
    seedingDays = inputs.availableWanMbps > 0 ? protectedStorageTiB * TIB_BYTES * 8 / (inputs.availableWanMbps * 1e6) / 86_400 : null
    assumptions.push(`The first full copy uses the whole ${fmt(inputs.availableWanMbps)} Mbps WAN, with no other traffic.`)
    if (seedingDays === null) findings.push({ severity: 'error', message: 'No WAN bandwidth is entered, so the first copy cannot be sent over the network.' })
    else findings.push({ severity: seedingDays > 14 ? 'warning' : 'info', message: `Sending the first copy of ${fmt(protectedStorageTiB, 1)} TiB over ${fmt(inputs.availableWanMbps)} Mbps takes about ${fmt(seedingDays, 1)} days.${seedingDays > 14 ? ' Seed with external media or an existing VM copy, or stage the protection in waves (tool threshold: 14 days).' : ''}`, source: strategy === 'hyper-v-replica' ? DR_SOURCES.replicaSetup : undefined })
  }

  // WAN for ongoing replication.
  if (bandwidthPasses === false) findings.push({ severity: 'error', message: `Estimated burst replication is ${fmt(estimatedBurstMbps ?? 0)} Mbps, above your ${fmt(inputs.availableWanMbps)} Mbps WAN. Measure the real change rate, then add bandwidth, throttle, or protect fewer VMs.` })
  if (replicates) assumptions.push(`Replication traffic is ${fmt(inputs.dailyChangeRatePct, 1)}% of protected storage changed per day, spread evenly, times a ${fmt(inputs.burstFactor, 2)}× burst factor. Rates are decimal megabits per second.`)

  // Secondary-site compute.
  let secondaryHosts: number | null = null
  if (strategy !== 'azure-site-recovery' && typeof context.workloadNodes === 'number' && context.workloadNodes > 0) {
    secondaryHosts = protectedVms === 0 ? 0 : Math.ceil(context.workloadNodes * share * inputs.secondaryCapacityPct / 100)
    findings.push({ severity: 'info', message: `The secondary site needs about ${fmt(secondaryHosts)} host(s) of the same specification to run ${fmt(protectedVms)} protected VMs at ${fmt(inputs.secondaryCapacityPct)}% capacity, before any failure reserve there.` })
  } else if (strategy === 'azure-site-recovery') {
    findings.push({ severity: 'info', message: 'Azure Site Recovery creates Azure VMs at failover, so no secondary hosts are needed. Check Azure quota and VM sizes for the protected VMs; Generation 2 VMs need a size that supports Generation 2.', source: DR_SOURCES.asrMatrix })
  }

  // Strategy-specific requirements.
  if (strategy === 'hyper-v-replica' && context.clustered !== false) findings.push({ severity: 'info', message: 'Your hosts are a failover cluster: configure the Hyper-V Replica Broker role on the primary cluster and on the replica cluster, and use the broker name as the replica server.', source: DR_SOURCES.replicaSetup })
  const asrBlockers: AsrBlocker[] = []
  if (strategy === 'azure-site-recovery') {
    included.forEach((vm) => {
      if (vm.encrypted) asrBlockers.push({ vmName: vm.name, reason: 'Encrypted disk (BitLocker must be off before replication)' })
      if (vm.hasSharedDisk) asrBlockers.push({ vmName: vm.name, reason: 'Shared disk (shared VHD or shared cluster disk)' })
      if (vm.hasRdm) asrBlockers.push({ vmName: vm.name, reason: 'Raw device mapping (becomes a pass-through or FC disk, which is not supported)' })
      if ((vm.diskCount ?? 0) > ASR_MAX_DISKS) asrBlockers.push({ vmName: vm.name, reason: `${vm.diskCount} disks (up to ${ASR_MAX_DISKS})` })
      const churnMBps = vm.storageGiB * 1024 ** 3 * inputs.dailyChangeRatePct / 100 * inputs.burstFactor / 1e6 / 86_400
      if (churnMBps > ASR_CHURN_LIMIT_MBPS) asrBlockers.push({ vmName: vm.name, reason: `Estimated churn ${fmt(churnMBps, 1)} MB/s (normal churn is up to ${ASR_CHURN_LIMIT_MBPS} MB/s per VM)` })
    })
    if (asrBlockers.length > 0) findings.push({ severity: 'error', message: `${new Set(asrBlockers.map((item) => item.vmName)).size} VM(s) have something Azure Site Recovery does not support for Hyper-V VMs. Fix them or protect them another way.`, source: DR_SOURCES.asrMatrix })
    const unknown = included.filter((vm) => vm.encrypted === undefined || vm.hasSharedDisk === undefined || vm.hasRdm === undefined).length
    if (unknown > 0) findings.push({ severity: 'warning', message: `${fmt(unknown)} VM(s) lack encryption, shared-disk or RDM data, so those Azure Site Recovery blockers were not checked for them.`, source: DR_SOURCES.asrMatrix })
    assumptions.push('ASR churn per VM is its storage times the daily change rate and burst factor, spread over a day.')
  }

  if (strategy === 'backup-only') findings.push({ severity: 'info', message: 'Backup-only recovery: keep an off-site copy so a site loss does not take the backups too.' })
  if (inputs.secondaryCapacityPct < 100 && protectedVms > 0) findings.push({ severity: 'warning', message: `Secondary capacity is ${fmt(inputs.secondaryCapacityPct)}% of protected storage. Confirm retention, replica history, checkpoints and failover growth fit.` })
  if (!inputs.immutableCopy) findings.push({ severity: 'warning', message: 'No immutable or offline recovery copy is confirmed. Replication alone can copy corruption or destructive changes.' })
  if (!inputs.applicationConsistent) findings.push({ severity: 'warning', message: 'Application-consistent recovery is not selected. Validate crash-consistent recovery with each workload owner.' })
  if (inputs.testFrequencyMonths > 12) findings.push({ severity: 'warning', message: 'Recovery testing is less often than once a year. Test more often and keep evidence of the RPO and RTO you achieved.' })
  if (replicates) findings.push({ severity: 'info', message: 'Bandwidth is an estimate from protected consumed capacity and daily change rate. Replace it with measured write-change data before implementation.' })

  return { protectedVms, protectedStorageTiB, secondaryStorageTiB, estimatedAverageMbps, estimatedBurstMbps, bandwidthPasses, replicationIntervalMinutes, rpoPasses, estimatedRecoveryHours, rtoPasses, seedingDays, secondaryHosts, asrBlockers, assumptions, findings }
}
