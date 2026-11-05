import * as XLSX from 'xlsx'
import type { PerformanceSource, Vm, VmPerformanceMetrics } from '../engine/types'

export interface PerformanceImportRecord {
  vmName: string
  vmUuid?: string
  cluster?: string
  metrics: VmPerformanceMetrics
}

export interface PerformanceFileRead {
  records: PerformanceImportRecord[]
  sheetName: string
  /** Header names in the file that Surveyor understood. */
  recognizedColumns: string[]
  /** Rows with a VM name but no metric value. */
  emptyRows: number
  warnings: string[]
}

export interface PerformanceMergeReport {
  vms: Vm[]
  rows: number
  /** Inventory VMs that received at least one value. */
  matched: number
  /** Every file name that matched no inventory VM. */
  unmatchedNames: string[]
  /** File names that appeared on more than one row; their values were merged field by field. */
  duplicateNames: string[]
  /** File names that fit more than one inventory VM, so nothing was attached. */
  ambiguousNames: string[]
}

export interface PerformanceAttachResult extends PerformanceMergeReport {
  recognizedColumns: string[]
  sheetName: string
  emptyRows: number
  warnings: string[]
}

function normalized(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

const COLUMNS = {
  vm: ['VM', 'VM Name', 'Name', 'Virtual Machine', 'VirtualMachineName'],
  uuid: ['VM UUID', 'UUID', 'Instance UUID'],
  cluster: ['Cluster'],
  cpu: ['CPU P95 %', 'CPU P95', '95th Percentile CPU %', 'CPU Utilization P95'],
  memory: ['Memory P95 %', 'Memory P95', 'RAM P95 %', '95th Percentile Memory %', 'Memory Utilization P95'],
  iops: ['IOPS P95', 'Storage IOPS P95', 'Disk IOPS P95'],
  throughput: ['Throughput MBps P95', 'Storage MBps P95', 'Disk Throughput MB/s P95'],
  latency: ['Latency ms P95', 'Storage Latency P95', 'Disk Latency ms P95'],
  network: ['Network Mbps P95', 'Network P95 Mbps', 'Network Throughput Mbps P95'],
  days: ['Observation Days', 'History Days', 'Duration Days'],
  source: ['Source', 'Data Source', 'Tool'],
}
const METRIC_KEYS = ['cpu', 'memory', 'iops', 'throughput', 'latency', 'network'] as const

function findKey(keys: string[], names: string[]): string | undefined {
  const wanted = new Set(names.map(normalized))
  return keys.find((candidate) => wanted.has(normalized(candidate)))
}

function optionalNumber(value: unknown, min = 0, max = Number.POSITIVE_INFINITY): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const number = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(/[,% ]/g, ''))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : undefined
}

export interface PercentCell {
  value: number
  /** The value carried a % sign or a percent cell format, so it is already in percent. */
  explicit: boolean
}

export function percentCell(raw: unknown): PercentCell | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, explicit: false } : undefined
  const text = String(raw).trim()
  const value = Number.parseFloat(text.replace(/[,% ]/g, ''))
  if (!Number.isFinite(value)) return undefined
  return { value, explicit: text.includes('%') }
}

/**
 * The percent rule, applied to one column:
 *  - "45%" is 45. A percent-formatted Excel cell holding 0.45 is also 45 (its format is read).
 *  - A plain number is a percent, so 45 is 45 and 0.45 is 0.45%.
 *  - Except: when every value in the column is at or below 1 and at least one is above 0, the
 *    column is read as fractions, so 0.45 is 45, and the caller warns about it.
 * Results are clamped to 0-100.
 */
export function resolvePercentColumn(cells: Array<PercentCell | undefined>): { values: Array<number | undefined>; fraction: boolean } {
  const present = cells.filter((cell): cell is PercentCell => !!cell)
  const fraction = present.some((cell) => !cell.explicit)
    && present.every((cell) => cell.value <= 1)
    && present.some((cell) => cell.value > 0)
  return {
    fraction,
    values: cells.map((cell) => {
      if (!cell) return undefined
      const value = fraction && !cell.explicit ? cell.value * 100 : cell.value
      return Math.min(100, Math.max(0, Math.round(value * 1e6) / 1e6))
    }),
  }
}

function sourceFrom(value: unknown): PerformanceSource | undefined {
  const text = normalized(value)
  if (text === '') return undefined
  if (text.includes('liveoptics')) return 'live-optics'
  if (text.includes('aria') || text.includes('vrops')) return 'aria-operations'
  if (text.includes('azuremigrate')) return 'azure-migrate'
  if (text.includes('scom') || text.includes('operationsmanager')) return 'scom'
  if (text.includes('manual')) return 'manual'
  return 'other'
}

