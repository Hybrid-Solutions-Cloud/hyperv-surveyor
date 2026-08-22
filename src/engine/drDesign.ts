import type { SizingResult, Vm } from './types'

export type DrStrategy = 'none' | 'hyper-v-replica' | 'azure-site-recovery' | 'storage-replication' | 'backup-only'

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
}

export interface DrFinding {
  severity: 'error' | 'warning' | 'info'
  message: string
  source?: string
}

export interface DrDesign {
  protectedVms: number
  protectedStorageTiB: number
  secondaryStorageTiB: number
  estimatedAverageMbps: number
  estimatedBurstMbps: number
  bandwidthPasses: boolean
  findings: DrFinding[]
}

const REPLICA_SOURCE = 'https://learn.microsoft.com/windows-server/virtualization/hyper-v/replication-overview'

export function designDisasterRecovery(vms: Vm[], sizing: SizingResult, requested: Partial<DrDesignInputs> = {}): DrDesign {
  const inputs = { ...DEFAULT_DR_INPUTS, ...requested }
  const included = vms.filter((vm) => vm.include)
  const protectedPct = Math.min(100, Math.max(0, inputs.protectedWorkloadPct)) / 100
  const protectedVms = Math.ceil(included.length * protectedPct)
  const protectedStorageTiB = sizing.requiredStorageTiB * protectedPct
  const secondaryStorageTiB = protectedStorageTiB * Math.max(0, inputs.secondaryCapacityPct) / 100
  const changedTiBPerDay = protectedStorageTiB * Math.max(0, inputs.dailyChangeRatePct) / 100
  const estimatedAverageMbps = changedTiBPerDay * 1024 * 1024 * 8 / 86_400
  const estimatedBurstMbps = estimatedAverageMbps * Math.max(1, inputs.burstFactor)
  const bandwidthPasses = inputs.availableWanMbps >= estimatedBurstMbps
  const findings: DrFinding[] = []
  if (inputs.strategy === 'none') findings.push({ severity: 'warning', message: 'No disaster-recovery replication strategy is selected. Cluster HA does not protect against site loss.' })
  if (inputs.strategy === 'backup-only') findings.push({ severity: 'info', message: 'Backup-only recovery is selected. Validate that restore duration can meet the stated RTO and that off-site copies meet the RPO.' })
  if (inputs.strategy === 'hyper-v-replica' && ![0.5, 5, 15].includes(inputs.rpoMinutes)) findings.push({ severity: 'warning', message: 'Hyper-V Replica supports configured replication intervals of 30 seconds, 5 minutes, or 15 minutes. Align the entered RPO to a supported interval.', source: REPLICA_SOURCE })
  if (!bandwidthPasses && inputs.strategy !== 'none' && inputs.strategy !== 'backup-only') findings.push({ severity: 'error', message: `Estimated burst replication demand is ${estimatedBurstMbps.toFixed(0)} Mbps, above the entered ${inputs.availableWanMbps.toFixed(0)} Mbps WAN capacity. Measure actual change rate and redesign bandwidth, throttling, or protection scope.` })
  if (inputs.secondaryCapacityPct < 100 && protectedPct > 0) findings.push({ severity: 'warning', message: `Secondary capacity is ${inputs.secondaryCapacityPct.toFixed(0)}% of protected consumed storage. Confirm retention, replica history, checkpoints, and failover growth can fit.` })
  if (!inputs.immutableCopy) findings.push({ severity: 'warning', message: 'No immutable or offline recovery copy is confirmed. Replication alone can copy corruption or destructive changes.' })
  if (!inputs.applicationConsistent) findings.push({ severity: 'warning', message: 'Application-consistent recovery is not selected. Validate crash-consistent recovery with each workload owner.' })
  if (inputs.testFrequencyMonths > 12) findings.push({ severity: 'warning', message: 'Recovery testing is scheduled less often than annually. Increase test frequency and retain evidence of achieved RPO/RTO.' })
  findings.push({ severity: 'info', message: 'Bandwidth is an estimate from protected consumed capacity and daily change rate. Replace it with measured write-change data before implementation.' })
  return { protectedVms, protectedStorageTiB, secondaryStorageTiB, estimatedAverageMbps, estimatedBurstMbps, bandwidthPasses, findings }
}
