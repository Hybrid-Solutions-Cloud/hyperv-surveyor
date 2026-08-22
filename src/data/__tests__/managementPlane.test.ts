import { describe, expect, it } from 'vitest'
import { recommendManagementPlane } from '../managementPlane'

describe('management-plane recommendations', () => {
  it('prefers vMode for a large fabric when Preview and standalone operation are acceptable', () => {
    const result = recommendManagementPlane({ gaRequired: false, managementHa: false, largeFabric: true, pureIntegration: false })

    expect(result.stack).toContain('wac-virtual')
    expect(result.stack).not.toContain('wac-admin')
    expect(result.stack).not.toContain('scvmm')
    expect(result.headline).toContain('vMode')
  })

  it('prefers vMode even for a smaller estate when its support gates line up', () => {
    const result = recommendManagementPlane({ gaRequired: false, managementHa: false, largeFabric: false, wacSoftwareDefinedFabric: false })

    expect(result.stack).toEqual(['classic', 'wac-virtual'])
    expect(result.rationale.some((reason) => reason.includes('preferred over aMode'))).toBe(true)
  })

  it('uses SCVMM and aMode for a large production fabric that requires GA components', () => {
    const result = recommendManagementPlane({ gaRequired: true, largeFabric: true })

    expect(result.stack).toContain('scvmm')
    expect(result.stack).toContain('wac-admin')
    expect(result.stack).not.toContain('wac-virtual')
  })

  it('retains aMode when Pure integration is required', () => {
    const result = recommendManagementPlane({ gaRequired: false, largeFabric: true, pureIntegration: true })

    expect(result.stack).toContain('scvmm')
    expect(result.stack).toContain('wac-admin')
    expect(result.stack).not.toContain('wac-virtual')
    expect(result.cautions.some((caution) => caution.includes('Pure Storage'))).toBe(true)
  })

  it('does not default to SCVMM when no hard fabric requirement is selected', () => {
    const result = recommendManagementPlane({ airGap: false, smallEdge: false })

    expect(result.stack).toEqual(['classic', 'wac-admin'])
  })

  it('treats VMware conversion as a separate workstream instead of a permanent SCVMM driver', () => {
    const result = recommendManagementPlane({ migration: true, smallEdge: true })

    expect(result.stack).toEqual(['classic', 'wac-admin'])
    expect(result.rationale.some((reason) => reason.includes('migration workstream'))).toBe(true)
  })

  it('adds Arc only when Azure portal management is requested and Azure is eligible', () => {
    const eligible = recommendManagementPlane({ delegatedPortal: true, azureReady: true, airGap: false })
    const blocked = recommendManagementPlane({ delegatedPortal: true, azureReady: false })

    expect(eligible.stack).toEqual(['scvmm', 'arc-scvmm'])
    expect(eligible.stack).not.toContain('wac-admin')
    expect(eligible.stack).not.toContain('wac-virtual')
    expect(blocked.stack).toEqual(['scvmm'])
    expect(blocked.cautions.some((caution) => caution.includes('blocked'))).toBe(true)
  })

  it('shows Arc immediately for question 4 unless a readiness answer explicitly blocks it', () => {
    const result = recommendManagementPlane({ delegatedPortal: true })

    expect(result.stack).toEqual(['scvmm', 'arc-scvmm'])
    expect(result.cautions.some((caution) => caution.includes('Confirm Azure subscription ownership'))).toBe(true)
  })

  it('distinguishes SCVMM bare-metal OS provisioning from WAC prepared-host cluster creation', () => {
    const bareMetal = recommendManagementPlane({ bareMetal: true })
    const preparedHosts = recommendManagementPlane({ clusterCreation: true })

    expect(bareMetal.stack).toContain('scvmm')
    expect(bareMetal.rationale.some((reason) => reason.includes('install Windows Server'))).toBe(true)
    expect(preparedHosts.stack).not.toContain('scvmm')
    expect(preparedHosts.rationale.some((reason) => reason.includes('prepared Windows Server hosts'))).toBe(true)
  })

  it('falls back to aMode when software-defined fabric management is required', () => {
    const result = recommendManagementPlane({ gaRequired: false, managementHa: false, wacSoftwareDefinedFabric: true })

    expect(result.stack).toContain('wac-admin')
    expect(result.stack).not.toContain('wac-virtual')
  })

  it('recommends SCOM and carries the HA answer into deployment guidance', () => {
    const result = recommendManagementPlane({ monitoring: true, managementHa: false })

    expect(result.monitoring).toBe('scom')
    expect(result.highAvailability).toBe(false)
  })
})
