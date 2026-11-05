/**
 * Phase 4 advisor rules (audit D4, D7, D10, D13) and exhaustive invariants over the questions that
 * decide the stack. Synthetic answers only.
 */
import { describe, expect, it } from 'vitest'
import { DECISION_QUESTIONS, normalizeAdvisorAnswers, recommendManagementPlane, type AdvisorAnswers } from '../managementPlane'
import { CAPABILITIES } from '../managementPlane'

const complete = (overrides: AdvisorAnswers = {}): AdvisorAnswers => ({
  airGap: false, bareMetal: false, tenantSelfService: false, azureServices: false, scomFeatures: false,
  monitoring: false, clusterCreation: false, pureIntegration: false, drs: false, migration: false,
  migrationConstraints: false, largeFabric: false, wacSoftwareDefinedFabric: false, vmodeHostEligible: true,
  smallEdge: false, azureReady: true, gaRequired: false, managementHa: false, automation: false,
  operationsOwnership: true,
  ...overrides,
})

describe('D4 WAC vMode host eligibility', () => {
  it('asks about host eligibility with the Microsoft prerequisites and sources', () => {
    const question = DECISION_QUESTIONS.find((item) => item.id === 'vmodeHostEligible')!
    expect(question.question).toMatch(/Windows Server 2025 Datacenter/)
    expect(question.question).toMatch(/same Active Directory domain/)
    expect(question.why).toMatch(/Network ATC/)
    expect(question.sources.map((source) => source.url)).toEqual([
      'https://learn.microsoft.com/windows-server/manage/windows-admin-center/add-virtualization-mode-resources',
      'https://learn.microsoft.com/windows-server/manage/windows-admin-center/install-virtualization-mode',
    ])
  })

  it('selects vMode only when the hosts are confirmed eligible', () => {
    expect(recommendManagementPlane(complete()).stack).toEqual(['classic', 'wac-virtual'])
    const ineligible = recommendManagementPlane(complete({ vmodeHostEligible: false }))
    expect(ineligible.status).toBe('ready')
    expect(ineligible.stack).toEqual(['classic', 'wac-admin'])
    expect(ineligible.excluded.find((item) => item.id === 'wac-virtual')?.reason).toMatch(/Datacenter/)
  })

  it('never reaches ready with vMode while eligibility is unknown', () => {
    const unknown = recommendManagementPlane(complete({ vmodeHostEligible: undefined }))
    expect(unknown.status).toBe('incomplete')
    expect(unknown.stack).not.toContain('wac-virtual')
    expect(unknown.unansweredDecisionIds).toContain('vmodeHostEligible')
    expect(unknown.cautions.some((caution) => caution.includes('host eligibility'))).toBe(true)
  })
})

describe('D7 ready needs the SCOM and HA answers', () => {
  it.each(['managementHa', 'scomFeatures', 'monitoring'])('stays incomplete while %s is unanswered', (id) => {
    // gaRequired Yes settles the WAC mode without the HA answer, so HA must still be required.
    const result = recommendManagementPlane(complete({ gaRequired: true, bareMetal: true, [id]: undefined }))
    expect(result.status).toBe('incomplete')
    expect(result.unansweredDecisionIds).toContain(id)
  })

  it('does not treat an unanswered HA question as Yes', () => {
    expect(recommendManagementPlane({}).highAvailability).toBe(false)
    expect(recommendManagementPlane(complete({ managementHa: true, gaRequired: true })).highAvailability).toBe(true)
    expect(recommendManagementPlane(complete({ managementHa: false })).highAvailability).toBe(false)
  })
})

describe('D13 advisor fixes', () => {
  it('does not ask for Azure services when Arc is already ruled out', () => {
    expect(recommendManagementPlane(complete({ azureServices: undefined, airGap: true })).unansweredDecisionIds).not.toContain('azureServices')
    expect(recommendManagementPlane(complete({ azureServices: undefined, azureReady: false })).unansweredDecisionIds).not.toContain('azureServices')
    expect(recommendManagementPlane(complete({ azureServices: undefined, azureReady: false })).status).toBe('ready')
  })

  it('removes Classic from the eligible foundations when a hard SCVMM driver is Yes', () => {
    for (const id of ['bareMetal', 'tenantSelfService', 'pureIntegration', 'drs', 'scomFeatures']) {
      const result = recommendManagementPlane(complete({ [id]: true }))
      expect(result.eligible).not.toContain('classic')
      expect(result.excluded.find((item) => item.id === 'classic')?.reason).toMatch(/needs SCVMM/)
    }
  })

  it('flags the lifecycle burden of vMode when operations cannot own it', () => {
    const result = recommendManagementPlane(complete({ operationsOwnership: false }))
    expect(result.stack).toEqual(['classic', 'wac-virtual'])
    expect(result.cautions.some((caution) => caution.includes('cannot own'))).toBe(true)
  })

  it('keeps the Arc readiness caution after the recommendation is ready', () => {
    const result = recommendManagementPlane(complete({ azureServices: true }))
    expect(result.status).toBe('ready')
    expect(result.cautions.some((caution) => caution.includes('Confirm Azure subscription ownership'))).toBe(true)
  })

  it('flags a small dedicated stack that is also a large fabric', () => {
    const result = recommendManagementPlane(complete({ smallEdge: true, largeFabric: true }))
    expect(result.cautions.some((caution) => caution.includes('answers conflict'))).toBe(true)
  })

  it('cautions that SCVMM with vMode on the same hosts must be validated', () => {
    const result = recommendManagementPlane(complete({ drs: true }))
    expect(result.stack).toEqual(['scvmm', 'wac-virtual'])
    expect(result.cautions.some((caution) => caution.includes('not a documented fact'))).toBe(true)
  })

  it.each([
    ['clusterCreation'], ['automation'], ['migration'], ['smallEdge'], ['operationsOwnership'],
  ])('does not change the stack for %s, and its text says so', (id) => {
    const yes = recommendManagementPlane(complete({ [id]: true }))
    const no = recommendManagementPlane(complete({ [id]: false }))
    expect(yes.stack).toEqual(no.stack)
    const question = DECISION_QUESTIONS.find((item) => item.id === id)!
    const text = `${question.ifYes} ${question.ifNo}`.toLowerCase()
    expect(text).toMatch(/does not (change|select|influence|affect|determine|remove)|not change|do not select/)
  })

  it('keeps only known Yes or No answers', () => {
    expect(normalizeAdvisorAnswers({ monitoring: true, gaRequired: false, invented: true, managementHa: 'yes' })).toEqual({ monitoring: true, gaRequired: false })
    expect(normalizeAdvisorAnswers(null)).toEqual({})
    expect(normalizeAdvisorAnswers([true])).toEqual({})
  })
})

