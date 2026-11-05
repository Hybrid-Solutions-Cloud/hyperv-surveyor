import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { classify, parseRvTools, summarizeImport } from './rvtools'

function workbook(rows: Array<Record<string, unknown>>): ArrayBuffer {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'vInfo')
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' })
}

const row = (VM: string, Powerstate: string, CPUs = 4, memoryGiB = 16, os = 'Microsoft Windows Server 2022 (64-bit)') => ({
  VM, Powerstate, Template: false, 'SRM Placeholder': false, CPUs, Memory: memoryGiB * 1024,
  'In Use MiB': 200 * 1024, 'Provisioned MiB': 400 * 1024, 'OS according to the VMware Tools': os,
})

describe('RVTools power states', () => {
  const report = parseRvTools(workbook([row('app1', 'poweredOn'), row('app2', 'poweredOff'), row('app3', 'poweredOff'), row('app4', 'suspended')]))

  it('keeps powered-off and suspended VMs in the inventory, excluded by default', () => {
    expect(report.vms.map((vm) => [vm.name, vm.powerState, vm.include])).toEqual([
      ['app1', 'poweredOn', true],
      ['app2', 'poweredOff', false],
      ['app3', 'poweredOff', false],
      ['app4', 'suspended', false],
    ])
  })

  it('counts powered-off and suspended separately', () => {
    expect(report.poweredOff).toBe(2)
    expect(report.suspended).toBe(1)
    expect(report.warnings.some((warning) => warning.includes('2 powered-off and 1 suspended'))).toBe(true)
  })

  it('keeps a summary that survives leaving the page, without the VMs', () => {
    const summary = summarizeImport(report, 'estate.xlsx')
    expect(summary).toMatchObject({ fileName: 'estate.xlsx', importedVms: 4, poweredOff: 2, suspended: 1 })
    expect(summary).not.toHaveProperty('vms')
  })
})

describe('RVTools tier classification', () => {
  it('does not make a VM a database because of its size', () => {
    const { vms } = parseRvTools(workbook([row('app1', 'poweredOn', 16, 128)]))
    expect(vms[0].tier).toBe('general')
    expect(vms[0].autoClassified).toBe(false)
    expect(vms[0].sizeReview).toBe(true)
  })

  it('does not flag an ordinary VM for review', () => {
    expect(parseRvTools(workbook([row('app1', 'poweredOn')])).vms[0].sizeReview).toBe(false)
  })

  it('still classifies from the VM name', () => {
    const { vms } = parseRvTools(workbook([row('prod-sql-01', 'poweredOn', 4, 16)]))
    expect(vms[0].tier).toBe('database')
    expect(vms[0].autoClassified).toBe(true)
    expect(vms[0].sizeReview).toBe(false)
  })

  it('does not treat the Oracle Linux operating system as an Oracle database', () => {
    expect(classify('app1', 'Oracle Linux 8 (64-bit)')).toBe('general')
    expect(classify('oracle-prod-1', 'Oracle Linux 8 (64-bit)')).toBe('database')
  })
})
