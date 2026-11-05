import type { OutlierDecision, Vm } from './types'

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

/** The import details the data check reads. Matches ImportSummary from the inventory import. */
export interface DataCheckImport {
  fileName?: string
  excludedTemplates?: number
  excludedSrmPlaceholders?: number
  excludedVcls?: number
  detection?: { rdm: boolean; sharedDisks: boolean; encryption: boolean; vtpm: boolean }
  warnings?: string[]
  storageSources?: { partition: number; inUse: number; provisioned: number; none: number; sharedDeduped: number }
}

export interface ExcludedCounts {
  poweredOff: number
  zeroSpec: number
  /** Excluded by your choice on the Data check page. */
  storageOutlier: number
  other: number
  templates: number
  placeholders: number
  vcls: number
}

/** Excluded workload records by reason, from the inventory and the last import. */
export function excludedWorkloadCounts(vms: Vm[], lastImport?: DataCheckImport | null): ExcludedCounts {
  const excluded = vms.filter((vm) => !vm.include)
  const outlier = excluded.filter((vm) => vm.outlierDecision?.choice === 'exclude')
  const rest = excluded.filter((vm) => vm.outlierDecision?.choice !== 'exclude')
  const zeroSpec = rest.filter((vm) => !(vm.vCpu > 0) || !(vm.ramGiB > 0))
  const poweredOff = rest.filter((vm) => (vm.powerState === 'poweredOff' || vm.powerState === 'suspended') && !zeroSpec.includes(vm))
  return {
    poweredOff: poweredOff.length,
    zeroSpec: zeroSpec.length,
    storageOutlier: outlier.length,
    other: Math.max(0, rest.length - zeroSpec.length - poweredOff.length),
    templates: lastImport?.excludedTemplates ?? 0,
    placeholders: lastImport?.excludedSrmPlaceholders ?? 0,
    vcls: lastImport?.excludedVcls ?? 0,
  }
}

/**
 * Applies a storage-outlier choice to one VM and returns a new inventory. Any earlier choice is undone
 * first, so choices never stack. 'undo' restores the imported figures. Nothing else changes.
 */
export function applyOutlierDecision(vms: Vm[], vmId: string, choice: OutlierDecision['choice'] | 'undo', capGiB?: number): Vm[] {
  return vms.map((vm) => {
    if (vm.id !== vmId) return vm
    const previous = vm.outlierDecision
    const originalStorageGiB = previous?.originalStorageGiB ?? vm.storageGiB
    const originalInclude = previous?.originalInclude ?? vm.include
    const restored: Vm = { ...vm, storageGiB: originalStorageGiB, include: originalInclude }
    delete restored.outlierDecision
    if (choice === 'undo') return restored
    const decision: OutlierDecision = { choice, originalStorageGiB, originalInclude }
    if (choice === 'cap') {
      const cap = Math.max(0, Math.min(originalStorageGiB, Number.isFinite(capGiB) ? capGiB! : originalStorageGiB))
      decision.capGiB = cap
      return { ...restored, storageGiB: cap, outlierDecision: decision }
    }
    if (choice === 'exclude') return { ...restored, include: false, outlierDecision: decision }
    return { ...restored, outlierDecision: decision }
  })
}

export interface DataCheckOutlierRow {
  vmId: string
  vmName: string
  /** Consumed storage as imported, before any choice. */
  originalStorageGiB: number
  /** What sizing counts now: 0 when excluded. */
  countedStorageGiB: number
  sharePct: number | null
  timesMedian: number | null
  hasSharedDisk: boolean
  decision: OutlierDecision | null
}

export interface DataCheckSummary {
  totalRecords: number
  counted: number
  excluded: ExcludedCounts
  excludedTotal: number
  /** Current outliers and every VM you already made a choice for. */
  outliers: DataCheckOutlierRow[]
  undecidedOutliers: number
  sharedDiskVms: number
  sharedStorageDedupedGiB: number
  /** Checks the source file's columns did not allow. */
  missingColumns: string[]
  /** Names that appear more than once among the records, with the count. */
  duplicateNames: Array<{ name: string; count: number }>
  /** Included VMs with CPU or memory P95 measurements. */
  measuredVms: number
  importWarnings: string[]
}

