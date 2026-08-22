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
 */
import * as XLSX from 'xlsx'
import { AUTO_CLASSIFY, DB_NAME_PATTERN, INFRA_NAME_PATTERN, VDI_NAME_PATTERN } from '../engine/rules'
import type { PowerState, TierId, Vm } from '../engine/types'

export interface ImportReport {
  vms: Vm[]
  totalRows: number
  excludedTemplates: number
  excludedSrmPlaceholders: number
  excludedVcls: number
  poweredOff: number
  usedPartitionData: boolean
  warnings: string[]
  hostSummary: HostSummary | null
}

export interface HostSummary {
  hosts: number
  totalPhysicalCores: number
  totalRamGiB: number
  clusters: string[]
  cpuModels: string[]
}

/** Case- and whitespace-insensitive column lookup that tolerates the MB -> MiB rename. */
function pick(row: Record<string, any>, ...names: string[]): any {
  const keys = Object.keys(row)
  for (const name of names) {
    const want = name.toLowerCase().replace(/\s+/g, '')
    for (const k of keys) {
      if (k.toLowerCase().replace(/\s+/g, '') === want) return row[k]
    }
  }
  return undefined
}

function num(v: any): number {
  if (v === undefined || v === null || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function bool(v: any): boolean {
  if (typeof v === 'boolean') return v
  const s = String(v ?? '').trim().toLowerCase()
  return s === 'true' || s === 'yes' || s === '1'
}

const mibToGiB = (mib: number) => mib / 1024

function sheet(wb: XLSX.WorkBook, ...candidates: string[]): Record<string, any>[] | null {
  for (const c of candidates) {
    const found = wb.SheetNames.find(n => n.toLowerCase() === c.toLowerCase())
    if (found) return XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[found], { defval: '' })
  }
  return null
}

/** Auto-classification. Anything promoted out of "general" is flagged for SE review. */
export function classify(name: string, guestOs: string, vCpu: number, ramGiB: number, storageGiB: number): TierId {
  const hay = `${name} ${guestOs}`
  if (DB_NAME_PATTERN.test(hay)) return 'database'
  if (VDI_NAME_PATTERN.test(hay)) return 'vdi'
  if (INFRA_NAME_PATTERN.test(name)) return 'infrastructure'
  if (
    vCpu >= AUTO_CLASSIFY.heavyVCpu ||
    ramGiB >= AUTO_CLASSIFY.heavyRamGiB ||
    storageGiB >= AUTO_CLASSIFY.heavyStorageGiB
  ) return 'database'
  return 'general'
}

export function parseRvTools(data: ArrayBuffer): ImportReport {
  const wb = XLSX.read(data, { type: 'array' })
  const warnings: string[] = []

  const vInfo = sheet(wb, 'vInfo')
  if (!vInfo || vInfo.length === 0) {
    throw new Error(
      'No vInfo tab found. This does not look like an RVTools export. Expected tabs: vInfo, vCPU, vMemory, vPartition, vHost.',
    )
  }

  // vPartition carries real in-guest consumption, which is what you actually want.
  const vPartition = sheet(wb, 'vPartition')
  const consumedByVm = new Map<string, number>()
  if (vPartition) {
    for (const row of vPartition) {
      const name = String(pick(row, 'VM') ?? '').trim()
      if (!name) continue
      const consumedMiB = num(pick(row, 'Consumed MiB', 'Consumed MB'))
      consumedByVm.set(name, (consumedByVm.get(name) ?? 0) + consumedMiB)
    }
  } else {
    warnings.push('No vPartition tab — falling back to vInfo "In Use" for consumed storage. In-guest figures would be more accurate.')
  }

  const snapshotCountByVm = new Map<string, number>()
  for (const row of sheet(wb, 'vSnapshot') ?? []) {
    const name = String(pick(row, 'VM') ?? '').trim()
    if (name) snapshotCountByVm.set(name, (snapshotCountByVm.get(name) ?? 0) + 1)
  }
  const rdmByVm = new Set<string>()
  const diskCountByVm = new Map<string, number>()
  for (const row of sheet(wb, 'vDisk') ?? []) {
    const name = String(pick(row, 'VM') ?? '').trim()
    if (!name) continue
    diskCountByVm.set(name, (diskCountByVm.get(name) ?? 0) + 1)
    const type = String(pick(row, 'Disk type', 'Type', 'Raw') ?? '')
    if (/rdm|raw device/i.test(type)) rdmByVm.add(name)
  }

  const hostCpuVendor = new Map<string, 'intel' | 'amd' | 'unknown'>()
  for (const host of sheet(wb, 'vHost') ?? []) {
    const name = String(pick(host, 'Host') ?? '').trim()
    const model = String(pick(host, 'CPU Model') ?? '')
    if (name) hostCpuVendor.set(name, /amd|epyc/i.test(model) ? 'amd' : /intel|xeon/i.test(model) ? 'intel' : 'unknown')
  }

  let excludedTemplates = 0
  let excludedSrmPlaceholders = 0
  let excludedVcls = 0
  let poweredOff = 0
  const vms: Vm[] = []
  let seq = 0

  for (const row of vInfo) {
    const name = String(pick(row, 'VM') ?? '').trim()
    if (!name) continue

    if (bool(pick(row, 'Template'))) { excludedTemplates++; continue }
    if (bool(pick(row, 'SRM Placeholder'))) { excludedSrmPlaceholders++; continue }
    // vCLS agent VMs have no flag column — match on name. Auto-deployed since vSphere 7 U1.
    if (/^vcls/i.test(name)) { excludedVcls++; continue }

    const powerRaw = String(pick(row, 'Powerstate', 'Power state') ?? 'poweredOn')
    const powerState: PowerState =
      /off/i.test(powerRaw) ? 'poweredOff' : /susp/i.test(powerRaw) ? 'suspended' : 'poweredOn'
    if (powerState !== 'poweredOn') poweredOff++

    const vCpu = num(pick(row, 'CPUs'))
    const ramGiB = mibToGiB(num(pick(row, 'Memory')))
    const provisionedGiB = mibToGiB(num(pick(row, 'Provisioned MiB', 'Provisioned MB')))
    const inUseGiB = mibToGiB(num(pick(row, 'In Use MiB', 'In Use MB')))
    const partitionGiB = consumedByVm.has(name) ? mibToGiB(consumedByVm.get(name)!) : 0
    const storageGiB = partitionGiB > 0 ? partitionGiB : inUseGiB > 0 ? inUseGiB : provisionedGiB

    const guestOs = String(
      pick(row, 'OS according to the VMware Tools', 'OS according to the configuration file', 'Guest OS') ?? '',
    )

    const tier = classify(name, guestOs, vCpu, ramGiB, storageGiB)
    seq += 1
    const sourceHost = String(pick(row, 'Host') ?? '')
    const firmwareRaw = String(pick(row, 'Firmware') ?? '').toLowerCase()
    vms.push({
      id: `rv-${seq}`,
      name,
      tier,
      vCpu,
      ramGiB: Math.round(ramGiB * 100) / 100,
      storageGiB: Math.round(storageGiB * 100) / 100,
      provisionedGiB: Math.round(provisionedGiB * 100) / 100,
      powerState,
      // Powered-off VMs import but are excluded from sizing by default. Toggle per VM.
      include: powerState === 'poweredOn',
      guestOs,
      sourceCluster: String(pick(row, 'Cluster') ?? ''),
      sourceHost,
      sourceCpuVendor: hostCpuVendor.get(sourceHost) ?? 'unknown',
      firmware: /efi|uefi/.test(firmwareRaw) ? 'efi' : /bios/.test(firmwareRaw) ? 'bios' : 'unknown',
      diskCount: diskCountByVm.get(name) ?? (num(pick(row, 'Disks')) || undefined),
      nicCount: num(pick(row, 'NICs')) || undefined,
      snapshotCount: snapshotCountByVm.get(name) ?? 0,
      hasRdm: rdmByVm.has(name),
      encrypted: bool(pick(row, 'Encrypted')),
      hasVtpm: bool(pick(row, 'TPM', 'vTPM')),
      autoClassified: tier !== 'general',
    })
  }

  if (vInfo.length > 20000) {
    warnings.push(`${vInfo.length} rows. Some import tools cap RVTools files at 20,000 VM rows.`)
  }
  if (poweredOff > 0) {
    warnings.push(`${poweredOff} powered-off VM(s) imported but EXCLUDED from sizing by default. Toggle them individually if they should count.`)
  }
  const autoCount = vms.filter(v => v.autoClassified).length
  if (autoCount > 0) {
    warnings.push(`${autoCount} VM(s) were auto-classified out of General Server. Review the tier column — auto-classification is a starting point, not an answer.`)
  }
  warnings.push('RVTools carries NO utilisation history. This import sizes on ALLOCATION, which typically oversizes. Adjust the per-tier Right-Sizing Factor, or bring a Live Optics / Aria Operations export for measured data.')

  // vHost, for the reverse-mode "here is what they already own" path.
  let hostSummary: HostSummary | null = null
  const vHost = sheet(wb, 'vHost')
  if (vHost && vHost.length > 0) {
    let cores = 0
    let ramGiB = 0
    const clusters = new Set<string>()
    const cpuModels = new Set<string>()
    for (const h of vHost) {
      const nCpu = num(pick(h, '# CPU', '#CPU'))
      const perCpu = num(pick(h, 'Cores per CPU'))
      const totalCores = num(pick(h, '# Cores', '#Cores'))
      cores += totalCores > 0 ? totalCores : nCpu * perCpu
      ramGiB += mibToGiB(num(pick(h, '# Memory', '#Memory')))
      const c = String(pick(h, 'Cluster') ?? '').trim()
      if (c) clusters.add(c)
      const m = String(pick(h, 'CPU Model') ?? '').trim()
      if (m) cpuModels.add(m)
    }
    hostSummary = {
      hosts: vHost.length,
      totalPhysicalCores: cores,
      totalRamGiB: Math.round(ramGiB),
      clusters: [...clusters],
      cpuModels: [...cpuModels],
    }
  }

  return {
    vms,
    totalRows: vInfo.length,
    excludedTemplates,
    excludedSrmPlaceholders,
    excludedVcls,
    poweredOff,
    usedPartitionData: consumedByVm.size > 0,
    warnings,
    hostSummary,
  }
}
