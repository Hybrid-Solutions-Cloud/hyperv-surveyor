/**
 * RVTools import.
 *
 * THE CRITICAL CAVEAT, restated here because it changes how results must be read:
 * RVTools contains NO historical utilisation data. vInfo / vCPU / vMemory are ALLOCATION only.
 * The "CPU Usage %" and "Memory Usage %" columns on vHost are a point-in-time snapshot taken
 * at the moment RVTools connected to vCenter, NOT an average. A sizing built purely on an
 * RVTools import therefore sizes on allocation and will oversize, often substantially, because
 * VMware estates are typically over-provisioned at the vCPU level.
 *
 * The engine handles that with a visible per-tier Right-Sizing Factor, defaulted to 1.0.
 * If real utilisation matters, bring a Live Optics or Aria Operations export as well —
 * those do carry time-series data.
 *
 * VERSION GOTCHA: RVTools renamed columns from "MB" to "MiB" in v4.1.2. Both spellings are
 * accepted below. Current RVTools is 4.8.1, owned by Dell since 2023.
 *
 * COLUMN NAMES: vDisk Raw, Raw Comp. Mode, Sharing mode, Shared Bus, Disk Path, vInfo Unshared MiB,
 * Encrypted and TPM are taken from RVTools documentation and community answers, not from a
 * published schema. Every one is optional. When a column is absent the import says that the
 * check was not possible, rather than implying that nothing was found.
 */
import * as XLSX from 'xlsx'
import { AUTO_CLASSIFY } from '../engine/rules'
import type { CpuVendor, PowerState, Vm } from '../engine/types'
import { classify } from './classifyVm'

export { classify } from './classifyVm'

export type InventoryFormat = 'rvtools' | 'rvtools-vinfo-csv' | 'inventory-template'

/** Which checks the file's columns made possible. False means "could not check", not "none". */
export interface ImportDetection {
  rdm: boolean
  sharedDisks: boolean
  /** vDisk Raw Comp. Mode: physical or virtual compatibility. */
  rdmMode?: boolean
  /** vDisk Disk Mode: independent disks. */
  diskMode?: boolean
  /** vDatastore Type with a datastore path for the VM's disks: vSAN placement. */
  vsan?: boolean
  encryption: boolean
  vtpm: boolean
}

/** How many imported VMs took their consumed storage from each source. */
export interface StorageSourceCounts {
  partition: number
  inUse: number
  provisioned: number
  none: number
  /** Members of a shared-disk group whose shared space was counted once. */
  sharedDeduped: number
}

export interface ImportReport {
  format: InventoryFormat
  vms: Vm[]
  totalRows: number
  excludedTemplates: number
  excludedSrmPlaceholders: number
  excludedVcls: number
  poweredOff: number
  suspended: number
  usedPartitionData: boolean
  storageSources: StorageSourceCounts
  detection: ImportDetection
  warnings: string[]
  hostSummary: HostSummary | null
}

/** Everything about an import except the VMs, which live in the workload inventory. */
export type ImportSummary = Omit<ImportReport, 'vms'> & { fileName: string; importedVms: number }

export function summarizeImport(report: ImportReport, fileName: string): ImportSummary {
  const { vms, ...summary } = report
  return { ...summary, fileName, importedVms: vms.length }
}

/** One vHost row. Kept per host, not only as totals, for the existing-hardware form. */
export interface HostRecord {
  name: string
  cluster: string
  datacenter: string
  vCenter: string
  sockets: number
  coresPerSocket: number
  totalCores: number
  ramGiB: number
  cpuModel: string
  cpuVendor: CpuVendor
  vmCount?: number
}

export interface HostSummary {
  hosts: number
  totalPhysicalCores: number
  totalRamGiB: number
  clusters: string[]
  cpuModels: string[]
  /** Every vHost row. Absent on summaries saved before per-host data was kept. */
  perHost: HostRecord[]
}

type Row = Record<string, any>

const keyCache = new Map<string, string>()
function normKey(key: string): string {
  let value = keyCache.get(key)
  if (value === undefined) {
    value = key.toLowerCase().replace(/\s+/g, '')
    keyCache.set(key, value)
  }
  return value
}

