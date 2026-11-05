import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { classify, describeStorageSources, parseRvTools, summarizeImport } from './rvtools'
import { assessMigrationReadiness } from '../engine/readiness'
import { DEFAULT_CONFIG } from '../state/defaults'

type Rows = Array<Record<string, unknown>>

function workbook(rows: Rows, tabs: Record<string, Rows> = {}): ArrayBuffer {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'vInfo')
  Object.entries(tabs).forEach(([name, tabRows]) => XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(tabRows), name))
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' })
}

const csv = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer

const row = (VM: string, Powerstate: string, CPUs = 4, memoryGiB = 16, os = 'Microsoft Windows Server 2022 (64-bit)') => ({
  VM, Powerstate, Template: false, 'SRM Placeholder': false, CPUs, Memory: memoryGiB * 1024,
  'In Use MiB': 200 * 1024, 'Provisioned MiB': 400 * 1024, 'OS according to the VMware Tools': os,
})

const disk = (VM: string, extra: Record<string, unknown> = {}) => ({ VM, Disk: 'Hard disk 1', 'Capacity MiB': 100 * 1024, Raw: false, 'Raw Comp. Mode': '', 'Sharing mode': 'sharingNone', 'Disk Path': `[ds1] ${VM}/${VM}.vmdk`, ...extra })

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

describe('B1 RDM, shared-disk, encryption and vTPM detection', () => {
  it('detects RDM from vDisk Raw = True', () => {
    const report = parseRvTools(workbook([row('a', 'poweredOn'), row('b', 'poweredOn')], { vDisk: [disk('a', { Raw: true }), disk('b')] }))
    expect(report.vms.map((vm) => vm.hasRdm)).toEqual([true, false])
    expect(report.detection.rdm).toBe(true)
  })

  it('detects RDM from the text value "True" and from Raw Comp. Mode', () => {
    const report = parseRvTools(workbook([row('a', 'poweredOn'), row('b', 'poweredOn')], { vDisk: [disk('a', { Raw: 'True' }), disk('b', { 'Raw Comp. Mode': 'physicalMode' })] }))
    expect(report.vms.map((vm) => vm.hasRdm)).toEqual([true, true])
  })

  it('keeps the disk-type text check', () => {
    const rows = [{ VM: 'a', Disk: 'Hard disk 1', 'Disk type': 'Raw Device Mapping' }]
    expect(parseRvTools(workbook([row('a', 'poweredOn')], { vDisk: rows })).vms[0].hasRdm).toBe(true)
  })

  it('flags a shared disk from Sharing mode and blocks RDM in readiness', () => {
    const report = parseRvTools(workbook([row('a', 'poweredOn'), row('b', 'poweredOn')], { vDisk: [disk('a', { Raw: true }), disk('b', { 'Sharing mode': 'sharingMultiWriter' })] }))
    expect(report.vms[1].hasSharedDisk).toBe(true)
    const readiness = assessMigrationReadiness(report.vms, DEFAULT_CONFIG)
    expect(readiness.statusByVm[report.vms[0].id]).toBe('blocked')
    expect(readiness.findings.some((finding) => finding.vmName === 'b' && /shared virtual disk/i.test(finding.finding))).toBe(true)
  })

  it('says RDM and shared disks could not be checked when vDisk lacks the columns, rather than reporting none', () => {
    const report = parseRvTools(workbook([row('a', 'poweredOn')], { vDisk: [{ VM: 'a', Disk: 'Hard disk 1', 'Capacity MiB': 1024 }] }))
    expect(report.detection).toMatchObject({ rdm: false, sharedDisks: false })
    expect(report.vms[0].hasRdm).toBeUndefined()
    expect(report.warnings.some((warning) => /could not show RDMs/.test(warning) && /does not mean there are none/.test(warning))).toBe(true)
  })

  it('reads encryption and vTPM only when their columns exist', () => {
    const withColumns = parseRvTools(workbook([{ ...row('a', 'poweredOn'), Encrypted: 'True', TPM: 'True' }]))
    expect(withColumns.vms[0]).toMatchObject({ encrypted: true, hasVtpm: true })
    const without = parseRvTools(workbook([row('a', 'poweredOn')]))
    expect(without.vms[0].encrypted).toBeUndefined()
    expect(without.vms[0].hasVtpm).toBeUndefined()
    expect(without.warnings.some((warning) => /VM encryption \(no Encrypted column\)/.test(warning) && /vTPM \(no TPM column\)/.test(warning))).toBe(true)
  })
})

