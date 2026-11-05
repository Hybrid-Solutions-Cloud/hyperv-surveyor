/**
 * Inventory import that is not a full RVTools workbook.
 *
 * Accepted:
 *  - a full RVTools workbook (handed to parseRvTools),
 *  - the RVTools vInfo tab saved as CSV,
 *  - the Surveyor inventory template, as CSV or XLSX.
 *
 * Hyper-V, SCVMM, Azure Migrate, physical and other exports are not read directly. They map
 * through the template: copy their columns into it.
 */
import * as XLSX from 'xlsx'
import type { PowerState, TierId, Vm } from '../engine/types'
import { TIER_IDS } from '../engine/rules'
import { classify } from './classifyVm'
import { findVInfo, hasColumn, needsSizeReview, num, parseRvToolsWorkbook, pick, type ImportReport, type StorageSourceCounts } from './rvtools'

type Row = Record<string, any>

export const INVENTORY_TEMPLATE_HEADERS = ['Name', 'vCPU', 'RAM GiB', 'Used GiB', 'Provisioned GiB', 'Power state', 'OS', 'Cluster', 'Tier'] as const

/** Example rows start with this prefix and are skipped on import. */
export const TEMPLATE_EXAMPLE_PREFIX = 'EXAMPLE-'

const TEMPLATE_EXAMPLES: Array<Array<string | number>> = [
  [`${TEMPLATE_EXAMPLE_PREFIX}app01`, 4, 16, 120, 200, 'on', 'Windows Server 2022', 'Cluster-A', ''],
  [`${TEMPLATE_EXAMPLE_PREFIX}sql01`, 8, 64, 900, 1200, 'off', 'Windows Server 2019', 'Cluster-A', 'database'],
]

const TEMPLATE_NOTES = [
  ['Column', 'Required', 'Meaning'],
  ['Name', 'Yes', 'VM name. Rows starting with EXAMPLE- are skipped.'],
  ['vCPU', 'Yes', 'Allocated virtual CPUs.'],
  ['RAM GiB', 'Yes', 'Allocated memory in GiB.'],
  ['Used GiB', 'Recommended', 'Consumed storage in GiB. This is what storage is sized on.'],
  ['Provisioned GiB', 'No', 'Allocated disk size in GiB. Shown for the thin-provisioning gap; not sized. Used when Used GiB is blank.'],
  ['Power state', 'No', 'on, off or suspended. Blank means on. Off and suspended VMs are excluded from sizing until you include them.'],
  ['OS', 'No', 'Guest operating system.'],
  ['Cluster', 'No', 'Source cluster or host group.'],
  ['Tier', 'No', 'general, database, vdi or infrastructure. Blank lets Surveyor suggest a tier from the name, flagged for review.'],
  [],
  ['Hyper-V, SCVMM, Azure Migrate and other exports are not read directly. Copy their columns into the Inventory sheet.'],
]

const COLUMNS = {
  name: ['Name', 'VM Name', 'VM', 'Virtual Machine'],
  vCpu: ['vCPU', 'vCPUs', 'CPUs', 'CPU', 'Cores'],
  ram: ['RAM GiB', 'Memory GiB', 'RAM (GiB)', 'Memory (GiB)', 'RAM', 'Memory'],
  used: ['Used GiB', 'Consumed GiB', 'Used (GiB)', 'Consumed (GiB)', 'Storage GiB', 'Used storage GiB'],
  provisioned: ['Provisioned GiB', 'Provisioned (GiB)', 'Allocated GiB', 'Allocated storage GiB'],
  power: ['Power state', 'Powerstate', 'State', 'Status'],
  os: ['OS', 'Guest OS', 'Operating system'],
  cluster: ['Cluster', 'Host group'],
  tier: ['Tier', 'Workload tier'],
}

