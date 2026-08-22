import { describe, expect, it } from 'vitest'
import { DECISION_QUESTIONS, recommendManagementPlane, type AdvisorAnswers } from '../managementPlane'

const completeAnswers = (overrides: AdvisorAnswers = {}): AdvisorAnswers => ({
  airGap: false,
  bareMetal: false,
  tenantSelfService: false,
  delegatedPortal: false,
  clusterCreation: false,
  pureIntegration: false,
  drs: false,
  migration: false,
  migrationConstraints: false,
  largeFabric: false,
  wacSoftwareDefinedFabric: false,
  smallEdge: false,
  azureReady: true,
  gaRequired: true,
  managementHa: false,
  monitoring: false,
  automation: false,
  operationsOwnership: true,
  ...overrides,
})

describe('management-plane recommendations', () => {
  it('does not manufacture a stack from unanswered questions', () => {
    const result = recommendManagementPlane({})

    expect(result.status).toBe('incomplete')
    expect(result.stack).toEqual([])
    expect(result.eligible).toHaveLength(5)
    expect(result.unansweredDecisionIds).toContain('delegatedPortal')
  })

  it('treats Question 1 Yes as an Arc-only exclusion', () => {
    const result = recommendManagementPlane({ airGap: true })

    expect(result.status).toBe('incomplete')
    expect(result.stack).toEqual([])
    expect(result.eligible).toEqual(expect.arrayContaining(['classic', 'scvmm', 'wac-admin', 'wac-virtual']))
    expect(result.eligible).not.toContain('arc-scvmm')
    expect(result.excluded).toEqual([
      expect.objectContaining({ id: 'arc-scvmm' }),
    ])
    expect(result.headline).toContain('Classic, SCVMM without Arc, WAC aMode, and WAC vMode remain available')
  })

  it('keeps every plane available when Question 1 is No', () => {
    const result = recommendManagementPlane({ airGap: false })

    expect(result.status).toBe('incomplete')
    expect(result.stack).toEqual([])
    expect(result.eligible).toHaveLength(5)
    expect(result.excluded).toEqual([])
  })

  it('selects Classic and aMode only after the core gates resolve', () => {
    const result = recommendManagementPlane(completeAnswers())

    expect(result.status).toBe('ready')
    expect(result.stack).toEqual(['classic', 'wac-admin'])
  })

  it('can confirm the foundation without pretending an unanswered WAC mode is decided', () => {
    const result = recommendManagementPlane({
      delegatedPortal: false,
      bareMetal: false,
      tenantSelfService: false,
      pureIntegration: false,
      drs: false,
      largeFabric: false,
    })

    expect(result.status).toBe('incomplete')
    expect(result.stack).toEqual(['classic'])
    expect(result.unansweredDecisionIds).toEqual(['gaRequired', 'managementHa', 'wacSoftwareDefinedFabric'])
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

  it('allows vMode beside SCVMM when Pure integration drives SCVMM but no vMode gate is hit', () => {
    const result = recommendManagementPlane(completeAnswers({ pureIntegration: true, gaRequired: false }))

    expect(result.stack).toEqual(['scvmm', 'wac-virtual'])
    expect(result.cautions.some((caution) => caution.includes('Pure Storage'))).toBe(true)
  })

  it('uses only SCVMM and Arc when Azure portal or ARM management is required', () => {
    const result = recommendManagementPlane(completeAnswers({ delegatedPortal: true }))

    expect(result.status).toBe('ready')
    expect(result.stack).toEqual(['scvmm', 'arc-scvmm'])
    expect(result.eligible).toEqual(['scvmm', 'arc-scvmm'])
  })

  it('shows the Arc direction immediately but waits for both readiness answers', () => {
    const result = recommendManagementPlane({ delegatedPortal: true })

    expect(result.status).toBe('incomplete')
    expect(result.stack).toEqual(['scvmm', 'arc-scvmm'])
    expect(result.unansweredDecisionIds).toEqual(['airGap', 'azureReady'])
    expect(result.cautions.some((caution) => caution.includes('Confirm Azure subscription ownership'))).toBe(true)
  })

  it('reports a conflict when Arc is required and a readiness answer blocks it', () => {
    const airGapped = recommendManagementPlane({ delegatedPortal: true, airGap: true })
    const notReady = recommendManagementPlane({ delegatedPortal: true, azureReady: false })

    for (const result of [airGapped, notReady]) {
      expect(result.status).toBe('conflict')
      expect(result.stack).toEqual(['scvmm'])
      expect(result.eligible).not.toContain('arc-scvmm')
      expect(result.headline).toContain('No valid stack satisfies')
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
