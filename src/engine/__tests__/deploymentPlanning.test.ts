import { describe, expect, it } from 'vitest'
import { planMultipleClusters } from '../deploymentPlanning'
import { assessMigrationReadiness } from '../readiness'
import { designNetwork } from '../networkDesign'
import { designDisasterRecovery } from '../drDesign'
import { solveForward } from '../solve'
import { makeConfig, vm } from './fixtures'
import { DEFAULT_TIERS } from '../rules'

describe('implementation planning', () => {
  it('adds target clusters until the VM-per-cluster ceiling is met', () => {
    const vms = Array.from({ length: 12 }, (_, index) => vm({ name: `VM${index}` }))
    const plan = planMultipleClusters(makeConfig({ architecture: 'san' }), vms, DEFAULT_TIERS, { targetVmsPerCluster: 5, maxNodesPerCluster: 64 })
    expect(plan.feasible).toBe(true)
    expect(plan.clusters).toHaveLength(3)
    expect(plan.clusters.every((cluster) => cluster.vms.length <= 5)).toBe(true)
  })

  it('flags conversion and processor-vendor readiness exceptions', () => {
    const cfg = makeConfig({ node: { cpuVendor: 'amd' } })
    const readiness = assessMigrationReadiness([vm({ hasRdm: true, sourceCpuVendor: 'intel', firmware: 'bios', snapshotCount: 2 })], cfg)
    expect(readiness.blocked).toBe(1)
    expect(readiness.findings.some((finding) => finding.category === 'processor')).toBe(true)
  })

  it('enforces S2D network minimums and RoCE DCB requirements', () => {
    const design = designNetwork(makeConfig({ architecture: 's2d' }), 4, { adapterSpeedGbps: 1, rdmaProtocol: 'roce-v2', dataCenterBridging: false })
    expect(design.findings.filter((finding) => finding.severity === 'error').length).toBeGreaterThanOrEqual(2)
  })

  it('detects when estimated DR burst traffic exceeds WAN capacity', () => {
    const cfg = makeConfig({ architecture: 'san' })
    const vms = [vm({ storageGiB: 1024 * 100 })]
    const sizing = solveForward(cfg, vms, DEFAULT_TIERS)
    const design = designDisasterRecovery(vms, sizing, { dailyChangeRatePct: 20, burstFactor: 4, availableWanMbps: 10 })
    expect(design.bandwidthPasses).toBe(false)
    expect(design.findings.some((finding) => finding.severity === 'error')).toBe(true)
  })
})
