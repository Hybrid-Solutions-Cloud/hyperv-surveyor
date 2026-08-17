import { describe, expect, it } from 'vitest'
import { recommendManagementPlane } from '../managementPlane'

describe('management-plane recommendations', () => {
  it('prefers vMode when the delivery horizon allows validation and Pure is not required', () => {
    const result = recommendManagementPlane({ productionSoon: false, largeFabric: true, pureIntegration: false })

    expect(result.stack).toContain('wac-virtual')
    expect(result.stack).not.toContain('wac-admin')
    expect(result.headline).toContain('vMode')
  })

  it('uses aMode for near-term production', () => {
    const result = recommendManagementPlane({ productionSoon: true, largeFabric: true })

    expect(result.stack).toContain('wac-admin')
    expect(result.stack).not.toContain('wac-virtual')
  })

  it('retains aMode when Pure integration is required', () => {
    const result = recommendManagementPlane({ productionSoon: false, pureIntegration: true })

    expect(result.stack).toContain('wac-admin')
    expect(result.stack).not.toContain('wac-virtual')
    expect(result.cautions.some((caution) => caution.includes('Pure extension'))).toBe(true)
  })
})
