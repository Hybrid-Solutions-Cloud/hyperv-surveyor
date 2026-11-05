import { describe, expect, it } from 'vitest'
import { findStorageOutliers, storageOutlierFinding } from '../dataQuality'
import { newVm } from '../../state/defaults'

const fleet = (count: number, storageGiB = 100) => Array.from({ length: count }, (_, i) => newVm({ name: `vm${i}`, storageGiB }))

describe('storage outliers', () => {
  it('lists VMs that hold an outsized share of storage, largest first', () => {
    const vms = [...fleet(50), newVm({ name: 'files', storageGiB: 20 * 1024 }), newVm({ name: 'backup', storageGiB: 8 * 1024, hasSharedDisk: true })]
    const outliers = findStorageOutliers(vms)
    expect(outliers.map((item) => item.vmName)).toEqual(['files', 'backup'])
    expect(outliers[0].sharePct).toBeCloseTo((20 * 1024) / (5000 + 28 * 1024) * 100)
    const finding = storageOutlierFinding(vms)!
    expect(finding.message).toMatch(/^2 VMs hold \d+% of included consumed storage/)
    expect(finding.message).toMatch(/1 of them has shared disks/)
  })

  it('reports nothing for an even estate, a tiny estate, or excluded VMs', () => {
    expect(findStorageOutliers(fleet(30))).toEqual([])
    expect(findStorageOutliers([newVm({ storageGiB: 10 }), newVm({ storageGiB: 5000 })])).toEqual([])
    expect(findStorageOutliers([...fleet(20), newVm({ name: 'off', storageGiB: 50000, include: false })])).toEqual([])
    expect(storageOutlierFinding(fleet(10))).toBeNull()
  })
})
