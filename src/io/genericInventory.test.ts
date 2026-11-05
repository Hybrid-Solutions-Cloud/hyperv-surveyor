import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { inventoryTemplateCsv, inventoryTemplateWorkbook, parseInventoryFile } from './genericInventory'

const csv = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer

describe('B16 generic inventory import', () => {
  it('reads the template columns, including optional tier and power state', () => {
    const report = parseInventoryFile(csv([
      'Name,vCPU,RAM GiB,Used GiB,Provisioned GiB,Power state,OS,Cluster,Tier',
      'web01,4,16,120,200,on,Windows Server 2022,Cluster-A,',
      'files01,2,8,900,1000,off,Ubuntu 22.04,Cluster-B,general',
      'reports,8,64,300,400,,Windows Server 2019,Cluster-A,database',
    ].join('\r\n')))
    expect(report.format).toBe('inventory-template')
    expect(report.vms.map((vm) => [vm.name, vm.vCpu, vm.ramGiB, vm.storageGiB, vm.provisionedGiB, vm.powerState, vm.include, vm.tier, vm.sourceCluster])).toEqual([
      ['web01', 4, 16, 120, 200, 'poweredOn', true, 'general', 'Cluster-A'],
      ['files01', 2, 8, 900, 1000, 'poweredOff', false, 'general', 'Cluster-B'],
      ['reports', 8, 64, 300, 400, 'poweredOn', true, 'database', 'Cluster-A'],
    ])
    expect(report.vms[2].autoClassified).toBe(false)
    expect(report.poweredOff).toBe(1)
  })

  it('suggests a tier from the name when Tier is blank, flagged for review', () => {
    const report = parseInventoryFile(csv('Name,vCPU,RAM GiB,Used GiB\r\nprd-sql-01,8,64,500'))
    expect(report.vms[0]).toMatchObject({ tier: 'database', autoClassified: true })
  })

  it('skips the template example rows and warns about missing optional columns', () => {
    const report = parseInventoryFile(csv(`${inventoryTemplateCsv()}\r\n"vm1","2","4","","50","","","",""`))
    expect(report.vms.map((vm) => vm.name)).toEqual(['vm1'])
    expect(report.vms[0].storageGiB).toBe(50)
    expect(report.warnings.some((warning) => /2 EXAMPLE- row/.test(warning))).toBe(true)
  })

  it('reads the XLSX template from its Inventory sheet', () => {
    const wb = inventoryTemplateWorkbook()
    XLSX.utils.sheet_add_aoa(wb.Sheets.Inventory, [['app9', 2, 8, 40, 80, 'on', 'Windows', 'C1', 'infrastructure']], { origin: -1 })
    const report = parseInventoryFile(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
    expect(report.vms).toHaveLength(1)
    expect(report.vms[0]).toMatchObject({ name: 'app9', tier: 'infrastructure' })
  })

  it('still reads a full RVTools workbook', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ VM: 'a', Powerstate: 'poweredOn', CPUs: 2, Memory: 4096, 'In Use MiB': 1024 }]), 'vInfo')
    expect(parseInventoryFile(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })).format).toBe('rvtools')
  })

  it('explains what is accepted when the file is something else', () => {
    expect(() => parseInventoryFile(csv('Host,Status\r\nh1,ok'))).toThrow(/Hyper-V, SCVMM and Azure Migrate exports are not read directly/)
  })

  it('excludes rows without vCPU or RAM', () => {
    const report = parseInventoryFile(csv('Name,vCPU,RAM GiB\r\nvm1,,8'))
    expect(report.vms[0].include).toBe(false)
  })
})
