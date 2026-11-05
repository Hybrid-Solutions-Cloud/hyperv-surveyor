import type { Vm } from './types'

export interface StorageOutlier {
  vmId: string
  vmName: string
  storageGiB: number
  /** Share of all included consumed storage, in percent. */
  sharePct: number
  /** How many times the median included VM this one is. */
  timesMedian: number
  hasSharedDisk: boolean
}

export interface StorageOutlierOptions {
  /** [TOOL] A VM must hold at least this share of included storage. */
  minSharePct?: number
  /** [TOOL] A VM must be at least this many times the median included VM. */
  minTimesMedian?: number
  /** [TOOL] Below this many included VMs with storage, no outliers are reported. */
  minVms?: number
}

export const STORAGE_OUTLIER_DEFAULTS: Required<StorageOutlierOptions> = { minSharePct: 5, minTimesMedian: 10, minVms: 3 }

/**
 * Included VMs that hold an outsized share of consumed storage, largest first. Pure, so the
 * import, the inventory and later the report use the same list. A shared disk counted on several
 * VMs, a mis-read storage column or a file server that belongs on its own array all show up here.
 */
export function findStorageOutliers(vms: Vm[], options: StorageOutlierOptions = {}): StorageOutlier[] {
  const { minSharePct, minTimesMedian, minVms } = { ...STORAGE_OUTLIER_DEFAULTS, ...options }
  const included = vms.filter((vm) => vm.include && vm.storageGiB > 0)
  if (included.length < minVms) return []
  const total = included.reduce((sum, vm) => sum + vm.storageGiB, 0)
  const sorted = included.map((vm) => vm.storageGiB).sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  if (total <= 0 || median <= 0) return []
  return included
    .map((vm) => ({
      vmId: vm.id,
      vmName: vm.name,
      storageGiB: vm.storageGiB,
      sharePct: (vm.storageGiB / total) * 100,
      timesMedian: vm.storageGiB / median,
      hasSharedDisk: !!vm.hasSharedDisk,
    }))
    .filter((item) => item.sharePct >= minSharePct && item.timesMedian >= minTimesMedian)
    .sort((a, b) => b.storageGiB - a.storageGiB)
}

export interface StorageOutlierFinding {
  outliers: StorageOutlier[]
  /** Combined share of included storage held by the outliers, in percent. */
  sharePct: number
  message: string
}

/** The data-quality finding shown with the inventory, or null when there are no outliers. */
export function storageOutlierFinding(vms: Vm[], options?: StorageOutlierOptions): StorageOutlierFinding | null {
  const outliers = findStorageOutliers(vms, options)
  if (outliers.length === 0) return null
  const sharePct = outliers.reduce((sum, item) => sum + item.sharePct, 0)
  const shared = outliers.filter((item) => item.hasSharedDisk).length
  return {
    outliers,
    sharePct,
    message: `${outliers.length} VM${outliers.length === 1 ? ' holds' : 's hold'} ${sharePct.toFixed(0)}% of included consumed storage. Confirm these figures before sizing storage: a shared disk counted on several VMs, a wrong storage column, or a file or backup server that belongs on separate storage are common causes.${shared ? ` ${shared} of them ha${shared === 1 ? 's' : 've'} shared disks.` : ''}`,
  }
}