describe('B2 vPartition only when it plausibly represents the VM', () => {
  const inUse = (VM: string, inUseGiB: number) => ({ ...row(VM, 'poweredOn'), 'In Use MiB': inUseGiB * 1024 })

  it('keeps In Use when the partition total is more than 50% below it, and warns', () => {
    const report = parseRvTools(workbook([inUse('big', 9 * 1024)], { vPartition: [{ VM: 'big', 'Consumed MiB': 40 * 1024 }] }))
    expect(report.vms[0].storageGiB).toBe(9 * 1024)
    expect(report.storageSources).toMatchObject({ partition: 0, inUse: 1 })
    expect(report.warnings.some((warning) => /1 VM\(s\) report vPartition totals more than 50% below/.test(warning))).toBe(true)
  })

  it('uses vPartition when it is within 50% of In Use', () => {
    const report = parseRvTools(workbook([inUse('a', 200)], { vPartition: [{ VM: 'a', 'Consumed MiB': 60 * 1024 }, { VM: 'a', 'Consumed MiB': 60 * 1024 }] }))
    expect(report.vms[0].storageGiB).toBe(120)
    expect(report.usedPartitionData).toBe(true)
  })

  it('uses vPartition when In Use is absent', () => {
    const noInUse = { ...row('a', 'poweredOn') } as Record<string, unknown>
    delete noInUse['In Use MiB']
    const report = parseRvTools(workbook([noInUse], { vPartition: [{ VM: 'a', 'Consumed MiB': 30 * 1024 }] }))
    expect(report.vms[0].storageGiB).toBe(30)
  })

  it('describes where each VM storage figure came from', () => {
    const report = parseRvTools(workbook([inUse('a', 200), inUse('b', 200)], { vPartition: [{ VM: 'a', 'Consumed MiB': 150 * 1024 }] }))
    expect(describeStorageSources(summarizeImport(report, 'x.xlsx'))).toBe('Consumed storage: 1 from vPartition (in-guest) · 1 from vInfo In Use.')
  })
})

describe('B9 per-VM joins with duplicate names', () => {
  const twin = (cluster: string, uuid?: string) => ({ ...row('web01', 'poweredOn'), Cluster: cluster, Datacenter: 'DC-A', ...(uuid ? { 'VM UUID': uuid } : {}), 'In Use MiB': 100 * 1024 })

  it('keys by VM UUID so two same-name VMs do not share totals', () => {
    const report = parseRvTools(workbook([twin('C1', 'u-1'), twin('C2', 'u-2')], {
      vPartition: [{ VM: 'web01', 'VM UUID': 'u-1', 'Consumed MiB': 90 * 1024 }, { VM: 'web01', 'VM UUID': 'u-2', 'Consumed MiB': 80 * 1024 }],
    }))
    expect(report.vms.map((vm) => vm.storageGiB)).toEqual([90, 80])
    expect(report.warnings.some((warning) => /1 VM name\(s\) appear more than once/.test(warning))).toBe(true)
  })

  it('falls back to name plus cluster', () => {
    const report = parseRvTools(workbook([twin('C1'), twin('C2')], {
      vPartition: [{ VM: 'web01', Cluster: 'C1', 'Consumed MiB': 90 * 1024 }, { VM: 'web01', Cluster: 'C2', 'Consumed MiB': 70 * 1024 }],
    }))
    expect(report.vms.map((vm) => vm.storageGiB)).toEqual([90, 70])
  })

  it('never double-counts a row it cannot attribute', () => {
    const report = parseRvTools(workbook([twin('C1'), twin('C2')], { vPartition: [{ VM: 'web01', 'Consumed MiB': 90 * 1024 }] }))
    expect(report.vms.map((vm) => vm.storageGiB)).toEqual([100, 100])
    expect(report.warnings.some((warning) => /1 vPartition row\(s\) could not be tied to one VM/.test(warning))).toBe(true)
  })
})

