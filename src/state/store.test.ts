import { beforeEach, describe, expect, it } from 'vitest'
import { useSurveyorStore } from './store'

describe('existing-capacity workspace', () => {
  beforeEach(() => {
    useSurveyorStore.getState().resetScenario()
  })

  it('keeps existing hardware independent from forward-design assumptions', () => {
    const initial = useSurveyorStore.getState()
    const forwardCores = initial.cfg.node.coresPerSocket
    const existing = {
      ...initial.existingCapacityCfg,
      node: { ...initial.existingCapacityCfg.node, coresPerSocket: 24 },
      san: { ...initial.existingCapacityCfg.san, usableTiB: 180 },
    }

    initial.setExistingCapacityCfg(existing)
    initial.setExistingCapacityNodes(5)

    const updated = useSurveyorStore.getState()
    expect(updated.existingCapacityCfg.node.coresPerSocket).toBe(24)
    expect(updated.existingCapacityCfg.san.usableTiB).toBe(180)
    expect(updated.existingCapacityNodes).toBe(5)
    expect(updated.cfg.node.coresPerSocket).toBe(forwardCores)
    expect(updated.cfg.san.usableTiB).not.toBe(180)
  })

  it('does not replace existing-capacity inputs when a forward scenario is loaded', () => {
    const initial = useSurveyorStore.getState()
    initial.setExistingCapacityNodes(6)
    initial.loadScenario({
      customerName: 'Forward design',
      cfg: { ...initial.cfg, spareNodes: 3 },
      tiers: initial.tiers,
      vms: [],
    })

    expect(useSurveyorStore.getState().existingCapacityNodes).toBe(6)
  })
})

describe('starting fresh', () => {
  beforeEach(() => {
    useSurveyorStore.getState().resetScenario()
  })

  it('clears workloads, settings, answers, and saved scenarios back to the defaults', () => {
    const store = useSurveyorStore.getState()
    const clean = structuredClone({ cfg: store.cfg, tiers: store.tiers, placementInputs: store.placementInputs, existingCapacityCfg: store.existingCapacityCfg, existingCapacityNodes: store.existingCapacityNodes })

    store.setEngagementMode('new-platform')
    store.setManagementDecision('design')
    store.setCustomerName('Contoso')
    store.loadDemo()
    store.setCfg({ ...store.cfg, spareNodes: 0, node: { ...store.cfg.node, ramGiB: 1024 } })
    store.setTiers({ ...store.tiers, general: { ...store.tiers.general, oversubscription: 2 } })
    store.setChosenKey('hybrid')
    store.setPlacementInputs({ ...store.placementInputs, clusterLayout: 'split' })
    store.setExistingCapacityNodes(40)
    store.setStorageDecisionAnswers({ existingArray: true })
    store.setReportMetadata({ ...store.reportMetadata, author: 'Someone', architectureKeys: [] })
    store.addDataSource({ kind: 'rvtools', fileName: 'estate.xlsx', rows: 700 })
    store.saveNamedScenario('Keep me')

    useSurveyorStore.getState().resetScenario()

    const reset = useSurveyorStore.getState()
    expect(reset.vms).toEqual([])
    expect(reset.engagementMode).toBeNull()
    expect(reset.managementDecision).toBe('unassessed')
    expect(reset.customerName).toBe('')
    expect(reset.chosenKey).toBe('san')
    expect(reset.savedScenarios).toEqual([])
    expect(reset.dataSources).toEqual([])
    expect(reset.lastImport).toBeNull()
    expect(reset.storageDecisionAnswers).toEqual({})
    expect(reset.managementDeploymentInputs).toBeNull()
    expect(reset.reportMetadata.author).toBe('')
    expect(reset.reportMetadata.architectureKeys).toBeUndefined()
    expect({ cfg: reset.cfg, tiers: reset.tiers, placementInputs: reset.placementInputs, existingCapacityCfg: reset.existingCapacityCfg, existingCapacityNodes: reset.existingCapacityNodes }).toEqual(clean)
  })
})

describe('management deployment state', () => {
  beforeEach(() => {
    useSurveyorStore.getState().resetScenario()
  })

  it('persists deployment choices for the solution report', () => {
    const initial = useSurveyorStore.getState()
    const inputs = {
      foundation: 'scvmm' as const,
      wac: 'wac-admin' as const,
      includeArc: true,
      monitoring: 'scom' as const,
      highAvailability: true,
      managedHosts: 8,
      managedVms: 400,
      managedClusters: 2,
      libraryContentGiB: 500,
      includeIdentityServices: false,
    }

    initial.setManagementDeploymentInputs(inputs)
    initial.setIncludeManagementInSizing(false)

    expect(useSurveyorStore.getState().managementDeploymentInputs).toEqual(inputs)
    expect(useSurveyorStore.getState().includeManagementInSizing).toBe(false)
  })
})
