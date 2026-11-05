import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_VMS_IN_URL, readSharedLink, toUrl, type Scenario } from './urlState'
import { payloadFromState, useSurveyorStore } from './store'
import { newVm } from './defaults'
import type { EngagementMode } from './journey'

const BASE = 'https://surveyor.example/app/index.html'

function legacyEncode(obj: unknown) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
}

function designFor(mode: EngagementMode) {
  useSurveyorStore.getState().resetScenario()
  const store = useSurveyorStore.getState()
  store.setEngagementMode(mode)
  store.setCustomerName('Example Customer')
  store.setVms([newVm({ name: 'app1' }), newVm({ name: 'db1', tier: 'database' })])
  store.setChosenKey('s2d')
  store.setExistingCapacityNodes(6)
  store.setManagementDeploymentInputs({ stackSource: 'user', foundation: 'scvmm', wac: 'wac-admin', includeArc: true, monitoring: 'scom', highAvailability: true, managedHosts: 8, managedVms: 400, managedClusters: 2, libraryContentGiB: 500, includeIdentityServices: false })
  store.setIncludeManagementInSizing(false)
  store.setManagementAdvisorAnswers({ monitoring: true, gaRequired: true })
  store.setPlacementInputs({ ...store.placementInputs, clusterLayout: 'split' })
  store.setNetworkDesignInputs({ ...store.networkDesignInputs, vlanManagement: 42 } as never)
  store.setDrDesignInputs({ ...store.drDesignInputs, rpoMinutes: 15 } as never)
  store.setStorageDecisionAnswers({ existingArray: true })
  store.setReportMetadata({ ...store.reportMetadata, author: 'Planner', organization: 'Example Org' })
  return payloadFromState(useSurveyorStore.getState())
}

describe('B5/B14 share links', () => {
  beforeEach(() => useSurveyorStore.getState().resetScenario())

  it.each<EngagementMode>(['new-platform', 'existing-capacity', 'fit-gap', 'management-only'])('round-trips the full %s design through the URL fragment', (mode) => {
    const sent = designFor(mode)
    const link = toUrl(sent, '/results', `${BASE}?keep=1#/workloads`)
    const url = new URL(link)
    // Nothing reaches the server: no payload in the query string.
    expect(url.search).toBe('?keep=1')
    expect(url.hash.startsWith('#/results?s=')).toBe(true)

    const read = readSharedLink(link)!
    expect(read.format).toBe('fragment')
    expect(new URL(read.cleanHref).hash).toBe('#/results')

    useSurveyorStore.getState().resetScenario()
    useSurveyorStore.getState().loadScenario(read.scenario)
    const received = payloadFromState(useSurveyorStore.getState())
    expect(received).toEqual(sent)
  })

  it('omits a large inventory and never wipes the recipient\'s VMs', () => {
    const vms = Array.from({ length: MAX_VMS_IN_URL + 1 }, (_, i) => newVm({ name: `vm${i}` }))
    const link = toUrl({ ...designFor('new-platform'), vms }, '/results', BASE)
    const read = readSharedLink(link)!
    expect(read.scenario.vms).toBeUndefined()
    expect(read.scenario.inventoryOmitted).toBe(MAX_VMS_IN_URL + 1)

    useSurveyorStore.getState().resetScenario()
    useSurveyorStore.getState().setVms([newVm({ name: 'mine' })])
    useSurveyorStore.getState().loadScenario(read.scenario)
    const state = useSurveyorStore.getState()
    expect(state.vms.map((vm) => vm.name)).toEqual(['mine'])
    expect(state.sharedInventoryOmitted).toBe(MAX_VMS_IN_URL + 1)
    expect(state.chosenKey).toBe('s2d')
  })

  it('keeps local workloads as a named scenario before a link replaces them', () => {
    const link = toUrl(designFor('new-platform'), '/results', BASE)
    useSurveyorStore.getState().resetScenario()
    useSurveyorStore.getState().setVms([newVm({ name: 'mine' })])
    useSurveyorStore.getState().loadScenario(readSharedLink(link)!.scenario)
    const state = useSurveyorStore.getState()
    expect(state.vms.map((vm) => vm.name)).toEqual(['app1', 'db1'])
    expect(state.savedScenarios[0].name).toMatch(/^Local work before shared link/)
    expect(state.savedScenarios[0].vms.map((vm) => vm.name)).toEqual(['mine'])
  })

  it('still opens old ?s= links and removes the payload from the address', () => {
    const old: Scenario = { ...designFor('fit-gap') }
    const link = `${BASE}?s=${encodeURIComponent(legacyEncode({ engagementMode: old.engagementMode, cfg: old.cfg, tiers: old.tiers, vms: old.vms, customerName: 'Old link' }))}#/capacity`
    const read = readSharedLink(link)!
    expect(read.format).toBe('legacy-query')
    expect(read.scenario.customerName).toBe('Old link')
    expect(read.scenario.vms).toHaveLength(2)
    expect(read.scenario.chosenKey).toBeUndefined()
    expect(new URL(read.cleanHref).search).toBe('')
    expect(new URL(read.cleanHref).hash).toBe('#/capacity')
  })

  it('still opens prototype #s= links, and a link without vms keeps local workloads', () => {
    const old = designFor('new-platform')
    const link = `${BASE}#s=${legacyEncode({ cfg: old.cfg, tiers: old.tiers, customerName: 'Prototype' })}`
    const read = readSharedLink(link)!
    expect(read.format).toBe('legacy-hash')
    expect(read.scenario.vms).toBeUndefined()
    expect(new URL(read.cleanHref).hash).toBe('#/results')
    useSurveyorStore.getState().setVms([newVm({ name: 'mine' })])
    useSurveyorStore.getState().loadScenario(read.scenario)
    expect(useSurveyorStore.getState().vms.map((vm) => vm.name)).toEqual(['mine'])
  })

  it('ignores an address without a link and an unreadable payload', () => {
    expect(readSharedLink(`${BASE}#/results`)).toBeNull()
    expect(readSharedLink(`${BASE}#/results?s=not-base64!!`)).toBeNull()
  })
})