/** Case- and whitespace-insensitive column lookup that tolerates the MB -> MiB rename. */
export function pick(row: Row, ...names: string[]): any {
  const keys = Object.keys(row)
  for (const name of names) {
    const want = normKey(name)
    for (const k of keys) {
      if (normKey(k) === want) return row[k]
    }
  }
  return undefined
}

/** The first of the named columns that holds a value. An empty first column does not stop it. */
export function pickFilled(row: Row, ...names: string[]): any {
  for (const name of names) {
    const value = pick(row, name)
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return undefined
}

export function hasColumn(rows: Row[] | null | undefined, ...names: string[]): boolean {
  if (!rows || rows.length === 0) return false
  const keys = Object.keys(rows[0]).map(normKey)
  return names.some((name) => keys.includes(normKey(name)))
}

export function num(v: any): number {
  if (v === undefined || v === null || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function filled(v: any): boolean {
  return v !== undefined && v !== null && String(v).trim() !== '' && Number.isFinite(typeof v === 'number' ? v : parseFloat(String(v).replace(/[, ]/g, '')))
}

function flag(v: any): boolean {
  if (typeof v === 'boolean') return v
  const s = String(v ?? '').trim().toLowerCase()
  return ['true', 'yes', '1', 'enabled', 'encrypted', 'present', 'on'].includes(s)
}

const text = (v: any) => String(v ?? '').trim()
const mibToGiB = (mib: number) => mib / 1024
const r2 = (value: number) => Math.round(value * 100) / 100

export function readSheet(wb: XLSX.WorkBook, name: string): Row[] | null {
  const found = wb.SheetNames.find((n) => n.toLowerCase() === name.toLowerCase())
  return found ? XLSX.utils.sheet_to_json<Row>(wb.Sheets[found], { defval: '' }) : null
}

/** True when rows carry the vInfo columns needed to size: VM, CPUs and Memory. */
export function looksLikeVInfo(rows: Row[] | null): boolean {
  return hasColumn(rows, 'VM') && hasColumn(rows, 'CPUs') && hasColumn(rows, 'Memory')
}

/** The vInfo rows: the vInfo tab, or a sheet (such as vInfo saved as CSV) with its columns. */
export function findVInfo(wb: XLSX.WorkBook): { rows: Row[]; fromTab: boolean } | null {
  const named = readSheet(wb, 'vInfo')
  if (named) return { rows: named, fromTab: true }
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheetName], { defval: '' })
    if (looksLikeVInfo(rows)) return { rows, fromTab: false }
  }
  return null
}

export function needsSizeReview(vCpu: number, ramGiB: number, storageGiB: number): boolean {
  return vCpu >= AUTO_CLASSIFY.heavyVCpu
    || ramGiB >= AUTO_CLASSIFY.heavyRamGiB
    || storageGiB >= AUTO_CLASSIFY.heavyStorageGiB
}

export function cpuVendorFromModel(model: string): CpuVendor {
  return /amd|epyc/i.test(model) ? 'amd' : /intel|xeon/i.test(model) ? 'intel' : 'unknown'
}

interface Identity {
  name: string
  uuid: string
  vmId: string
  vCenter: string
  datacenter: string
  cluster: string
}

function identity(row: Row): Identity {
  return {
    name: text(pick(row, 'VM')),
    uuid: text(pick(row, 'VM UUID')).toLowerCase(),
    vmId: text(pick(row, 'VM ID')),
    vCenter: text(pick(row, 'VI SDK Server')).toLowerCase(),
    datacenter: text(pick(row, 'Datacenter')),
    cluster: text(pick(row, 'Cluster')),
  }
}

const IDENTITY_FIELDS: Array<keyof Identity> = ['uuid', 'vmId', 'vCenter', 'datacenter', 'cluster']

/**
 * Finds the vInfo row a per-VM tab row belongs to: by VM UUID, then VM ID, then by name narrowed
 * by vCenter, datacenter and cluster. A row that still fits more than one VM is not attributed,
 * because guessing would double-count it.
 */
export class VmRowIndex {
  private byUuid = new Map<string, number[]>()
  private byVmId = new Map<string, number[]>()
  private byName = new Map<string, number[]>()