export function looksLikeTemplate(rows: Row[] | null): boolean {
  return hasColumn(rows, ...COLUMNS.name) && hasColumn(rows, ...COLUMNS.vCpu) && hasColumn(rows, ...COLUMNS.ram)
}

function tierFrom(value: string): TierId | null {
  const v = value.trim().toLowerCase().replace(/[^a-z]/g, '')
  if (!v) return null
  if ((TIER_IDS as string[]).includes(v)) return v as TierId
  if (v === 'generalserver' || v === 'app' || v === 'application') return 'general'
  if (v === 'db' || v === 'sql') return 'database'
  if (v === 'infra') return 'infrastructure'
  return null
}

function powerFrom(value: string): PowerState {
  const v = value.trim().toLowerCase()
  if (/susp|paused|saved/.test(v)) return 'suspended'
  if (/off|stopped|deallocated|^0$|^false$/.test(v)) return 'poweredOff'
  return 'poweredOn'
}

export function parseInventoryTemplateRows(rows: Row[]): ImportReport {
  const warnings: string[] = []
  const missing = (['name', 'vCpu', 'ram'] as const).filter((key) => !hasColumn(rows, ...COLUMNS[key]))
  if (missing.length > 0) throw new Error(`The inventory is missing required columns: ${missing.map((key) => COLUMNS[key][0]).join(', ')}.`)
  const hasUsed = hasColumn(rows, ...COLUMNS.used)
  const hasProvisioned = hasColumn(rows, ...COLUMNS.provisioned)
  const hasPower = hasColumn(rows, ...COLUMNS.power)
  const vms: Vm[] = []
  const sources: StorageSourceCounts = { partition: 0, inUse: 0, provisioned: 0, none: 0, sharedDeduped: 0 }
  let examples = 0
  let missingSize = 0
  let badTier = 0
  let poweredOff = 0
  let suspended = 0
  let seq = 0
  for (const row of rows) {
    const name = String(pick(row, ...COLUMNS.name) ?? '').trim()
    if (!name) continue
    if (name.toUpperCase().startsWith(TEMPLATE_EXAMPLE_PREFIX)) { examples++; continue }
    const vCpu = Math.ceil(num(pick(row, ...COLUMNS.vCpu)))
    const ramGiB = num(pick(row, ...COLUMNS.ram))
    const usedGiB = num(pick(row, ...COLUMNS.used))
    const provisionedGiB = num(pick(row, ...COLUMNS.provisioned))
    const storageGiB = usedGiB > 0 ? usedGiB : provisionedGiB
    sources[usedGiB > 0 ? 'inUse' : provisionedGiB > 0 ? 'provisioned' : 'none'] += 1
    const powerState = powerFrom(String(pick(row, ...COLUMNS.power) ?? ''))
    if (powerState === 'poweredOff') poweredOff++
    if (powerState === 'suspended') suspended++
    const guestOs = String(pick(row, ...COLUMNS.os) ?? '').trim()
    const tierText = String(pick(row, ...COLUMNS.tier) ?? '')
    const given = tierFrom(tierText)
    if (!given && tierText.trim()) badTier++
    const tier = given ?? classify(name, guestOs)
    const sized = vCpu > 0 && ramGiB > 0
    if (!sized) missingSize++
    seq += 1
    vms.push({
      id: `inv-${seq}`,
      name,
      tier,
      vCpu,
      ramGiB: Math.round(ramGiB * 100) / 100,
      storageGiB: Math.round(storageGiB * 100) / 100,
      provisionedGiB: Math.round(Math.max(provisionedGiB, 0) * 100) / 100,
      powerState,
      include: powerState === 'poweredOn' && sized,
      guestOs,
      sourceCluster: String(pick(row, ...COLUMNS.cluster) ?? '').trim(),
      autoClassified: !given && tier !== 'general',
      sizeReview: !given && tier === 'general' && needsSizeReview(vCpu, ramGiB, storageGiB),
    })
  }
  if (vms.length === 0) throw new Error(examples > 0 ? 'The inventory holds only the EXAMPLE- rows from the template. Add your VMs and import it again.' : 'The inventory has no rows with a VM name.')
  if (examples > 0) warnings.push(`${examples} EXAMPLE- row(s) from the template were skipped.`)
  if (missingSize > 0) warnings.push(`${missingSize} VM(s) have no vCPU or RAM value, so they are excluded from sizing. Correct them in the inventory and tick Include.`)
  if (!hasUsed && !hasProvisioned) warnings.push('The file has no Used GiB or Provisioned GiB column, so every VM counts as 0 GiB of storage.')
  else if (!hasUsed) warnings.push('The file has no Used GiB column, so storage is sized on provisioned size, which overstates consumed storage.')
  if (sources.none > 0 && (hasUsed || hasProvisioned)) warnings.push(`${sources.none} VM(s) have no storage value and count as 0 GiB.`)
  if (!hasPower) warnings.push('The file has no Power state column, so every VM is treated as powered on.')
  if (badTier > 0) warnings.push(`${badTier} row(s) have a Tier value Surveyor does not recognise (use general, database, vdi or infrastructure). A tier was suggested from the name instead.`)
  if (poweredOff + suspended > 0) warnings.push(`${poweredOff} powered-off and ${suspended} suspended VM(s) are in the inventory but EXCLUDED from sizing by default. Choose below whether they should count.`)
  const auto = vms.filter((vm) => vm.autoClassified).length
  if (auto > 0) warnings.push(`${auto} VM(s) without a Tier value were auto-classified from their name or OS. Review the tier column.`)
  warnings.push('The inventory template carries no disk, RDM, shared-disk, encryption or vTPM detail, so readiness cannot report those. It also carries no utilisation history, so sizing uses allocation.')
  return {
    format: 'inventory-template',
    vms,
    totalRows: rows.length,
    excludedTemplates: 0,
    excludedSrmPlaceholders: 0,
    excludedVcls: 0,
    poweredOff,
    suspended,
    usedPartitionData: false,
    storageSources: sources,
    detection: { rdm: false, sharedDisks: false, encryption: false, vtpm: false },
    warnings,
    hostSummary: null,
  }
}

