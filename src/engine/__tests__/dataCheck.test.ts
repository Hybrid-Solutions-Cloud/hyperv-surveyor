import { describe, expect, it } from 'vitest'
import { applyOutlierDecision, excludedWorkloadCounts, findStorageOutliers, summarizeDataCheck } from '../dataQuality'
import { solveForward } from '../solve'
import { normalizeProjectPayload } from '../../state/project'
import { buildSolutionReport } from '../../report/reportModel'
import { DEFAULT_PROPOSED_CONFIG, defaultTiers } from '../../state/defaults'
import { makeConfig, makeTiers, vm } from './fixtures'
import type { Vm } from '../types'

// A generic inventory with one VM far larger than the rest. No customer data.
function inventory(): Vm[] {
  return [
    ...Array.from({ length: 40 }, (_, i) => vm({ id: `small-${i}`, name: `APP${i}`, storageGiB: 200 })),
    vm({ id: 'big', name: 'FILE01', storageGiB: 80_000, hasSharedDisk: true }),
    vm({ id: 'off', name: 'OLD01', include: false, powerState: 'poweredOff' }),
    vm({ id: 'dup-a', name: 'WEB01' }),
    vm({ id: 'dup-b', name: 'web01' }),
  ]
}

describe('data check: storage outliers', () => {
  it('finds the outlier and changes nothing until a choice is made', () => {
    const vms = inventory()
    const summary = summarizeDataCheck(vms)
    expect(summary.outliers.map((row) => row.vmId)).toEqual(['big'])
    expect(summary.undecidedOutliers).toBe(1)
    expect(vms.find((item) => item.id === 'big')!.storageGiB).toBe(80_000)
  })

  it('cap and exclude change sizing; keep and undo restore the imported figures', () => {
    const cfg = makeConfig({ architecture: 'san', sanSizingMode: 'calculated' })
    const tiers = makeTiers()
    const vms = inventory()
    const before = solveForward(cfg, vms, tiers).requiredStorageTiB
    const capped = applyOutlierDecision(vms, 'big', 'cap', 2_000)
    expect(capped.find((item) => item.id === 'big')!.storageGiB).toBe(2_000)
    const cappedTiB = solveForward(cfg, capped, tiers).requiredStorageTiB
    expect(cappedTiB).toBeCloseTo(before - 78_000 / 1024, 5)
    const excluded = applyOutlierDecision(capped, 'big', 'exclude')
    const big = excluded.find((item) => item.id === 'big')!
    expect(big.include).toBe(false)
    expect(big.storageGiB).toBe(80_000)
    expect(solveForward(cfg, excluded, tiers).requiredStorageTiB).toBeCloseTo(before - 80_000 / 1024, 5)
    expect(excludedWorkloadCounts(excluded).storageOutlier).toBe(1)
    const kept = applyOutlierDecision(excluded, 'big', 'keep')
    expect(kept.find((item) => item.id === 'big')).toMatchObject({ include: true, storageGiB: 80_000, outlierDecision: { choice: 'keep' } })
    const undone = applyOutlierDecision(kept, 'big', 'undo')
    expect(undone.find((item) => item.id === 'big')!.outlierDecision).toBeUndefined()
    expect(solveForward(cfg, undone, tiers).requiredStorageTiB).toBeCloseTo(before, 5)
  })

  it('keeps a decided VM listed after capping makes it ordinary', () => {
    const capped = applyOutlierDecision(inventory(), 'big', 'cap', 200)
    expect(findStorageOutliers(capped)).toEqual([])
    const row = summarizeDataCheck(capped).outliers.find((item) => item.vmId === 'big')!
    expect(row.decision?.choice).toBe('cap')
    expect(row.originalStorageGiB).toBe(80_000)
  })

  it('saves the choice in the project and shows it in the report', () => {
    const vms = applyOutlierDecision(inventory(), 'big', 'cap', 5_000)
    const reopened = normalizeProjectPayload(JSON.parse(JSON.stringify({ vms, cfg: DEFAULT_PROPOSED_CONFIG }))).vms
    expect(reopened.find((item) => item.id === 'big')!.outlierDecision).toEqual({ choice: 'cap', originalStorageGiB: 80_000, originalInclude: true, capGiB: 5_000 })
    const malformed = normalizeProjectPayload({ vms: [{ name: 'X', outlierDecision: { choice: 'cap' } }] }).vms[0]
    expect(malformed.outlierDecision).toBeUndefined()
    const report = buildSolutionReport({ engagementMode: 'new-platform', customerName: '', cfg: structuredClone(DEFAULT_PROPOSED_CONFIG), vms: reopened, tiers: defaultTiers(), chosenKey: 'san', managementDeploymentInputs: null, includeManagementInSizing: true })
    const table = report.sections.find((item) => item.id === 'workloads')!.tables.find((item) => item.title === 'Data check: storage outlier choices')!
    expect(table.rows[0][0]).toBe('FILE01')
    expect(table.rows[0][1]).toMatch(/Capped at/)
  })
})

describe('data check: other findings', () => {
  it('reports excluded reasons, shared disks, duplicates, missing columns and performance coverage', () => {
    const summary = summarizeDataCheck(inventory(), {
      fileName: 'inventory.xlsx',
      excludedTemplates: 3,
      detection: { rdm: true, sharedDisks: true, encryption: false, vtpm: false },
      storageSources: { partition: 40, inUse: 0, provisioned: 0, none: 2, sharedDeduped: 0 },
      warnings: ['Example warning'],
    })
    expect(summary.counted).toBe(43)
    expect(summary.excluded.poweredOff).toBe(1)
    expect(summary.excluded.templates).toBe(3)
    expect(summary.sharedDiskVms).toBe(1)
    expect(summary.duplicateNames).toEqual([{ name: 'WEB01', count: 2 }])
    expect(summary.missingColumns.join(' ')).toMatch(/VM encryption/)
    expect(summary.missingColumns.join(' ')).toMatch(/2 VM\(s\) had no consumed-storage/)
    expect(summary.measuredVms).toBe(0)
    expect(summary.importWarnings).toEqual(['Example warning'])
  })
})
