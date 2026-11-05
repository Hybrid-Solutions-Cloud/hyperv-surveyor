import { beforeEach, describe, expect, it } from 'vitest'
import { NEW_PLATFORM_STEPS, newPlatformStep } from './journey'
import { navGroupsFor } from '../components/Layout'
import { useSurveyorStore } from './store'
import { buildOptionsMatrix } from '../engine/optionsMatrix'
import { DEFAULT_PROPOSED_CONFIG } from './defaults'

describe('new-platform walkthrough order', () => {
  it('runs Workloads, Data check, Goals, Options, Shortlist, What to buy, Refine, then Management', () => {
    expect(NEW_PLATFORM_STEPS.map((step) => step.label)).toEqual(['Workloads', 'Data check', 'Goals', 'Options', 'Shortlist', 'What to buy', 'Refine assumptions'])
    expect(NEW_PLATFORM_STEPS.map((step) => step.to)).toEqual(['/workloads', '/data-check', '/goals', '/results', '/shortlist', '/what-to-buy', '/configuration'])
    expect(newPlatformStep('/workloads').next.to).toBe('/data-check')
    expect(newPlatformStep('/configuration').next.to).toBe('/management-plane')
    expect(newPlatformStep('/goals').eyebrow).toBe('New platform · Step 3 of 7 · Goals')
  })

  it('asks no hardware questions before the options', () => {
    const options = NEW_PLATFORM_STEPS.findIndex((step) => step.to === '/results')
    const refine = NEW_PLATFORM_STEPS.findIndex((step) => step.to === '/configuration')
    expect(refine).toBeGreaterThan(options)
  })

  it('shows the steps in order in the sidebar, and only on the new-platform path', () => {
    const platform = navGroupsFor('new-platform').find((group) => group.label === 'Platform')!
    expect(platform.items.map((item) => item.to)).toEqual(NEW_PLATFORM_STEPS.map((step) => step.to))
    expect(platform.items.map((item) => item.label)).toEqual(NEW_PLATFORM_STEPS.map((step) => step.label))
    const fitGap = navGroupsFor('fit-gap').flatMap((group) => group.items.map((item) => item.to))
    for (const route of ['/data-check', '/goals', '/shortlist', '/what-to-buy', '/results', '/configuration']) expect(fitGap).not.toContain(route)
  })
})

describe('selecting an option in the store', () => {
  beforeEach(() => useSurveyorStore.getState().resetScenario())

  const vms = Array.from({ length: 3000 }, (_, i) => ({ id: `v${i}`, name: `V${i}`, tier: 'general' as const, vCpu: 4, ramGiB: 64, storageGiB: 300, provisionedGiB: 300, powerState: 'poweredOn' as const, include: true }))

  it('refuses ruled-out options, and never splits unless the split view asks', () => {
    const store = useSurveyorStore.getState()
    store.setVms(vms)
    const matrix = buildOptionsMatrix({ cfg: structuredClone(DEFAULT_PROPOSED_CONFIG), vms, tiers: store.tiers })
    const before = useSurveyorStore.getState().chosenKey
    const ruledOut = matrix.rows.find((row) => row.rejected && !row.splitCandidate)!
    expect(useSurveyorStore.getState().selectDesignOption(ruledOut)).toBe(false)
    expect(useSurveyorStore.getState().chosenKey).toBe(before)
    const candidate = matrix.splitCandidates[0]
    expect(useSurveyorStore.getState().selectDesignOption(candidate)).toBe(false)
    expect(useSurveyorStore.getState().placementInputs.clusterLayout).toBe('single')
    expect(useSurveyorStore.getState().selectDesignOption(candidate, 'split')).toBe(true)
    expect(useSurveyorStore.getState().placementInputs.clusterLayout).toBe('split')
    const viable = buildOptionsMatrix({ cfg: structuredClone(DEFAULT_PROPOSED_CONFIG), vms: vms.slice(0, 200), tiers: store.tiers }).viable[0]
    expect(useSurveyorStore.getState().selectDesignOption(viable)).toBe(true)
    expect(useSurveyorStore.getState().chosenKey).toBe(viable.storageKey)
    expect(useSurveyorStore.getState().placementInputs.clusterLayout).toBe('single')
    expect(useSurveyorStore.getState().cfg.node.sockets).toBe(viable.server.sockets)
  })

  it('records and undoes an outlier choice on the VM', () => {
    useSurveyorStore.getState().setVms(vms.slice(0, 5))
    useSurveyorStore.getState().setOutlierDecision('v1', 'exclude')
    expect(useSurveyorStore.getState().vms[1]).toMatchObject({ include: false, outlierDecision: { choice: 'exclude' } })
    useSurveyorStore.getState().setOutlierDecision('v1', 'undo')
    expect(useSurveyorStore.getState().vms[1].include).toBe(true)
    expect(useSurveyorStore.getState().vms[1].outlierDecision).toBeUndefined()
  })
})