  constructor(private readonly rows: Identity[]) {
    rows.forEach((id, index) => {
      const add = (map: Map<string, number[]>, key: string) => { if (key) map.set(key, [...(map.get(key) ?? []), index]) }
      add(this.byUuid, id.uuid)
      add(this.byVmId, id.vmId)
      add(this.byName, id.name)
    })
  }

  private narrow(candidates: number[] | undefined, child: Identity): number[] {
    return (candidates ?? []).filter((index) => IDENTITY_FIELDS.every((field) => {
      const a = this.rows[index][field]
      const b = child[field]
      return !a || !b || a === b
    }))
  }

  resolve(row: Row): number | 'ambiguous' | null {
    const child = identity(row)
    if (child.uuid) {
      const found = this.narrow(this.byUuid.get(child.uuid), child)
      if (found.length === 1) return found[0]
    }
    if (child.vmId) {
      const found = this.narrow(this.byVmId.get(child.vmId), child)
      if (found.length === 1) return found[0]
    }
    if (!child.name) return null
    const found = this.narrow(this.byName.get(child.name), child)
    if (found.length === 1) return found[0]
    return found.length === 0 ? null : 'ambiguous'
  }
}

const ENCRYPTION_COLUMNS = ['Encrypted', 'Encryption', 'VM Encrypted', 'Encrypted VM']
const TPM_COLUMNS = ['TPM', 'vTPM', 'Virtual TPM', 'vTPM present']
const RDM_COLUMNS = ['Raw', 'Raw Comp. Mode', 'Raw Com. Mode', 'Disk type', 'Type']
const SHARING_COLUMNS = ['Sharing mode', 'Shared Bus']
const RDM_MODE_COLUMNS = ['Raw Comp. Mode', 'Raw Com. Mode']
const DISK_MODE_COLUMNS = ['Disk Mode', 'Mode']
/** "[datastore] folder/file.vmdk" gives "datastore". */
const datastoreOf = (path: string) => /^\s*\[([^\]]+)\]/.exec(path)?.[1]?.trim().toLowerCase() ?? ''

type StorageSource = keyof StorageSourceCounts

interface Draft {
  vm: Vm
  inUseGiB: number
  unsharedGiB: number | null
  source: StorageSource
}

/** Union-find over VM row indexes, used to group VMs that share a disk. */
function groupsOf(links: Array<Set<number>>): number[][] {
  const parent = new Map<number, number>()
  const find = (x: number): number => {
    const p = parent.get(x) ?? x
    if (p === x) return x
    const root = find(p)
    parent.set(x, root)
    return root
  }
  links.forEach((set) => {
    const [first, ...rest] = [...set]
    rest.forEach((other) => parent.set(find(other), find(first)))
    if (!parent.has(first)) parent.set(first, first)
  })
  const groups = new Map<number, number[]>()
  for (const member of parent.keys()) {
    const root = find(member)
    groups.set(root, [...(groups.get(root) ?? []), member])
  }
  return [...groups.values()].map((group) => group.sort((a, b) => a - b))
}

export function parseRvTools(data: ArrayBuffer): ImportReport {
  const wb = XLSX.read(data, { type: 'array' })
  return parseRvToolsWorkbook(wb)
}

