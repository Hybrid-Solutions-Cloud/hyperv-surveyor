import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { attachPerformanceFile, mergePerformanceData, parsePerformanceData, percentCell, readPerformanceFile, resolvePercentColumn } from './performance'
import { newVm } from '../state/defaults'

const xlsx = (rows: unknown[][], sheet = 'Performance', extra?: (wb: XLSX.WorkBook) => void) => {
  const workbook = XLSX.utils.book_new()
  extra?.(workbook)
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheet)
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
}
const csv = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer

describe('performance import', () => {
  it('reads the documented template columns and matches VM names case-insensitively', () => {
    const records = parsePerformanceData(xlsx([
      ['VM Name', 'CPU P95 %', 'Memory P95 %', 'IOPS P95', 'Throughput MBps P95', 'Observation Days', 'Source'],
      ['app01', 25, 60, 1200, 150, 30, 'Live Optics'],
    ]))
    const merged = mergePerformanceData([newVm({ name: 'APP01' })], records)
    expect(merged.matched).toBe(1)
    expect(merged.vms[0].performance).toMatchObject({ cpuP95Pct: 25, memoryP95Pct: 60, source: 'live-optics' })
  })
})

describe('B3 percent rule', () => {
  it('reads "45%" text as 45 and a plain number as a percent', () => {
    expect(resolvePercentColumn([percentCell('45%'), percentCell(30), percentCell('0.45')]).values).toEqual([45, 30, 0.45])
  })

  it('reads a column of fractions at or below 1 as fractions, and says so', () => {
    const resolved = resolvePercentColumn([percentCell(0.45), percentCell(0.9), percentCell(undefined)])
    expect(resolved).toEqual({ fraction: true, values: [45, 90, undefined] })
  })

  it('keeps an explicit "0.5%" as half a percent', () => {
    expect(resolvePercentColumn([percentCell('0.5%'), percentCell('0.2%')]).values).toEqual([0.5, 0.2])
  })

  it('reads 45% in a CSV file as 45', () => {
    const read = readPerformanceFile(csv('VM,CPU P95 %,Memory P95 %\r\napp1,45%,60%\r\napp2,10%,5%'))
    expect(read.records.map((record) => [record.metrics.cpuP95Pct, record.metrics.memoryP95Pct])).toEqual([[45, 60], [10, 5]])
    expect(read.warnings).toEqual([])
  })

  it('reads a percent-formatted Excel cell holding 0.45 as 45', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['VM', 'CPU P95 %'], ['app1', 0.45], ['app2', 0.07]])
    sheet.B2.z = '0%'
    sheet.B3.z = '0.0%'
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Perf')
    const read = readPerformanceFile(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
    expect(read.records.map((record) => record.metrics.cpuP95Pct)).toEqual([45, 7])
  })

  it('warns when a plain column is read as fractions', () => {
    const read = readPerformanceFile(xlsx([['VM', 'CPU P95 %'], ['app1', 0.45], ['app2', 0.3]]))
    expect(read.records.map((record) => record.metrics.cpuP95Pct)).toEqual([45, 30])
    expect(read.warnings.some((warning) => /read as fractions/.test(warning))).toBe(true)
  })
})

describe('B4 field-by-field merge', () => {
  it('an IOPS-only file keeps CPU and memory P95 and the source', () => {
    const vm = newVm({ name: 'app1', performance: { cpuP95Pct: 40, memoryP95Pct: 70, source: 'live-optics' } })
    const merged = mergePerformanceData([vm], parsePerformanceData(xlsx([['VM', 'IOPS P95'], ['app1', 900]])))
    expect(merged.vms[0].performance).toEqual({ cpuP95Pct: 40, memoryP95Pct: 70, source: 'live-optics', storageIopsP95: 900 })
  })

  it('combines duplicate rows field by field instead of the last row wiping the first', () => {
    const merged = mergePerformanceData([newVm({ name: 'app1' })], parsePerformanceData(xlsx([['VM', 'CPU P95 %', 'IOPS P95'], ['app1', 30, ''], ['app1', '', 500]])))
    expect(merged.vms[0].performance).toMatchObject({ cpuP95Pct: 30, storageIopsP95: 500 })
    expect(merged.duplicateNames).toEqual(['app1'])
  })
})