const DETECTION_LABELS: Record<keyof NonNullable<DataCheckImport['detection']>, string> = {
  rdm: 'Raw device mappings (RDM)',
  sharedDisks: 'Shared or multi-writer disks',
  encryption: 'VM encryption',
  vtpm: 'Virtual TPM',
}

/** Everything the Data check page shows, for any inventory. Pure; changes nothing. */
export function summarizeDataCheck(vms: Vm[], lastImport?: DataCheckImport | null): DataCheckSummary {
  const excluded = excludedWorkloadCounts(vms, lastImport)
  const current = new Map(findStorageOutliers(vms).map((item) => [item.vmId, item]))
  const decided = vms.filter((vm) => vm.outlierDecision)
  const ids = new Set([...current.keys(), ...decided.map((vm) => vm.id)])
  const byId = new Map(vms.map((vm) => [vm.id, vm]))
  const outliers: DataCheckOutlierRow[] = [...ids].map((id) => {
    const vm = byId.get(id)!
    const found = current.get(id)
    return {
      vmId: id,
      vmName: vm.name,
      originalStorageGiB: vm.outlierDecision?.originalStorageGiB ?? vm.storageGiB,
      countedStorageGiB: vm.include ? vm.storageGiB : 0,
      sharePct: found?.sharePct ?? null,
      timesMedian: found?.timesMedian ?? null,
      hasSharedDisk: !!vm.hasSharedDisk,
      decision: vm.outlierDecision ?? null,
    }
  }).sort((a, b) => b.originalStorageGiB - a.originalStorageGiB)
  const names = new Map<string, number>()
  for (const vm of vms) names.set(vm.name.trim().toLowerCase(), (names.get(vm.name.trim().toLowerCase()) ?? 0) + 1)
  const seen = new Set<string>()
  const duplicateNames: Array<{ name: string; count: number }> = []
  for (const vm of vms) {
    const key = vm.name.trim().toLowerCase()
    if ((names.get(key) ?? 0) > 1 && !seen.has(key)) {
      seen.add(key)
      duplicateNames.push({ name: vm.name, count: names.get(key)! })
    }
  }
  const detection = lastImport?.detection
  const missingColumns = detection
    ? (Object.keys(DETECTION_LABELS) as Array<keyof typeof DETECTION_LABELS>).filter((key) => !detection[key]).map((key) => `${DETECTION_LABELS[key]}: the file has no column for this, so it could not be checked.`)
    : []
  if (lastImport?.storageSources && lastImport.storageSources.none > 0) {
    missingColumns.push(`${lastImport.storageSources.none} VM(s) had no consumed-storage column value; their storage counts as 0.`)
  }
  const included = vms.filter((vm) => vm.include)
  const counted = included.length
  return {
    totalRecords: vms.length,
    counted,
    excluded,
    excludedTotal: vms.length - counted,
    outliers,
    undecidedOutliers: outliers.filter((row) => !row.decision).length,
    sharedDiskVms: included.filter((vm) => vm.hasSharedDisk).length,
    sharedStorageDedupedGiB: included.reduce((sum, vm) => sum + (vm.sharedStorageDedupedGiB ?? 0), 0),
    missingColumns,
    duplicateNames,
    measuredVms: included.filter((vm) => vm.performance?.cpuP95Pct !== undefined || vm.performance?.memoryP95Pct !== undefined).length,
    importWarnings: lastImport?.warnings ?? [],
  }
}

export const OUTLIER_CHOICE_LABELS: Record<OutlierDecision['choice'], string> = {
  keep: 'Counted as imported',
  cap: 'Capped',
  exclude: 'Excluded from sizing',
}
