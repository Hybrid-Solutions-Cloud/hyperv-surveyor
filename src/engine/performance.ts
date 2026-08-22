import type { ClusterConfig, DataConfidence, PerformanceAssessment, Vm } from './types'

const present = (value: number | undefined) => Number.isFinite(value) && (value ?? 0) >= 0

const pct = (count: number, total: number) => total > 0 ? (count / total) * 100 : 0

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export function assessPerformanceData(vms: Vm[], cfg?: Pick<ClusterConfig, 'sizingBasis'>): PerformanceAssessment {
  const included = vms.filter((vm) => vm.include)
  const total = included.length
  const cpu = included.filter((vm) => present(vm.performance?.cpuP95Pct)).length
  const memory = included.filter((vm) => present(vm.performance?.memoryP95Pct)).length
  const storage = included.filter((vm) => present(vm.performance?.storageIopsP95) && present(vm.performance?.storageThroughputMBpsP95)).length
  const observation = included.filter((vm) => (vm.performance?.observationDays ?? 0) >= 7).length
  const measured = included.filter((vm) => present(vm.performance?.cpuP95Pct) || present(vm.performance?.memoryP95Pct)).length
  const cpuCoveragePct = pct(cpu, total)
  const memoryCoveragePct = pct(memory, total)
  const storagePerformanceCoveragePct = pct(storage, total)
  const observationCoveragePct = pct(observation, total)
  const score = Math.round(cpuCoveragePct * 0.35 + memoryCoveragePct * 0.35 + storagePerformanceCoveragePct * 0.15 + observationCoveragePct * 0.15)
  const basis = cfg?.sizingBasis ?? 'allocation'
  let confidence: DataConfidence = 'allocation-only'
  if (measured > 0) confidence = score >= 85 ? 'high' : score >= 60 ? 'medium' : 'low'
  const sources = [...new Set(included.map((vm) => vm.performance?.source).filter((value): value is NonNullable<typeof value> => !!value))]
  const days = included.map((vm) => vm.performance?.observationDays).filter((value): value is number => present(value))
  const notes: string[] = []
  if (basis === 'allocation') notes.push('CPU and memory are sized from allocation; imported performance metrics remain informational until measured P95 sizing is selected.')
  if (basis === 'measured-p95' && measured === 0) notes.push('Measured P95 sizing is selected, but no matching CPU or memory measurements are available; all VMs fall back to allocation.')
  if (basis === 'measured-p95' && measured > 0 && measured < total) notes.push(`${total - measured} VM(s) have no CPU or memory measurement and fall back to allocation.`)
  if (observationCoveragePct < 80 && measured > 0) notes.push('Fewer than 80% of included VMs have at least seven days of observation history.')
  if (storagePerformanceCoveragePct < 80) notes.push('Storage IOPS and throughput coverage is incomplete; capacity can be sized, but storage performance cannot yet be fully validated.')

  return {
    basis,
    confidence,
    score,
    includedVms: total,
    cpuCoveragePct,
    memoryCoveragePct,
    storagePerformanceCoveragePct,
    observationCoveragePct,
    measuredVms: measured,
    fallbackVms: basis === 'measured-p95' ? total - measured : total,
    observationDaysMedian: median(days),
    sources,
    notes,
  }
}

export function measuredDemandFactor(percent: number | undefined, comfortFactor: number): number | null {
  if (!present(percent)) return null
  return Math.max(0.05, Math.min(2, (percent! / 100) * Math.max(1, comfortFactor)))
}
