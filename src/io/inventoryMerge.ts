import type { Vm } from '../engine/types'
import type { HostRecord, ImportSummary } from './rvtools'

export interface InventoryMergeResult {
  vms: Vm[]
  added: Vm[]
  /** Incoming rows dropped because a VM with the same name and vCenter was already present. */
  skipped: Vm[]
  /** Incoming rows kept although their name already exists, because the vCenter differs or is unknown. */
  sameNameKept: number
}

const vCenterOf = (vm: Vm) => (vm.sourceVCenter ?? '').trim().toLowerCase()
const identityKey = (vm: Vm) => `${vm.name.trim()}\u0000${vCenterOf(vm)}`

/**
 * Adds a second import to the current inventory. Existing rows, with their edits and measured
 * performance, are kept unchanged. An incoming row is dropped as a duplicate only when both the VM
 * name and the vCenter match; a blank vCenter never matches, so nothing real is dropped on a guess.
 */
export function mergeInventories(existing: Vm[], incoming: Vm[]): InventoryMergeResult {
  const known = new Set(existing.filter((vm) => vCenterOf(vm)).map(identityKey))
  const names = new Set(existing.map((vm) => vm.name.trim()))
  const ids = new Set(existing.map((vm) => vm.id))
  const added: Vm[] = []
  const skipped: Vm[] = []
  let sameNameKept = 0
  let seq = 0
  for (const vm of incoming) {
    if (vCenterOf(vm) && known.has(identityKey(vm))) { skipped.push(vm); continue }
    if (names.has(vm.name.trim())) sameNameKept++
    let id = vm.id
    while (ids.has(id)) { seq += 1; id = `${vm.id}-add${seq}` }
    ids.add(id)
    added.push(id === vm.id ? vm : { ...vm, id })
  }
  return { vms: [...existing, ...added], added, skipped, sameNameKept }
}

function mergeHosts(a: HostRecord[] = [], b: HostRecord[] = []): HostRecord[] {
  const key = (host: HostRecord) => `${host.vCenter.toLowerCase()}|${host.name}`
  const seen = new Set(a.map(key))
  return [...a, ...b.filter((host) => !seen.has(key(host)))]
}

/** One import banner for an inventory built from two or more files. */
export function combineImportSummaries(previous: ImportSummary | null, next: ImportSummary, merge: InventoryMergeResult): ImportSummary {
  const skippedOff = merge.skipped.filter((vm) => vm.powerState === 'poweredOff').length
  const skippedSuspended = merge.skipped.filter((vm) => vm.powerState === 'suspended').length
  const notes = [
    merge.skipped.length > 0 && `${next.fileName}: ${merge.skipped.length} VM(s) were already in the inventory with the same name and vCenter, so the existing rows and their edits were kept.`,
    merge.sameNameKept > 0 && `${next.fileName}: ${merge.sameNameKept} VM(s) share a name with an existing VM but not a known vCenter, so both were kept. Remove any that are the same VM.`,
  ].filter((note): note is string => !!note)
  const addedNext: ImportSummary = {
    ...next,
    importedVms: merge.added.length,
    poweredOff: next.poweredOff - skippedOff,
    suspended: next.suspended - skippedSuspended,
  }
  if (!previous) return { ...addedNext, warnings: [...notes, ...next.warnings] }
  const hosts = mergeHosts(previous.hostSummary?.perHost, next.hostSummary?.perHost)
  const hostSummary = previous.hostSummary || next.hostSummary
    ? {
      hosts: hosts.length || (previous.hostSummary?.hosts ?? 0) + (next.hostSummary?.hosts ?? 0),
      totalPhysicalCores: hosts.length ? hosts.reduce((sum, host) => sum + host.totalCores, 0) : (previous.hostSummary?.totalPhysicalCores ?? 0) + (next.hostSummary?.totalPhysicalCores ?? 0),
      totalRamGiB: hosts.length ? Math.round(hosts.reduce((sum, host) => sum + host.ramGiB, 0)) : (previous.hostSummary?.totalRamGiB ?? 0) + (next.hostSummary?.totalRamGiB ?? 0),
      clusters: [...new Set([...(previous.hostSummary?.clusters ?? []), ...(next.hostSummary?.clusters ?? [])])],
      cpuModels: [...new Set([...(previous.hostSummary?.cpuModels ?? []), ...(next.hostSummary?.cpuModels ?? [])])],
      perHost: hosts,
    }
    : null
  const sum = (key: 'totalRows' | 'excludedTemplates' | 'excludedSrmPlaceholders' | 'excludedVcls' | 'poweredOff' | 'suspended' | 'importedVms') => (previous[key] ?? 0) + (addedNext[key] ?? 0)
  const sources = previous.storageSources && next.storageSources
    ? Object.fromEntries(Object.keys(next.storageSources).map((key) => [key, (previous.storageSources as any)[key] + (next.storageSources as any)[key]])) as ImportSummary['storageSources']
    : next.storageSources
  return {
    format: next.format,
    fileName: `${previous.fileName} + ${next.fileName}`,
    totalRows: sum('totalRows'),
    excludedTemplates: sum('excludedTemplates'),
    excludedSrmPlaceholders: sum('excludedSrmPlaceholders'),
    excludedVcls: sum('excludedVcls'),
    poweredOff: sum('poweredOff'),
    suspended: sum('suspended'),
    importedVms: sum('importedVms'),
    usedPartitionData: previous.usedPartitionData || next.usedPartitionData,
    storageSources: sources,
    detection: {
      rdm: !!previous.detection?.rdm && next.detection.rdm,
      sharedDisks: !!previous.detection?.sharedDisks && next.detection.sharedDisks,
      encryption: !!previous.detection?.encryption && next.detection.encryption,
      vtpm: !!previous.detection?.vtpm && next.detection.vtpm,
      rdmMode: !!previous.detection?.rdmMode && !!next.detection.rdmMode,
      diskMode: !!previous.detection?.diskMode && !!next.detection.diskMode,
      vsan: !!previous.detection?.vsan && !!next.detection.vsan,
    },
    warnings: [...new Set([...notes, ...previous.warnings, ...next.warnings])],
    hostSummary,
  }
}
