import * as XLSX from 'xlsx'
import type { PerformanceSource, Vm, VmPerformanceMetrics } from '../engine/types'

export interface PerformanceImportRecord {
  vmName: string
  metrics: VmPerformanceMetrics
}

export interface PerformanceMergeReport {
  vms: Vm[]
  rows: number
  matched: number
  unmatchedNames: string[]
  duplicateNames: string[]
}

function normalized(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function pick(row: Record<string, unknown>, ...names: string[]) {
  const wanted = new Set(names.map(normalized))
  const key = Object.keys(row).find((candidate) => wanted.has(normalized(candidate)))
  return key ? row[key] : undefined
}

function optionalNumber(value: unknown, min = 0, max = Number.POSITIVE_INFINITY): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const number = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(/[,% ]/g, ''))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : undefined
}

function source(value: unknown): PerformanceSource {
  const text = normalized(value)
  if (text.includes('liveoptics')) return 'live-optics'
  if (text.includes('aria') || text.includes('vrops')) return 'aria-operations'
  if (text.includes('azuremigrate')) return 'azure-migrate'
  if (text.includes('scom') || text.includes('operationsmanager')) return 'scom'
  if (text === '' || text.includes('manual')) return 'manual'
  return 'other'
}

export function parsePerformanceData(data: ArrayBuffer): PerformanceImportRecord[] {
  const workbook = XLSX.read(data, { type: 'array' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!firstSheet) throw new Error('The performance file contains no readable worksheet or CSV rows.')
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' })
  const records = rows.flatMap((row): PerformanceImportRecord[] => {
    const vmName = String(pick(row, 'VM', 'VM Name', 'Name', 'Virtual Machine', 'VirtualMachineName') ?? '').trim()
    if (!vmName) return []
    return [{
      vmName,
      metrics: {
        cpuP95Pct: optionalNumber(pick(row, 'CPU P95 %', 'CPU P95', '95th Percentile CPU %', 'CPU Utilization P95'), 0, 100),
        memoryP95Pct: optionalNumber(pick(row, 'Memory P95 %', 'Memory P95', 'RAM P95 %', '95th Percentile Memory %', 'Memory Utilization P95'), 0, 100),
        storageIopsP95: optionalNumber(pick(row, 'IOPS P95', 'Storage IOPS P95', 'Disk IOPS P95')),
        storageThroughputMBpsP95: optionalNumber(pick(row, 'Throughput MBps P95', 'Storage MBps P95', 'Disk Throughput MB/s P95')),
        storageLatencyMsP95: optionalNumber(pick(row, 'Latency ms P95', 'Storage Latency P95', 'Disk Latency ms P95')),
        networkMbpsP95: optionalNumber(pick(row, 'Network Mbps P95', 'Network P95 Mbps', 'Network Throughput Mbps P95')),
        observationDays: optionalNumber(pick(row, 'Observation Days', 'History Days', 'Duration Days')),
        source: source(pick(row, 'Source', 'Data Source', 'Tool')),
      },
    }]
  })
  if (records.length === 0) {
    throw new Error('No VM-name column was found. Use VM, VM Name, Name, or Virtual Machine as the first identifier column.')
  }
  return records
}

export function mergePerformanceData(vms: Vm[], records: PerformanceImportRecord[]): PerformanceMergeReport {
  const byName = new Map<string, VmPerformanceMetrics>()
  const duplicates = new Set<string>()
  records.forEach((record) => {
    const key = normalized(record.vmName)
    if (byName.has(key)) duplicates.add(record.vmName)
    byName.set(key, { ...byName.get(key), ...record.metrics })
  })
  let matched = 0
  const vmsWithMetrics = vms.map((vm) => {
    const metrics = byName.get(normalized(vm.name))
    if (!metrics) return vm
    matched += 1
    byName.delete(normalized(vm.name))
    return { ...vm, performance: { ...vm.performance, ...metrics } }
  })
  return {
    vms: vmsWithMetrics,
    rows: records.length,
    matched,
    unmatchedNames: [...byName.keys()].slice(0, 25),
    duplicateNames: [...duplicates].slice(0, 25),
  }
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
