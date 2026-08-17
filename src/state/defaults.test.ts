import { describe, expect, it } from 'vitest'
import { demoFleet } from './defaults'

describe('randomized demo fleet', () => {
  it('preserves the 400-VM tier mix while varying correlated sizes', () => {
    const samples = [0.02, 0.12, 0.24, 0.38, 0.55, 0.71, 0.86, 0.97]
    let cursor = 0
    const fleet = demoFleet(() => samples[(cursor++) % samples.length])

    expect(fleet).toHaveLength(400)
    expect(fleet.filter((vm) => vm.tier === 'general')).toHaveLength(360)
    expect(fleet.filter((vm) => vm.tier === 'database')).toHaveLength(40)
    expect(new Set(fleet.map((vm) => vm.vCpu)).size).toBeGreaterThan(3)
    expect(new Set(fleet.map((vm) => vm.storageGiB)).size).toBeGreaterThan(8)
    expect(fleet.every((vm) => vm.provisionedGiB >= vm.storageGiB)).toBe(true)
  })
})