describe('D10 Pure Storage and vMode', () => {
  it('keeps the workbook consistent with the advisor', () => {
    const row = CAPABILITIES.find((item) => item.capability === 'Pure Storage FlashArray integration')!
    expect(row.values['wac-virtual']).toBe('None documented')
    expect(row.note).toMatch(/does not select vMode when Pure integration is required/)
    expect(recommendManagementPlane(complete({ pureIntegration: true })).stack).not.toContain('wac-virtual')
  })
})

/** Every combination of the given questions, each Yes, No, or unanswered. */
function* combinations(ids: string[], states: Array<boolean | undefined>): Generator<AdvisorAnswers> {
  const total = states.length ** ids.length
  for (let n = 0; n < total; n += 1) {
    const answers: AdvisorAnswers = {}
    let rest = n
    for (const id of ids) {
      const value = states[rest % states.length]
      rest = Math.floor(rest / states.length)
      if (value !== undefined) answers[id] = value
    }
    yield answers
  }
}

/** Returns the broken invariants for one set of answers. Plain checks keep the exhaustive loops fast. */
function brokenInvariants(answers: AdvisorAnswers): string[] {
  const broken: string[] = []
  const check = (ok: boolean, rule: string) => { if (!ok) broken.push(rule) }
  const result = recommendManagementPlane(answers)
  const excludedIds = result.excluded.map((item) => item.id)
  check(new Set(result.stack).size === result.stack.length, 'no duplicate components')
  check(result.eligible.every((id) => !excludedIds.includes(id)), 'nothing both eligible and excluded')
  check(result.stack.every((id) => !excludedIds.includes(id)), 'the stack holds no excluded plane')
  check(result.stack.filter((id) => id === 'classic' || id === 'scvmm').length <= 1, 'one foundation at most')
  check(result.stack.filter((id) => id === 'wac-admin' || id === 'wac-virtual').length <= 1, 'one WAC mode at most')
  if (result.stack.includes('wac-virtual')) {
    check(answers.vmodeHostEligible === true, 'vMode needs confirmed eligible hosts')
    check(answers.gaRequired === false && answers.managementHa === false && answers.wacSoftwareDefinedFabric === false, 'vMode needs every gate accepted')
    check(answers.pureIntegration === false, 'vMode is not chosen with a Pure requirement')
  }
  if (['bareMetal', 'tenantSelfService', 'pureIntegration', 'drs', 'scomFeatures'].some((id) => answers[id] === true)) {
    check(!result.stack.includes('classic'), 'a hard SCVMM driver never gives Classic')
  }
  if (result.status === 'ready') {
    check(result.stack.length === 2, 'ready has a foundation and a WAC mode')
    check(result.unansweredDecisionIds.length === 0, 'ready has nothing unanswered')
    check(['managementHa', 'scomFeatures', 'monitoring'].every((id) => answers[id] !== undefined), 'ready needs the SCOM and HA answers')
  } else {
    check(result.status === 'conflict' || result.unansweredDecisionIds.length > 0, 'incomplete names what is missing')
  }
  check(result.arcServers === (answers.azureServices === true && answers.airGap !== true && answers.azureReady !== false), 'Arc is an add-on only when requested and allowed')
  check(result.highAvailability === (answers.managementHa === true), 'HA only on Yes')
  check(result.monitoring === (answers.monitoring === true ? 'scom' : answers.scomFeatures === true ? 'scom-features' : 'none'), 'SCOM follows its questions')
  return broken.map((rule) => `${rule}: ${JSON.stringify(answers)}`)
}

describe('exhaustive advisor invariants', () => {
  const decisive = ['bareMetal', 'tenantSelfService', 'pureIntegration', 'drs', 'scomFeatures', 'largeFabric', 'gaRequired', 'managementHa', 'wacSoftwareDefinedFabric', 'vmodeHostEligible', 'monitoring']

  it('hold for every Yes, No, or unanswered combination of the stack questions (177,147 cases)', () => {
    let count = 0
    const broken: string[] = []
    for (const answers of combinations(decisive, [true, false, undefined])) {
      broken.push(...brokenInvariants({ airGap: false, azureServices: false, azureReady: true, ...answers }))
      count += 1
    }
    expect(count).toBe(3 ** decisive.length)
    expect(broken.slice(0, 5)).toEqual([])
  }, 120_000)

  it('hold for every Yes or No combination of the Arc questions with complete stack answers', () => {
    const broken: string[] = []
    for (const arc of combinations(['airGap', 'azureServices', 'azureReady'], [true, false, undefined])) {
      for (const stack of combinations(decisive, [true, false])) broken.push(...brokenInvariants({ ...stack, ...arc }))
    }
    expect(broken.slice(0, 5)).toEqual([])
  }, 120_000)
})
