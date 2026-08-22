import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { mergePerformanceData, parsePerformanceData } from './performance'
import { newVm } from '../state/defaults'

describe('performance import', () => {
  it('reads the documented template columns and matches VM names case-insensitively', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['VM Name', 'CPU P95 %', 'Memory P95 %', 'IOPS P95', 'Throughput MBps P95', 'Observation Days', 'Source'],
      ['app01', 25, 60, 1200, 150, 30, 'Live Optics'],
    ]), 'Performance')
    const records = parsePerformanceData(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
    const merged = mergePerformanceData([newVm({ name: 'APP01' })], records)
    expect(merged.matched).toBe(1)
    expect(merged.vms[0].performance).toMatchObject({ cpuP95Pct: 25, memoryP95Pct: 60, source: 'live-optics' })
  })
})
