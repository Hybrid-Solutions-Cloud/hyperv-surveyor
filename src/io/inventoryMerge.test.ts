import { beforeEach, describe, expect, it } from 'vitest'
import { combineImportSummaries, mergeInventories } from './inventoryMerge'
import { newVm } from '../state/defaults'
import { useSurveyorStore } from '../state/store'
import type { ImportReport } from './rvtools'
import { summarizeImport } from './rvtools'

const report = (vms: ImportReport['vms']): ImportReport => ({
  format: 'rvtools', vms, totalRows: vms.length, excludedTemplates: 0, excludedSrmPlaceholders: 0, excludedVcls: 0,
  poweredOff: vms.filter((vm) => vm.powerState === 'poweredOff').length, suspended: 0, usedPartitionData: false,
  storageSources: { partition: 0, inUse: vms.length, provisioned: 0, none: 0, sharedDeduped: 0 },
  detection: { rdm: true, sharedDisks: true, encryption: true, vtpm: true }, warnings: [], hostSummary: null,
})

describe('B7 adding a second inventory file', () => {
  it('keeps existing rows and edits, and drops an incoming row only when name and vCenter match', () => {
    const existing = [newVm({ id: 'rv-1', name: 'app1', sourceVCenter: 'vc1', vCpu: 12 }), newVm({ id: 'rv-2', name: 'app2', sourceVCenter: 'vc1' })]
    const incoming = [
      newVm({ id: 'rv-1', name: 'app1', sourceVCenter: 'VC1', vCpu: 4 }),
      newVm({ id: 'rv-2', name: 'app2', sourceVCenter: 'vc2' }),
      newVm({ id: 'rv-3', name: 'app3' }),
    ]
    const merged = mergeInventories(existing, incoming)
    expect(merged.vms.map((vm) => [vm.name, vm.sourceVCenter, vm.vCpu])).toEqual([['app1', 'vc1', 12], ['app2', 'vc1', 4], ['app2', 'vc2', 4], ['app3', undefined, 4]])
    expect(merged.skipped).toHaveLength(1)
    expect(merged.sameNameKept).toBe(1)
    expect(new Set(merged.vms.map((vm) => vm.id)).size).toBe(4)
  })

  it('never drops a row when the vCenter is unknown', () => {
    const merged = mergeInventories([newVm({ name: 'app1' })], [newVm({ name: 'app1' })])
    expect(merged.vms).toHaveLength(2)
  })

  it('combines the two import summaries', () => {
    const first = summarizeImport(report([newVm({ name: 'a', sourceVCenter: 'vc1' })]), 'one.xlsx')
    const second = report([newVm({ name: 'a', sourceVCenter: 'vc1' }), newVm({ name: 'b', sourceVCenter: 'vc2', powerState: 'poweredOff' })])
    const merge = mergeInventories([newVm({ name: 'a', sourceVCenter: 'vc1' })], second.vms)
    const combined = combineImportSummaries(first, summarizeImport(second, 'two.xlsx'), merge)
    expect(combined).toMatchObject({ fileName: 'one.xlsx + two.xlsx', importedVms: 2, totalRows: 3, poweredOff: 1 })
    expect(combined.warnings.some((warning) => /two.xlsx: 1 VM\(s\) were already in the inventory/.test(warning))).toBe(true)
  })
})

describe('B7 store import modes', () => {
  beforeEach(() => useSurveyorStore.getState().resetScenario())

  it('replace drops the old inventory and its sources; add keeps them', () => {
    const store = useSurveyorStore.getState()
    store.applyImport('replace', report([newVm({ name: 'a', sourceVCenter: 'vc1' })]), 'one.xlsx')
    store.setVms(useSurveyorStore.getState().vms.map((vm) => ({ ...vm, vCpu: 32 })))
    store.addDataSource({ kind: 'performance', fileName: 'perf.csv', rows: 1 })
    useSurveyorStore.getState().applyImport('add', report([newVm({ name: 'b', sourceVCenter: 'vc2' })]), 'two.xlsx')
    let state = useSurveyorStore.getState()
    expect(state.vms.map((vm) => [vm.name, vm.vCpu])).toEqual([['a', 32], ['b', 4]])
    expect(state.dataSources.map((source) => source.fileName)).toEqual(['two.xlsx', 'perf.csv', 'one.xlsx'])
    expect(state.lastImport?.fileName).toBe('one.xlsx + two.xlsx')

    state.applyImport('replace', report([newVm({ name: 'c' })]), 'three.xlsx')
    state = useSurveyorStore.getState()
    expect(state.vms.map((vm) => vm.name)).toEqual(['c'])
    expect(state.dataSources.map((source) => source.fileName)).toEqual(['three.xlsx'])
    expect(state.lastImport?.fileName).toBe('three.xlsx')
  })
})