describe('B11 guest OS', () => {
  it('uses the configuration-file OS when the Tools OS is empty, so legacy OS review fires', () => {
    const vm = { ...row('old1', 'poweredOn'), 'OS according to the VMware Tools': '', 'OS according to the configuration file': 'Microsoft Windows XP Professional (32-bit)' }
    const report = parseRvTools(workbook([vm]))
    expect(report.vms[0].guestOs).toBe('Microsoft Windows XP Professional (32-bit)')
    expect(assessMigrationReadiness(report.vms, DEFAULT_CONFIG).findings.some((finding) => finding.category === 'operating-system')).toBe(true)
  })
})

describe('B12 shared disks', () => {
  const node = (VM: string, Powerstate = 'poweredOn') => ({ ...row(VM, Powerstate), 'In Use MiB': 10 * 1024 * 1024 + 100 * 1024, 'Unshared MiB': 100 * 1024, 'VI SDK Server': 'vc1' })
  const sharedDisk = (VM: string) => disk(VM, { 'Sharing mode': 'sharingMultiWriter', 'Disk Path': '[san1] quorum/data.vmdk' })

  it('counts shared space once when Disk Path, In Use and Unshared MiB support it', () => {
    const report = parseRvTools(workbook([node('sqlnode1'), node('sqlnode2')], { vDisk: [sharedDisk('sqlnode1'), sharedDisk('sqlnode2')] }))
    const [first, second] = report.vms
    expect(first.storageGiB).toBe(10 * 1024 + 100)
    expect(second.storageGiB).toBe(100)
    expect(second.sharedStorageDedupedGiB).toBe(10 * 1024)
    expect(report.vms.every((vm) => vm.hasSharedDisk)).toBe(true)
    expect(report.storageSources.sharedDeduped).toBe(2)
    expect(report.warnings.some((warning) => /counted once/.test(warning))).toBe(true)
  })

  it('counts the shared space on the powered-on node', () => {
    const report = parseRvTools(workbook([node('n1', 'poweredOff'), node('n2')], { vDisk: [sharedDisk('n1'), sharedDisk('n2')] }))
    expect(report.vms.map((vm) => vm.storageGiB)).toEqual([100, 10 * 1024 + 100])
  })

  it('flags only, and does not guess, without Unshared MiB', () => {
    const plain = (VM: string) => ({ ...row(VM, 'poweredOn'), 'In Use MiB': 10 * 1024 * 1024 })
    const report = parseRvTools(workbook([plain('n1'), plain('n2')], { vDisk: [sharedDisk('n1'), sharedDisk('n2')] }))
    expect(report.vms.map((vm) => vm.storageGiB)).toEqual([10 * 1024, 10 * 1024])
    expect(report.vms.every((vm) => vm.hasSharedDisk)).toBe(true)
    expect(report.warnings.some((warning) => /2 VM\(s\) have shared disks/.test(warning) && /not adjusted/.test(warning))).toBe(true)
  })
})

describe('B16 vInfo saved as CSV', () => {
  it('imports the vInfo columns from a CSV file', () => {
    const report = parseRvTools(csv('VM,Powerstate,CPUs,Memory,In Use MiB,Provisioned MiB\r\napp1,poweredOn,4,"16,384",204800,409600\r\napp2,poweredOff,2,8192,102400,204800'))
    expect(report.format).toBe('rvtools-vinfo-csv')
    expect(report.vms.map((vm) => [vm.name, vm.vCpu, vm.ramGiB, vm.storageGiB, vm.include])).toEqual([['app1', 4, 16, 200, true], ['app2', 2, 8, 100, false]])
    expect(report.warnings.some((warning) => /only the vInfo columns/.test(warning))).toBe(true)
  })
})