describe('B13 matching and reporting', () => {
  it('prefers the exact name and does not put web_01 metrics on web-01', () => {
    const vms = [newVm({ name: 'web-01' }), newVm({ name: 'web_01' })]
    const merged = mergePerformanceData(vms, parsePerformanceData(xlsx([['VM', 'CPU P95 %'], ['web_01', 50]])))
    expect(merged.vms.map((vm) => vm.performance?.cpuP95Pct)).toEqual([undefined, 50])
  })

  it('uses a normalised name only when it is unambiguous', () => {
    const one = mergePerformanceData([newVm({ name: 'web-01' })], parsePerformanceData(xlsx([['VM', 'CPU P95 %'], ['WEB 01', 50]])))
    expect(one.matched).toBe(1)
    const two = mergePerformanceData([newVm({ name: 'web-01' }), newVm({ name: 'web.01x' }), newVm({ name: 'web01' })], parsePerformanceData(xlsx([['VM', 'CPU P95 %'], ['WEB 01', 50]])))
    expect(two.matched).toBe(0)
    expect(two.ambiguousNames).toEqual(['WEB 01'])
  })

  it('matches an FQDN to its short VM name', () => {
    const merged = mergePerformanceData([newVm({ name: 'APP01' })], parsePerformanceData(xlsx([['VM', 'CPU P95 %'], ['app01.corp.example', 20]])))
    expect(merged.matched).toBe(1)
  })

  it('does not give duplicate inventory names a guessed value, and tells them apart by cluster', () => {
    const vms = [newVm({ name: 'db1', sourceCluster: 'C1' }), newVm({ name: 'db1', sourceCluster: 'C2' })]
    const guessed = mergePerformanceData(vms, parsePerformanceData(xlsx([['VM', 'CPU P95 %'], ['db1', 20]])))
    expect(guessed.matched).toBe(0)
    expect(guessed.ambiguousNames).toEqual(['db1'])
    const byCluster = mergePerformanceData(vms, parsePerformanceData(xlsx([['VM', 'Cluster', 'CPU P95 %'], ['db1', 'C1', 20], ['db1', 'C2', 30]])))
    expect(byCluster.vms.map((vm) => vm.performance?.cpuP95Pct)).toEqual([20, 30])
  })

  it('reports every unmatched name, not only the first 25', () => {
    const rows = [['VM', 'CPU P95 %'], ...Array.from({ length: 40 }, (_, i) => [`ghost${i}`, 10])]
    expect(mergePerformanceData([newVm({ name: 'app' })], parsePerformanceData(xlsx(rows))).unmatchedNames).toHaveLength(40)
  })

  it('reports the recognised columns and rejects a file with no metric column', () => {
    expect(readPerformanceFile(xlsx([['VM', 'CPU P95 %', 'Owner'], ['a', 1]])).recognizedColumns).toEqual(['VM', 'CPU P95 %'])
    expect(() => readPerformanceFile(xlsx([['VM', 'Owner'], ['a', 'x']]))).toThrow(/no recognised metric column/)
  })

  it('reads the sheet that has the VM column, not only the first sheet', () => {
    const data = xlsx([['VM', 'CPU P95 %'], ['app1', 33]], 'Data', (wb) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Report title'], ['Generated today']]), 'Summary'))
    const read = readPerformanceFile(data)
    expect(read.sheetName).toBe('Data')
    expect(read.records[0].metrics.cpuP95Pct).toBe(33)
  })

  it('does not count blank template rows as attached', () => {
    const read = readPerformanceFile(xlsx([['VM Name', 'CPU P95 %', 'Memory P95 %'], ['app1', '', ''], ['app2', 10, '']]))
    expect(read.records.map((record) => record.vmName)).toEqual(['app2'])
    expect(read.emptyRows).toBe(1)
  })
})

describe('B17 performance read does not overwrite newer edits', () => {
  it('merges into the inventory as it is when the file finishes loading', async () => {
    let current = [newVm({ name: 'app1', vCpu: 4 })]
    const file = { arrayBuffer: async () => { current = [{ ...current[0], vCpu: 16 }]; return xlsx([['VM', 'CPU P95 %'], ['app1', 20]]) } }
    const result = await attachPerformanceFile(file, () => current)
    expect(result.vms[0]).toMatchObject({ vCpu: 16, performance: { cpuP95Pct: 20 } })
  })
})