/** Reads any supported inventory file: RVTools workbook, vInfo CSV, or the inventory template. */
export function parseInventoryFile(data: ArrayBuffer): ImportReport {
  const wb = XLSX.read(data, { type: 'array' })
  if (findVInfo(wb)) return parseRvToolsWorkbook(wb)
  const preferred = [...wb.SheetNames].sort((a, b) => Number(b.toLowerCase() === 'inventory') - Number(a.toLowerCase() === 'inventory'))
  for (const sheetName of preferred) {
    const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheetName], { defval: '' })
    if (looksLikeTemplate(rows)) return parseInventoryTemplateRows(rows)
  }
  throw new Error('This file is not an RVTools workbook, an RVTools vInfo CSV, or the Surveyor inventory template. The template needs at least Name, vCPU and RAM GiB columns. Hyper-V, SCVMM and Azure Migrate exports are not read directly: copy their columns into the template.')
}

export function inventoryTemplateCsv(): string {
  const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
  return [INVENTORY_TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLES].map((row) => row.map(quote).join(',')).join('\r\n')
}

export function inventoryTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...INVENTORY_TEMPLATE_HEADERS], ...TEMPLATE_EXAMPLES]), 'Inventory')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(TEMPLATE_NOTES), 'Notes')
  return wb
}

export function downloadInventoryTemplate(format: 'csv' | 'xlsx') {
  if (format === 'xlsx') {
    XLSX.writeFile(inventoryTemplateWorkbook(), 'hyperv-surveyor-inventory-template.xlsx')
    return
  }
  const blob = new Blob([inventoryTemplateCsv()], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'hyperv-surveyor-inventory-template.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}
