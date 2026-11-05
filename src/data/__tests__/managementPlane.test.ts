import { describe, expect, it } from 'vitest'
import { DECISION_QUESTIONS, recommendManagementPlane, type AdvisorAnswers } from '../managementPlane'

const completeAnswers = (overrides: AdvisorAnswers = {}): AdvisorAnswers => ({
  airGap: false,
  bareMetal: false,
  tenantSelfService: false,
  azureServices: false,
  scomFeatures: false,
  monitoring: false,
  clusterCreation: false,
  pureIntegration: false,
  drs: false,
  migration: false,
  migrationConstraints: false,
  largeFabric: false,
  wacSoftwareDefinedFabric: false,
  vmodeHostEligible: true,
  smallEdge: false,
  azureReady: true,
  gaRequired: true,
  managementHa: false,
  automation: false,
  operationsOwnership: true,
  ...overrides,
})

describe('management-plane recommendations', () => {
  it('does not manufacture a stack from unanswered questions', () => {
    const result = recommendManagementPlane({})

    expect(result.status).toBe('incomplete')
    expect(result.stack).toEqual([])
    expect(result.eligible).toHaveLength(4)
    expect(result.unansweredDecisionIds).toContain('azureServices')
  })

  it('treats Question 1 Yes as excluding only Azure Arc-enabled servers', () => {
    const result = recommendManagementPlane({ airGap: true })

    expect(result.status).toBe('incomplete')
    expect(result.stack).toEqual([])
    expect(result.eligible).toEqual(['classic', 'scvmm', 'wac-virtual', 'wac-admin'])
    expect(result.excluded).toEqual([])
    expect(result.arcServers).toBe(false)
    expect(result.headline).toContain('Classic, SCVMM, WAC aMode, and WAC vMode remain available')
  })

  it('keeps every plane available when Question 1 is No', () => {
    const result = recommendManagementPlane({ airGap: false })

    expect(result.status).toBe('incomplete')
    expect(result.stack).toEqual([])
    expect(result.eligible).toHaveLength(4)
    expect(result.excluded).toEqual([])
  })

  it('selects Classic and aMode only after the core gates resolve', () => {
    const result = recommendManagementPlane(completeAnswers())

    expect(result.status).toBe('ready')
    expect(result.stack).toEqual(['classic', 'wac-admin'])
  })

  it('can confirm the foundation without pretending an unanswered WAC mode is decided', () => {
    const result = recommendManagementPlane({
      azureServices: false,
      scomFeatures: false,
      bareMetal: false,
      tenantSelfService: false,
      pureIntegration: false,
      drs: false,
      largeFabric: false,
    })

    expect(result.status).toBe('incomplete')
    expect(result.stack).toEqual(['classic'])
    // D4 and D7: host eligibility and the SCOM monitoring question are also needed before the stack is final.
    expect(result.unansweredDecisionIds).toEqual(['gaRequired', 'managementHa', 'wacSoftwareDefinedFabric', 'vmodeHostEligible', 'monitoring'])
  })

  it('prefers vMode for small or large estates when all vMode gates are explicitly accepted', () => {
    const small = recommendManagementPlane(completeAnswers({ gaRequired: false }))
    const large = recommendManagementPlane(completeAnswers({ gaRequired: false, largeFabric: true }))

    expect(small.stack).toEqual(['classic', 'wac-virtual'])
    expect(large.stack).toEqual(['classic', 'wac-virtual'])
    expect(large.rationale.some((reason) => reason.includes('preferred over aMode'))).toBe(true)
  })

  it('uses SCVMM and aMode for a large fabric when vMode is blocked', () => {
    const result = recommendManagementPlane(completeAnswers({ largeFabric: true, gaRequired: true }))

    expect(result.status).toBe('ready')
    expect(result.stack).toEqual(['scvmm', 'wac-admin'])
    expect(result.excluded.some((item) => item.id === 'wac-virtual')).toBe(true)
  })

  // D10: no Microsoft or Pure documentation of a Pure integration in vMode was found, so Pure needs
  // validation before vMode can be chosen. The workbook says the same.
  it('keeps vMode out when Pure integration drives SCVMM, because the Pure path in vMode needs validation', () => {
    const result = recommendManagementPlane(completeAnswers({ pureIntegration: true, gaRequired: false }))

    expect(result.status).toBe('ready')
    expect(result.stack).toEqual(['scvmm', 'wac-admin'])
    expect(result.excluded.find((item) => item.id === 'wac-virtual')?.reason).toMatch(/needs validation/)
    expect(result.cautions.some((caution) => caution.includes('Pure Storage'))).toBe(true)
  })

  it.each([
    [false, false, 'none'],
    [true, false, 'scom-features'],
    [true, true, 'scom'],
    [false, true, 'scom'],
  ])('with forecasting %s and monitoring %s, plans SCOM as %s', (scomFeatures, monitoring, expected) => {
    expect(recommendManagementPlane(completeAnswers({ scomFeatures, monitoring })).monitoring).toBe(expected)
  })

  it('requires SCVMM for reporting and forecasting, but not for monitoring alone', () => {
    expect(recommendManagementPlane(completeAnswers({ scomFeatures: true })).stack).toContain('scvmm')
    expect(recommendManagementPlane(completeAnswers({ monitoring: true })).stack).toContain('classic')
  })

  it('adds Azure Arc-enabled servers without changing the management stack', () => {
    const without = recommendManagementPlane(completeAnswers())
    const result = recommendManagementPlane(completeAnswers({ azureServices: true }))

    expect(result.status).toBe('ready')
    expect(result.stack).toEqual(without.stack)
    expect(result.arcServers).toBe(true)
    expect(result.headline).toContain('Azure Arc-enabled servers')
    expect(result.cautions.some((caution) => caution.includes('do not provide VM lifecycle'))).toBe(true)
  })

  it('never recommends the retired Arc-enabled SCVMM plane', () => {
    const result = recommendManagementPlane(completeAnswers({ azureServices: true, largeFabric: true }))

    expect(result.stack as string[]).not.toContain('arc-scvmm')
    expect(result.eligible as string[]).not.toContain('arc-scvmm')
  })

  it('waits for both readiness answers before approving Azure Arc-enabled servers', () => {
    const result = recommendManagementPlane({ azureServices: true })

    expect(result.status).toBe('incomplete')
    expect(result.stack).toEqual([])
    expect(result.unansweredDecisionIds.slice(0, 2)).toEqual(['airGap', 'azureReady'])
    expect(result.cautions.some((caution) => caution.includes('Confirm Azure subscription ownership'))).toBe(true)
  })

  it('reports a conflict when Arc is requested and a readiness answer blocks it', () => {
    const airGapped = recommendManagementPlane({ azureServices: true, airGap: true })
    const notReady = recommendManagementPlane({ azureServices: true, azureReady: false })

    for (const result of [airGapped, notReady]) {
      expect(result.status).toBe('conflict')
      expect(result.arcServers).toBe(false)
      expect(result.headline).toContain('rule them out')
    }
  })

  it('distinguishes SCVMM bare-metal provisioning from prepared-host cluster creation', () => {
    const bareMetal = recommendManagementPlane({ bareMetal: true })
    const preparedHosts = recommendManagementPlane({ clusterCreation: true })

    expect(bareMetal.stack).toEqual(['scvmm'])
    expect(bareMetal.rationale.some((reason) => reason.includes('install Windows Server'))).toBe(true)
    expect(preparedHosts.stack).toEqual([])
    expect(preparedHosts.rationale.some((reason) => reason.includes('Prepared-host cluster creation'))).toBe(true)
  })

  it('uses migration constraints only when migration is in scope', () => {
    const dormant = recommendManagementPlane({ migrationConstraints: true })
    const active = recommendManagementPlane({ migration: true, migrationConstraints: true })

    expect(dormant.cautions.some((caution) => caution.includes('V2V'))).toBe(false)
    expect(active.cautions.some((caution) => caution.includes('V2V'))).toBe(true)
    expect(active.stack).toEqual([])
  })

  it.each([
    ['gaRequired', 'generally available'],
    ['managementHa', 'high-availability'],
    ['wacSoftwareDefinedFabric', 'software-defined'],
  ])('excludes vMode when %s is Yes', (id, reasonFragment) => {
    const result = recommendManagementPlane({ [id]: true })
    const exclusion = result.excluded.find((item) => item.id === 'wac-virtual')

    expect(result.stack).toEqual(['wac-admin'])
    expect(exclusion?.reason).toContain(reasonFragment)
  })

  it('adds SCOM only when the SCOM question is Yes', () => {
    const selected = recommendManagementPlane({ monitoring: true })
    const declined = recommendManagementPlane({ monitoring: false })

    expect(selected.monitoring).toBe('scom')
    expect(declined.monitoring).toBe('none')
  })

  it('handles Yes and No independently for every qualifying question', () => {
    for (const question of DECISION_QUESTIONS) {
      for (const answer of [true, false]) {
        const result = recommendManagementPlane({ [question.id]: answer })
        expect(['incomplete', 'ready', 'conflict']).toContain(result.status)
        expect(new Set(result.stack).size).toBe(result.stack.length)
        expect(new Set(result.eligible).size).toBe(result.eligible.length)
        expect(new Set(result.excluded.map((item) => item.id)).size).toBe(result.excluded.length)
      }
    }
  })
})