export function parseRvToolsWorkbook(wb: XLSX.WorkBook): ImportReport {
  const warnings: string[] = []

  const found = findVInfo(wb)
  if (!found || found.rows.length === 0) {
    throw new Error(
      'No vInfo tab found. This does not look like an RVTools export. Expected tabs: vInfo, vCPU, vMemory, vPartition, vHost, or the vInfo tab saved as CSV.',
    )
  }
  const vInfo = found.rows
  const missing = ['VM', 'CPUs', 'Memory'].filter((column) => !hasColumn(vInfo, column))
  if (missing.length > 0) {
    throw new Error(`The vInfo data is missing the ${missing.join(', ')} column${missing.length === 1 ? '' : 's'}. Without them no VM can be sized, so nothing was imported.`)
  }
  if (!found.fromTab) {
    warnings.push('This file holds only the vInfo columns, such as vInfo saved as CSV. Consumed storage comes from vInfo In Use, and disks, partitions, snapshots, RDMs and shared disks could not be checked. Import the full RVTools workbook for those.')
  }

  const identities = vInfo.map(identity)
  const index = new VmRowIndex(identities)
  const unattributed: Record<string, number> = {}
  const attribute = (tab: string, rows: Row[] | null, onRow: (vmIndex: number, row: Row) => void) => {
    for (const row of rows ?? []) {
      if (!text(pick(row, 'VM')) && !text(pick(row, 'VM UUID')) && !text(pick(row, 'VM ID'))) continue
      const resolved = index.resolve(row)
      if (resolved === 'ambiguous') unattributed[tab] = (unattributed[tab] ?? 0) + 1
      else if (resolved !== null) onRow(resolved, row)
    }
  }

  // vPartition carries real in-guest consumption, which is what you actually want.
  const vPartition = found.fromTab ? readSheet(wb, 'vPartition') : null
  const consumedByVm = new Map<number, number>()
  attribute('vPartition', vPartition, (vmIndex, row) => {
    consumedByVm.set(vmIndex, (consumedByVm.get(vmIndex) ?? 0) + num(pick(row, 'Consumed MiB', 'Consumed MB')))
  })
  if (found.fromTab && !vPartition) {
    warnings.push('No vPartition tab — falling back to vInfo "In Use" for consumed storage. In-guest figures would be more accurate.')
  }

  const snapshotCountByVm = new Map<number, number>()
  attribute('vSnapshot', found.fromTab ? readSheet(wb, 'vSnapshot') : null, (vmIndex) => {
    snapshotCountByVm.set(vmIndex, (snapshotCountByVm.get(vmIndex) ?? 0) + 1)
  })

  const vDisk = found.fromTab ? readSheet(wb, 'vDisk') : null
  const vDatastore = found.fromTab ? readSheet(wb, 'vDatastore') : null
  const vsanDatastores = new Set((vDatastore ?? [])
    .filter((row) => /vsan/i.test(text(pick(row, 'Type'))))
    .map((row) => text(pick(row, 'Name')).toLowerCase())
    .filter(Boolean))
  const detection: ImportDetection = {
    rdm: hasColumn(vDisk, ...RDM_COLUMNS),
    sharedDisks: hasColumn(vDisk, ...SHARING_COLUMNS),
    rdmMode: hasColumn(vDisk, ...RDM_MODE_COLUMNS),
    diskMode: hasColumn(vDisk, ...DISK_MODE_COLUMNS),
    vsan: hasColumn(vDatastore, 'Type') && (hasColumn(vDisk, 'Path', 'Disk Path') || hasColumn(vInfo, 'Path')),
    encryption: hasColumn(vInfo, ...ENCRYPTION_COLUMNS),
    vtpm: hasColumn(vInfo, ...TPM_COLUMNS),
  }
  const rdmByVm = new Set<number>()
  const rdmPhysicalByVm = new Set<number>()
  const independentByVm = new Set<number>()
  const vsanByVm = new Set<number>()
  const sharedByVm = new Set<number>()
  const sharedDiskOwners = new Map<string, Set<number>>()
  const diskCountByVm = new Map<number, number>()
  attribute('vDisk', vDisk, (vmIndex, row) => {
    diskCountByVm.set(vmIndex, (diskCountByVm.get(vmIndex) ?? 0) + 1)
    const typeText = text(pick(row, 'Disk type', 'Type'))
    const rawValue = pick(row, 'Raw')
    const compatibility = text(pick(row, 'Raw Comp. Mode', 'Raw Com. Mode'))
    if (flag(rawValue) || /physical|virtual/i.test(compatibility) || /rdm|raw device/i.test(`${typeText} ${text(rawValue)}`)) rdmByVm.add(vmIndex)
    if (/physical/i.test(compatibility)) rdmPhysicalByVm.add(vmIndex)
    if (/independent/i.test(text(pick(row, ...DISK_MODE_COLUMNS)))) independentByVm.add(vmIndex)
    const store = datastoreOf(text(pickFilled(row, 'Path', 'Disk Path')))
    if (store && vsanDatastores.has(store)) vsanByVm.add(vmIndex)
    const sharing = text(pick(row, 'Sharing mode'))
    const bus = text(pick(row, 'Shared Bus'))
    if (/multi/i.test(sharing) || /physical|virtual/i.test(bus)) {
      sharedByVm.add(vmIndex)
      const disk = text(pickFilled(row, 'Disk Path', 'Disk UUID', 'Path'))
      if (disk) {
        const key = `${identities[vmIndex].vCenter}|${disk.toLowerCase()}`
        sharedDiskOwners.set(key, new Set([...(sharedDiskOwners.get(key) ?? []), vmIndex]))
      }
    }
  })

  // vHost, for the existing-hardware path. Kept per host.
  const vHost = found.fromTab ? readSheet(wb, 'vHost') : null
  const perHost: HostRecord[] = (vHost ?? []).map((h) => {
    const sockets = num(pick(h, '# CPU', '#CPU'))
    const coresPerSocket = num(pick(h, 'Cores per CPU'))
    const listedCores = num(pick(h, '# Cores', '#Cores'))
    const cpuModel = text(pick(h, 'CPU Model'))
    const vmCount = pick(h, '# VMs', '#VMs')
    return {
      name: text(pick(h, 'Host')),
      cluster: text(pick(h, 'Cluster')),
      datacenter: text(pick(h, 'Datacenter')),
      vCenter: text(pick(h, 'VI SDK Server')),
      sockets,
      coresPerSocket,
      totalCores: listedCores > 0 ? listedCores : sockets * coresPerSocket,
      ramGiB: r2(mibToGiB(num(pick(h, '# Memory', '#Memory')))),
      cpuModel,
      cpuVendor: cpuVendorFromModel(cpuModel),
      vmCount: filled(vmCount) ? num(vmCount) : undefined,
    }
  })
  const hostVendor = new Map<string, CpuVendor>()
  perHost.forEach((host) => {
    hostVendor.set(`${host.vCenter.toLowerCase()}|${host.name}`, host.cpuVendor)
    if (!hostVendor.has(host.name)) hostVendor.set(host.name, host.cpuVendor)
  })

  let excludedTemplates = 0
  let excludedSrmPlaceholders = 0
  let excludedVcls = 0
  let poweredOff = 0
  let suspended = 0
  let partitionBelowInUse = 0
  let missingSize = 0
  const drafts = new Map<number, Draft>()
  let seq = 0

  vInfo.forEach((row, rowIndex) => {
    const id = identities[rowIndex]
    const name = id.name
    if (!name) return

    if (flag(pick(row, 'Template'))) { excludedTemplates++; return }
    if (flag(pick(row, 'SRM Placeholder'))) { excludedSrmPlaceholders++; return }
    // vCLS agent VMs have no flag column — match on name. Auto-deployed since vSphere 7 U1.
    if (/^vcls/i.test(name)) { excludedVcls++; return }

    const powerRaw = String(pick(row, 'Powerstate', 'Power state') ?? 'poweredOn')
    const powerState: PowerState =
      /off/i.test(powerRaw) ? 'poweredOff' : /susp/i.test(powerRaw) ? 'suspended' : 'poweredOn'
    if (powerState === 'poweredOff') poweredOff++
    if (powerState === 'suspended') suspended++

    const vCpu = num(pick(row, 'CPUs'))
    const ramGiB = mibToGiB(num(pick(row, 'Memory')))
    const provisionedGiB = mibToGiB(num(pick(row, 'Provisioned MiB', 'Provisioned MB')))
    const inUseGiB = mibToGiB(num(pick(row, 'In Use MiB', 'In Use MB')))
    const unsharedRaw = pick(row, 'Unshared MiB', 'Unshared MB')
    const unsharedGiB = filled(unsharedRaw) ? mibToGiB(num(unsharedRaw)) : null
    const partitionGiB = consumedByVm.has(rowIndex) ? mibToGiB(consumedByVm.get(rowIndex)!) : 0

    // vPartition is used only when it plausibly represents the whole VM. A partition total more
    // than 50% below In Use usually means unmounted, raw or unreported volumes, so In Use stays.
    let storageGiB = 0
    let source: StorageSource = 'none'
    if (partitionGiB > 0 && (inUseGiB <= 0 || partitionGiB >= inUseGiB * 0.5)) {
      storageGiB = partitionGiB; source = 'partition'
    } else if (inUseGiB > 0) {
      storageGiB = inUseGiB; source = 'inUse'
      if (partitionGiB > 0) partitionBelowInUse++
    } else if (provisionedGiB > 0) {
      storageGiB = provisionedGiB; source = 'provisioned'
    }

    const guestOs = String(
      pickFilled(row, 'OS according to the VMware Tools', 'OS according to the configuration file', 'Guest OS') ?? '',
    ).trim()

    const sized = vCpu > 0 && ramGiB > 0
    if (!sized) missingSize++
    const tier = classify(name, guestOs)
    seq += 1
    const sourceHost = text(pick(row, 'Host'))
    const firmwareRaw = String(pick(row, 'Firmware') ?? '').toLowerCase()
    const vCenter = text(pick(row, 'VI SDK Server'))
    drafts.set(rowIndex, {
      inUseGiB,
      unsharedGiB,
      source,
      vm: {
        id: `rv-${seq}`,
        name,
        tier,
        vCpu,
        ramGiB: r2(ramGiB),
        storageGiB: r2(storageGiB),
        provisionedGiB: r2(provisionedGiB),
        powerState,
        // Powered-off VMs import but are excluded from sizing by default. Toggle per VM.
        include: powerState === 'poweredOn' && sized,
        guestOs,
        sourceCluster: id.cluster,
        sourceHost,
        sourceDatacenter: id.datacenter || undefined,
        sourceVCenter: vCenter || undefined,
        sourceVmUuid: id.uuid || undefined,
        sourceVmId: id.vmId || undefined,
        sourceCpuVendor: hostVendor.get(`${id.vCenter}|${sourceHost}`) ?? hostVendor.get(sourceHost) ?? 'unknown',
        firmware: /efi|uefi/.test(firmwareRaw) ? 'efi' : /bios/.test(firmwareRaw) ? 'bios' : 'unknown',
        diskCount: diskCountByVm.get(rowIndex) ?? (num(pick(row, 'Disks')) || undefined),
        nicCount: num(pick(row, 'NICs')) || undefined,
        snapshotCount: found.fromTab ? snapshotCountByVm.get(rowIndex) ?? 0 : undefined,
        hasRdm: detection.rdm ? rdmByVm.has(rowIndex) : undefined,
        rdmPhysical: detection.rdmMode ? rdmPhysicalByVm.has(rowIndex) : undefined,
        hasIndependentDisk: detection.diskMode ? independentByVm.has(rowIndex) : undefined,
        onVsan: detection.vsan ? vsanByVm.has(rowIndex) || vsanDatastores.has(datastoreOf(text(pick(row, 'Path')))) : undefined,
        hasSharedDisk: detection.sharedDisks ? sharedByVm.has(rowIndex) : undefined,
        encrypted: detection.encryption ? flag(pick(row, ...ENCRYPTION_COLUMNS)) : undefined,
        hasVtpm: detection.vtpm ? flag(pick(row, ...TPM_COLUMNS)) : undefined,
        autoClassified: tier !== 'general',
      },
    })
  })

  // Shared disks: In Use counts shared space on every VM that attaches the disk. When the same
  // disk path is shared by VMs in this file and each has In Use and Unshared MiB, the shared
  // space is counted once, on the first powered-on member. Otherwise the VMs are flagged only.
  const groups = groupsOf([...sharedDiskOwners.values()]
    .map((set) => new Set([...set].filter((member) => drafts.has(member))))
    .filter((set) => set.size >= 2))
  let dedupedGroups = 0
  let dedupedVms = 0
  let sharedCountedOnceGiB = 0
  let removedGiB = 0
  const dedupedMembers = new Set<number>()
  for (const group of groups) {
    const members = group.map((member) => drafts.get(member)!)
    if (!members.every((member) => member.inUseGiB > 0 && member.unsharedGiB !== null)) continue
    const own = members.map((member) => Math.min(member.unsharedGiB!, member.inUseGiB))
    const shared = members.map((member, i) => member.inUseGiB - own[i])
    const groupShared = Math.max(...shared)
    if (groupShared <= 0) continue
    const ownerIndex = Math.max(0, members.findIndex((member) => member.vm.powerState === 'poweredOn'))
    members.forEach((member, i) => {
      const before = member.vm.storageGiB
      const after = r2(i === ownerIndex ? own[i] + groupShared : own[i])
      member.vm.storageGiB = after
      member.source = 'sharedDeduped'
      if (i !== ownerIndex && before > after) {
        member.vm.sharedStorageDedupedGiB = r2(before - after)
        removedGiB += before - after
      }
      dedupedMembers.add(group[i])
    })
    dedupedGroups += 1
    dedupedVms += members.length
    sharedCountedOnceGiB += groupShared
  }
  const flagOnly = [...sharedByVm].filter((member) => drafts.has(member) && !dedupedMembers.has(member)).length

  const vms = [...drafts.values()].map(({ vm }) => ({
    ...vm,
    sizeReview: vm.tier === 'general' && needsSizeReview(vm.vCpu, vm.ramGiB, vm.storageGiB),
  }))
  const storageSources: StorageSourceCounts = { partition: 0, inUse: 0, provisioned: 0, none: 0, sharedDeduped: 0 }
  drafts.forEach((draft) => { storageSources[draft.source] += 1 })

  if (vInfo.length > 20000) {
    warnings.push(`${vInfo.length} rows. Some import tools cap RVTools files at 20,000 VM rows.`)
  }
  if (missingSize > 0) {
    warnings.push(`${missingSize} VM(s) have no vCPU or memory value, so they are excluded from sizing. Correct them in the inventory and tick Include.`)
  }
  if (storageSources.none > 0) {
    warnings.push(`${storageSources.none} VM(s) have no consumed or provisioned storage value and count as 0 GiB.`)
  }
  if (partitionBelowInUse > 0) {
    warnings.push(`${partitionBelowInUse} VM(s) report vPartition totals more than 50% below vInfo In Use. In Use was kept for them, because the partitions do not plausibly cover the whole VM.`)
  }
  if (dedupedGroups > 0) {
    warnings.push(`${dedupedVms} VMs share disks in ${dedupedGroups} group(s) (vDisk Sharing mode). In Use counts shared space on every VM, so ${r2(sharedCountedOnceGiB).toLocaleString()} GiB of shared space is counted once, on the first powered-on VM of each group, and ${r2(removedGiB).toLocaleString()} GiB of double counting was removed. Check these VMs in the inventory.`)
  }
  if (flagOnly > 0) {
    warnings.push(`${flagOnly} VM(s) have shared disks (vDisk Sharing mode), but the file does not show enough to count the shared space once: that needs the same Disk Path on each VM plus In Use and Unshared MiB. Their storage is not adjusted and may be counted more than once. They are flagged for review.`)
  }
  if (!detection.sharedDisks && hasColumn(vInfo, 'Unshared MiB', 'Unshared MB')) {
    const possible = [...drafts.values()].filter((draft) => draft.unsharedGiB !== null && draft.inUseGiB - draft.unsharedGiB > Math.max(1, draft.inUseGiB * 0.1)).length
    if (possible > 0) warnings.push(`${possible} VM(s) have In Use well above Unshared MiB, which can mean shared disks or linked clones. Without the vDisk Sharing mode column this cannot be confirmed, so their storage is not adjusted.`)
  }
  const unattributedText = Object.entries(unattributed).map(([tab, count]) => `${count} ${tab} row(s)`)
  const nameCounts = new Map<string, number>()
  vms.forEach((vm) => nameCounts.set(vm.name, (nameCounts.get(vm.name) ?? 0) + 1))
  const duplicateNames = [...nameCounts.values()].filter((count) => count > 1)
  if (duplicateNames.length > 0) {
    warnings.push(`${duplicateNames.length} VM name(s) appear more than once (${duplicateNames.reduce((a, b) => a + b, 0)} VMs). They are kept as separate VMs, and per-VM tabs were matched by VM UUID or VM ID, or by name with datacenter and cluster.${unattributedText.length ? ` ${unattributedText.join(', ')} could not be tied to one VM and were not counted, so those VMs use In Use and may lack disk or snapshot detail.` : ''}`)
  } else if (unattributedText.length > 0) {
    warnings.push(`${unattributedText.join(', ')} could not be tied to one VM and were not counted.`)
  }
  if (poweredOff + suspended > 0) {
    warnings.push(`${poweredOff} powered-off and ${suspended} suspended VM(s) are in the inventory but EXCLUDED from sizing by default. Choose below whether they should count.`)
  }
  const autoCount = vms.filter(v => v.autoClassified).length
  if (autoCount > 0) {
    warnings.push(`${autoCount} VM(s) were auto-classified out of General Server from their name or guest OS. Review the tier column — auto-classification is a starting point, not an answer.`)
  }
  const sizeReviewCount = vms.filter(v => v.sizeReview).length
  if (sizeReviewCount > 0) {
    warnings.push(`${sizeReviewCount} large VM(s) stayed in General Server and are flagged for review. Move any real database servers to the Database tier, because that changes the CPU ratio from 4:1 to 1:1.`)
  }
  const unchecked = [
    !detection.rdm && 'RDMs (no vDisk Raw or Raw Comp. Mode column)',
    !detection.sharedDisks && 'shared disks (no vDisk Sharing mode column)',
    !detection.encryption && 'VM encryption (no Encrypted column)',
    !detection.vtpm && 'vTPM (no TPM column)',
    !detection.diskMode && 'independent disks (no vDisk Disk Mode column)',
    !detection.vsan && 'vSAN placement (no vDatastore Type column)',
  ].filter(Boolean)
  if (unchecked.length > 0) {
    warnings.push(`This file could not show ${unchecked.join(', ')}. Readiness cannot report these, which does not mean there are none. Check them in vCenter.`)
  }
  warnings.push('RVTools carries NO utilisation history. This import sizes on ALLOCATION, which typically oversizes. Adjust the per-tier Right-Sizing Factor, or bring a Live Optics / Aria Operations export for measured data.')

  let hostSummary: HostSummary | null = null
  if (perHost.length > 0) {
    hostSummary = {
      hosts: perHost.length,
      totalPhysicalCores: perHost.reduce((sum, host) => sum + host.totalCores, 0),
      totalRamGiB: Math.round(perHost.reduce((sum, host) => sum + host.ramGiB, 0)),
      clusters: [...new Set(perHost.map((host) => host.cluster).filter(Boolean))],
      cpuModels: [...new Set(perHost.map((host) => host.cpuModel).filter(Boolean))],
      perHost,
    }
  }

  return {
    format: found.fromTab ? 'rvtools' : 'rvtools-vinfo-csv',
    vms,
    totalRows: vInfo.length,
    excludedTemplates,
    excludedSrmPlaceholders,
    excludedVcls,
    poweredOff,
    suspended,
    usedPartitionData: storageSources.partition > 0,
    storageSources,
    detection,
    warnings,
    hostSummary,
  }
}

/** Plain-language source of consumed storage, for the import banner. */
export function describeStorageSources(summary: Pick<ImportSummary, 'storageSources' | 'usedPartitionData' | 'format'>): string {
  const s = summary.storageSources
  if (!s) return summary.usedPartitionData ? 'Consumed storage taken from vPartition where available, otherwise vInfo In Use.' : 'Consumed storage taken from vInfo In Use.'
  const used = summary.format === 'inventory-template' ? 'the Used GiB column' : 'vInfo In Use'
  const parts = [
    s.partition > 0 && `${s.partition.toLocaleString()} from vPartition (in-guest)`,
    s.inUse > 0 && `${s.inUse.toLocaleString()} from ${used}`,
    s.sharedDeduped > 0 && `${s.sharedDeduped.toLocaleString()} from In Use with shared disks counted once`,
    s.provisioned > 0 && `${s.provisioned.toLocaleString()} from provisioned size (no consumed figure)`,
    s.none > 0 && `${s.none.toLocaleString()} with no storage value`,
  ].filter(Boolean)
  return parts.length ? `Consumed storage: ${parts.join(' · ')}.` : 'No VMs imported.'
}