/** Percent-formatted number cells become "45%" text, so the percent rule can see the format. */
function markPercentCells(sheet: XLSX.WorkSheet) {
  for (const address of Object.keys(sheet)) {
    if (address.startsWith('!')) continue
    const cell = sheet[address] as XLSX.CellObject
    if (cell?.t === 'n' && typeof cell.v === 'number' && /%/.test(`${cell.z ?? ''}${cell.w ?? ''}`)) {
      const percent = Math.round(cell.v * 100 * 1e6) / 1e6
      sheet[address] = { t: 's', v: `${percent}%`, w: `${percent}%` }
    }
  }
}

function rowsOf(workbook: XLSX.WorkBook, sheetName: string) {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '' })
}

export function readPerformanceFile(data: ArrayBuffer): PerformanceFileRead {
  const workbook = XLSX.read(data, { type: 'array', cellNF: true })
  if (workbook.SheetNames.length === 0) throw new Error('The performance file contains no readable worksheet or CSV rows.')
  // Read the sheet that has the VM column, preferring one that also has metric columns.
  const candidates = workbook.SheetNames.map((sheetName) => {
    const rows = rowsOf(workbook, sheetName)
    const keys = rows.length ? Object.keys(rows[0]) : []
    const metrics = METRIC_KEYS.filter((key) => findKey(keys, COLUMNS[key])).length
    return { sheetName, keys, hasVm: !!findKey(keys, COLUMNS.vm), metrics }
  })
  const chosen = candidates.find((c) => c.hasVm && c.metrics > 0) ?? candidates.find((c) => c.hasVm)
  if (!chosen) {
    throw new Error('No VM-name column was found on any sheet. Use VM, VM Name, Name, or Virtual Machine as the identifier column.')
  }
  const column = Object.fromEntries(Object.entries(COLUMNS).map(([key, names]) => [key, findKey(chosen.keys, names)])) as Record<keyof typeof COLUMNS, string | undefined>
  const recognizedColumns = Object.values(column).filter((key): key is string => !!key)
  if (chosen.metrics === 0) {
    throw new Error(`Sheet "${chosen.sheetName}" has a VM column but no recognised metric column, so nothing was attached. Use the performance template headers, such as CPU P95 %, Memory P95 %, IOPS P95, Throughput MBps P95.`)
  }
  markPercentCells(workbook.Sheets[chosen.sheetName])
  const rows = rowsOf(workbook, chosen.sheetName).filter((row) => String(row[column.vm!] ?? '').trim())
  const warnings: string[] = []
  const percent = (key: 'cpu' | 'memory', label: string) => {
    const resolved = resolvePercentColumn(rows.map((row) => column[key] ? percentCell(row[column[key]!]) : undefined))
    if (resolved.fraction) warnings.push(`Every ${label} value is at or below 1, so the column was read as fractions (0.45 means 45%). If the values really are below 1%, add a % sign to them.`)
    return resolved.values
  }
  const cpu = percent('cpu', 'CPU P95')
  const memory = percent('memory', 'memory P95')
  let emptyRows = 0
  const records: PerformanceImportRecord[] = []
  rows.forEach((row, index) => {
    const value = (key: keyof typeof COLUMNS) => column[key] ? row[column[key]!] : undefined
    const metrics: VmPerformanceMetrics = {
      cpuP95Pct: cpu[index],
      memoryP95Pct: memory[index],
      storageIopsP95: optionalNumber(value('iops')),
      storageThroughputMBpsP95: optionalNumber(value('throughput')),
      storageLatencyMsP95: optionalNumber(value('latency')),
      networkMbpsP95: optionalNumber(value('network')),
      observationDays: optionalNumber(value('days')),
      source: sourceFrom(value('source')),
    }
    const hasMetric = [metrics.cpuP95Pct, metrics.memoryP95Pct, metrics.storageIopsP95, metrics.storageThroughputMBpsP95, metrics.storageLatencyMsP95, metrics.networkMbpsP95].some((item) => item !== undefined)
    if (!hasMetric) { emptyRows++; return }
    records.push({
      vmName: String(value('vm')).trim(),
      vmUuid: String(value('uuid') ?? '').trim().toLowerCase() || undefined,
      cluster: String(value('cluster') ?? '').trim() || undefined,
      metrics,
    })
  })
  if (emptyRows > 0) warnings.push(`${emptyRows} row(s) have a VM name but no metric value and were skipped.`)
  return { records, sheetName: chosen.sheetName, recognizedColumns, emptyRows, warnings }
}

/** The records only. Kept for callers that do not need the column report. */
export function parsePerformanceData(data: ArrayBuffer): PerformanceImportRecord[] {
  const read = readPerformanceFile(data)
  if (read.records.length === 0) throw new Error('The performance file has no rows with both a VM name and a metric value.')
  return read.records
}

/** Copies only the values that are present. An absent value never erases an existing one. */
export function mergeDefined<T extends object>(base: T | undefined, incoming: Partial<T>): T {
  const result = { ...(base ?? {}) } as T
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined) (result as Record<string, unknown>)[key] = value
  }
  return result
}

interface Group {
  name: string
  uuid?: string
  cluster?: string
  metrics: VmPerformanceMetrics
  rows: number
}

const shortName = (name: string) => name.trim().toLowerCase().split('.')[0]

