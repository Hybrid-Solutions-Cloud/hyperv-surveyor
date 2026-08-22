import { describe, expect, it } from 'vitest'
import { assessPerformanceData } from '../performance'
import { computeDemand } from '../compute'
import { defaultTiers, newVm } from '../../state/defaults'

describe('measured performance sizing', () => {
  it('uses P95 CPU and memory with the selected comfort factor', () => {
    const vm = newVm({ vCpu: 8, ramGiB: 64, performance: { cpuP95Pct: 25, memoryP95Pct: 50, observationDays: 30, storageIopsP95: 1000, storageThroughputMBpsP95: 100 } })
    const allocation = computeDemand([vm], defaultTiers(), 1)
    const measured = computeDemand([vm], defaultTiers(), 1, { sizingBasis: 'measured-p95', performanceComfortFactor: 1.2 })
    expect(measured.requiredPCores).toBeCloseTo(allocation.requiredPCores * 0.3)
    expect(measured.requiredRamGiB).toBeCloseTo(allocation.requiredRamGiB * 0.6)
  })

  it('uses measured P95 instead of also applying the allocation right-sizing factor', () => {
    const tiers = defaultTiers()
    tiers.general.rightSizingFactor = 0.25
    const vm = newVm({ vCpu: 8, ramGiB: 64, performance: { cpuP95Pct: 50, memoryP95Pct: 50 } })
    const measured = computeDemand([vm], tiers, 1, { sizingBasis: 'measured-p95', performanceComfortFactor: 1, cpuPerformanceFactor: 2 })
    expect(measured.requiredPCores).toBeCloseTo(0.5) // 8 × 50% / 4:1 / 2x benchmark
    expect(measured.requiredRamGiB).toBeCloseTo(32)
  })

  it('scores complete long-duration measurements as high confidence', () => {
    const vms = Array.from({ length: 4 }, (_, index) => newVm({ name: `VM${index}`, performance: { cpuP95Pct: 20, memoryP95Pct: 40, storageIopsP95: 500, storageThroughputMBpsP95: 50, observationDays: 30, source: 'live-optics' } }))
    const assessment = assessPerformanceData(vms, { sizingBasis: 'measured-p95' })
    expect(assessment.confidence).toBe('high')
    expect(assessment.score).toBe(100)
    expect(assessment.fallbackVms).toBe(0)
  })
})
