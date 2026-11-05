import { beforeEach, describe, expect, it } from 'vitest'
import { migratePersistedState, payloadFromState, useSurveyorStore } from './store'
import { createProject, parseProject } from './project'
import { blankVm, bulkVms } from './defaults'

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

describe('B15 projects and named scenarios', () => {
  beforeEach(() => {
    useSurveyorStore.getState().resetScenario()
  })

  it('a project file carries saved scenarios and opening it replaces them', () => {
    const store = useSurveyorStore.getState()
    store.setCustomerName('Sender')
    store.saveNamedScenario('Option A')
    const project = parseProject(JSON.stringify(createProject(payloadFromState(useSurveyorStore.getState()), useSurveyorStore.getState().savedScenarios)))
    expect(project.savedScenarios?.map((item) => item.name)).toEqual(['Option A'])

    useSurveyorStore.getState().resetScenario()
    useSurveyorStore.getState().saveNamedScenario('Local only')
    useSurveyorStore.getState().loadProject(project.payload, project.savedScenarios)
    expect(useSurveyorStore.getState().savedScenarios.map((item) => item.name)).toEqual(['Option A'])
  })

  it('an older project file without scenarios keeps the local ones', () => {
    useSurveyorStore.getState().saveNamedScenario('Local only')
    const legacy = { kind: 'hyperv-surveyor-project', schemaVersion: 4, engineVersion: '1.1.0', exportedAt: '', payload: payloadFromState(useSurveyorStore.getState()) }
    const project = parseProject(JSON.stringify(legacy))
    expect(project.savedScenarios).toBeUndefined()
    useSurveyorStore.getState().loadProject(project.payload, project.savedScenarios)
    expect(useSurveyorStore.getState().savedScenarios.map((item) => item.name)).toEqual(['Local only'])
  })

  it('opening a project or a named scenario clears the previous import banner', () => {
    const store = useSurveyorStore.getState()
    store.saveNamedScenario('Before import')
    const summary = { format: 'rvtools', fileName: 'a.xlsx', importedVms: 1 } as never
    store.setLastImport(summary)
    useSurveyorStore.getState().loadNamedScenario(useSurveyorStore.getState().savedScenarios[0].id)
    expect(useSurveyorStore.getState().lastImport).toBeNull()
    useSurveyorStore.getState().setLastImport(summary)
    useSurveyorStore.getState().loadProject(payloadFromState(useSurveyorStore.getState()))
    expect(useSurveyorStore.getState().lastImport).toBeNull()
  })
})

describe('B17 inventory housekeeping', () => {
  beforeEach(() => {
    useSurveyorStore.getState().resetScenario()
  })

  it('demo and clear drop the previous import summary and data sources', () => {
    const store = useSurveyorStore.getState()
    store.addDataSource({ kind: 'rvtools', fileName: 'estate.xlsx', rows: 10 })
    store.setLastImport({ fileName: 'estate.xlsx' } as never)
    store.loadDemo()
    expect(useSurveyorStore.getState()).toMatchObject({ dataSources: [], lastImport: null })
    useSurveyorStore.getState().addDataSource({ kind: 'performance', fileName: 'perf.csv', rows: 10 })
    useSurveyorStore.getState().clearWorkloads()
    expect(useSurveyorStore.getState()).toMatchObject({ vms: [], dataSources: [], lastImport: null })
  })

  it('a blank row is excluded and adds nothing to sizing; a fractional count adds whole VMs', () => {
    expect(blankVm()).toMatchObject({ vCpu: 0, ramGiB: 0, storageGiB: 0, include: false })
    expect(bulkVms(1.5, 'general', 4, 16, 200, 'VM')).toHaveLength(1)
  })

  it('migration normalizes numbers saved as text', () => {
    const migrated = migratePersistedState({ vms: [{ id: 'a', name: 'app1', vCpu: '4', ramGiB: '16', storageGiB: '200', provisionedGiB: '', include: true }], savedScenarios: [{ id: 's', name: 'S', vms: [{ name: 'x', vCpu: '2' }] }] })
    expect(migrated.vms[0]).toMatchObject({ vCpu: 4, ramGiB: 16, storageGiB: 200, provisionedGiB: 200 })
    expect(migrated.savedScenarios[0].vms[0].vCpu).toBe(2)
  })
})