/**
 * Attaches measurements by VM. Order of trust: VM UUID, exact name, case-insensitive name, short
 * name (an FQDN matches its host name), then a punctuation-insensitive name. Each step is used only
 * when it points at exactly one VM, and a VM already claimed by a stronger match is not given a
 * second row's values.
 */
export function mergePerformanceData(vms: Vm[], records: PerformanceImportRecord[]): PerformanceMergeReport {
  const groups = new Map<string, Group>()
  records.forEach((record) => {
    const key = record.vmUuid ? `u:${record.vmUuid}` : `n:${record.vmName.trim()}|${(record.cluster ?? '').toLowerCase()}`
    const existing = groups.get(key)
    if (existing) {
      existing.metrics = mergeDefined(existing.metrics, record.metrics)
      existing.rows += 1
    } else {
      groups.set(key, { name: record.vmName.trim(), uuid: record.vmUuid, cluster: record.cluster, metrics: { ...record.metrics }, rows: 1 })
    }
  })

  const index = (keyOf: (vm: Vm) => string) => {
    const map = new Map<string, number[]>()
    vms.forEach((vm, i) => { const key = keyOf(vm); if (key) map.set(key, [...(map.get(key) ?? []), i]) })
    return map
  }
  const steps: Array<{ map: Map<string, number[]>; key: (group: Group) => string }> = [
    { map: index((vm) => (vm.sourceVmUuid ?? '').toLowerCase()), key: (group) => group.uuid ?? '' },
    { map: index((vm) => vm.name.trim()), key: (group) => group.name },
    { map: index((vm) => vm.name.trim().toLowerCase()), key: (group) => group.name.toLowerCase() },
    { map: index((vm) => shortName(vm.name)), key: (group) => shortName(group.name) },
    { map: index((vm) => normalized(vm.name)), key: (group) => normalized(group.name) },
  ]

  const unmatched: string[] = []
  const ambiguous: string[] = []
  const resolved: Array<{ group: Group; step: number; target: number }> = []
  for (const group of groups.values()) {
    let outcome: { step: number; target: number } | 'ambiguous' | null = null
    for (let step = 0; step < steps.length && outcome === null; step++) {
      const key = steps[step].key(group)
      if (!key) continue
      const cluster = group.cluster?.toLowerCase()
      const candidates = (steps[step].map.get(key) ?? []).filter((i) => !cluster || !vms[i].sourceCluster || vms[i].sourceCluster!.toLowerCase() === cluster)
      if (candidates.length === 1) outcome = { step, target: candidates[0] }
      else if (candidates.length > 1) outcome = 'ambiguous'
    }
    if (outcome === 'ambiguous') ambiguous.push(group.name)
    else if (outcome === null) unmatched.push(group.name)
    else resolved.push({ group, ...outcome })
  }

  const assigned = new Map<number, VmPerformanceMetrics>()
  resolved.sort((a, b) => a.step - b.step).forEach(({ group, step, target }) => {
    if (assigned.has(target)) {
      // Two rows reached the same VM. The same name merges; a weaker match is not attached.
      if (step <= 1 && steps[step].key(group) === vms[target].name.trim()) assigned.set(target, mergeDefined(assigned.get(target), group.metrics))
      else unmatched.push(group.name)
      return
    }
    assigned.set(target, group.metrics)
  })

  const vmsWithMetrics = vms.map((vm, i) => {
    const metrics = assigned.get(i)
    if (!metrics) return vm
    const performance = mergeDefined(vm.performance, metrics)
    return { ...vm, performance: { ...performance, source: performance.source ?? 'manual' } }
  })
  return {
    vms: vmsWithMetrics,
    rows: records.length,
    matched: assigned.size,
    unmatchedNames: unmatched,
    duplicateNames: [...groups.values()].filter((group) => group.rows > 1).map((group) => group.name),
    ambiguousNames: ambiguous,
  }
}

/**
 * Reads a performance file and merges it into the inventory as it is when the read finishes, so
 * edits made while the file was loading are not overwritten with an older copy.
 */
export async function attachPerformanceFile(file: { arrayBuffer(): Promise<ArrayBuffer> }, currentVms: () => Vm[]): Promise<PerformanceAttachResult> {
  const read = readPerformanceFile(await file.arrayBuffer())
  const merged = mergePerformanceData(currentVms(), read.records)
  return { ...merged, recognizedColumns: read.recognizedColumns, sheetName: read.sheetName, emptyRows: read.emptyRows, warnings: read.warnings }
}

export function downloadPerformanceTemplate(vms: Vm[]) {
  const headers = ['VM Name', 'CPU P95 %', 'Memory P95 %', 'IOPS P95', 'Throughput MBps P95', 'Latency ms P95', 'Network Mbps P95', 'Observation Days', 'Source']
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
  const rows = vms.map((vm) => [vm.name, '', '', '', '', '', '', '', ''].map(quote).join(','))
  const blob = new Blob([[headers.map(quote).join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'hyperv-surveyor-performance-template.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}