describe('B17 missing data', () => {
  it('rejects vInfo data without the CPUs or Memory column', () => {
    expect(() => parseRvTools(workbook([{ VM: 'a', Powerstate: 'poweredOn', CPUs: 4 }]))).toThrow(/missing the Memory column/)
  })

  it('excludes and reports rows with no vCPU or memory instead of including a 0/0/0 VM', () => {
    const report = parseRvTools(workbook([row('a', 'poweredOn'), { ...row('b', 'poweredOn'), CPUs: '', Memory: '' }]))
    expect(report.vms[1].include).toBe(false)
    expect(report.warnings.some((warning) => /1 VM\(s\) have no vCPU or memory value/.test(warning))).toBe(true)
  })
})

describe('B8 host data kept per host', () => {
  it('keeps every vHost row as well as the totals', () => {
    const report = parseRvTools(workbook([row('a', 'poweredOn')], {
      vHost: [
        { Host: 'esx1', Cluster: 'C1', Datacenter: 'DC-A', 'VI SDK Server': 'vc1', '# CPU': 2, 'Cores per CPU': 16, '# Cores': 32, '# Memory': 512 * 1024, 'CPU Model': 'Intel(R) Xeon(R) Gold', '# VMs': 20 },
        { Host: 'esx2', Cluster: 'C1', Datacenter: 'DC-A', 'VI SDK Server': 'vc1', '# CPU': 2, 'Cores per CPU': 24, '# Memory': 768 * 1024, 'CPU Model': 'AMD EPYC 9354' },
      ],
    }))
    expect(report.hostSummary).toMatchObject({ hosts: 2, totalPhysicalCores: 80, totalRamGiB: 1280 })
    expect(report.hostSummary!.perHost.map((host) => [host.name, host.totalCores, host.ramGiB, host.cpuVendor, host.vmCount])).toEqual([
      ['esx1', 32, 512, 'intel', 20],
      ['esx2', 48, 768, 'amd', undefined],
    ])
  })
})

describe('Phase 8 conversion blockers from vDisk and vDatastore', () => {
  it('reads independent disks, physical-mode RDMs and vSAN placement', () => {
    const report = parseRvTools(workbook([row('ind', 'poweredOn'), row('prdm', 'poweredOn'), row('onvsan', 'poweredOn'), row('plain', 'poweredOn')], {
      vDisk: [
        disk('ind', { 'Disk Mode': 'independent_persistent' }),
        disk('prdm', { Raw: true, 'Raw Comp. Mode': 'physicalMode', 'Disk Mode': 'persistent' }),
        disk('onvsan', { 'Disk Path': '[vsanDatastore] onvsan/onvsan.vmdk', Path: '[vsanDatastore] onvsan/onvsan.vmdk', 'Disk Mode': 'persistent' }),
        disk('plain', { 'Disk Mode': 'persistent' }),
      ],
      vDatastore: [{ Name: 'vsanDatastore', Type: 'vsan' }, { Name: 'ds1', Type: 'VMFS' }],
    }))
    const byName = Object.fromEntries(report.vms.map((v) => [v.name, v]))
    expect(byName.ind.hasIndependentDisk).toBe(true)
    expect(byName.prdm.rdmPhysical).toBe(true)
    expect(byName.prdm.hasRdm).toBe(true)
    expect(byName.onvsan.onVsan).toBe(true)
    expect(byName.plain).toMatchObject({ hasIndependentDisk: false, rdmPhysical: false, onVsan: false })
    expect(report.detection).toMatchObject({ diskMode: true, rdmMode: true, vsan: true })
  })

  it('leaves the fields unknown when the columns are missing, and says so', () => {
    const report = parseRvTools(workbook([row('a', 'poweredOn')]))
    expect(report.vms[0].hasIndependentDisk).toBeUndefined()
    expect(report.vms[0].onVsan).toBeUndefined()
    expect(report.warnings.some((warning) => warning.includes("independent disks (no vDisk Disk Mode column)"))).toBe(true)
  })
})
