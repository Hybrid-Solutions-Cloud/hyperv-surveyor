/**
 * Migration readiness: an exception screen over the imported inventory. A VM is Ready only when no
 * check found a problem AND the data each status-changing check needs was present. Every check that
 * could not run is listed with the data it needed, so Ready never implies a check passed when it did
 * not run.
 */
import { LIMITS } from './rules'
import type { ClusterConfig, Vm } from './types'

export type ReadinessStatus = 'ready' | 'review' | 'blocked'

export interface ReadinessFinding {
  vmId: string
  vmName: string
  /** info findings are notes: they never change a VM's status. */
  status: Exclude<ReadinessStatus, 'ready'> | 'info'
  category: 'operating-system' | 'firmware' | 'storage' | 'security' | 'snapshot' | 'processor' | 'configuration' | 'data'
  finding: string
  action: string
  source?: string
}

/** A check that could not run for some VMs, and the data it needed. */
export interface ReadinessGap {
  check: string
  vms: number
  needs: string
}

export interface MigrationReadiness {
  ready: number
  review: number
  blocked: number
  assessed: number
  findings: ReadinessFinding[]
  statusByVm: Record<string, ReadinessStatus>
  /** Checks that could not run, by check. Empty when every check had its data. */
  notChecked: ReadinessGap[]
  /** One sentence saying what Ready means for this inventory. */
  readyMeaning: string
}

export const READINESS_SOURCES = {
  windowsGuests: 'https://learn.microsoft.com/windows-server/virtualization/hyper-v/supported-windows-guest-operating-systems-for-hyper-v-on-windows',
  linuxGuests: 'https://learn.microsoft.com/windows-server/virtualization/hyper-v/supported-linux-and-freebsd-virtual-machines-for-hyper-v-on-windows',
  scaleLimits: 'https://learn.microsoft.com/windows-server/virtualization/hyper-v/maximum-scale-limits',
  generations: 'https://learn.microsoft.com/windows-server/virtualization/hyper-v/features-terminology',
  vmmConvert: 'https://learn.microsoft.com/system-center/vmm/vm-convert-vmware',
  wacConvertTroubleshoot: 'https://learn.microsoft.com/windows-server/manage/windows-admin-center/use/troubleshoot-vm-conversion-extension',
  wacConvertFaq: 'https://learn.microsoft.com/windows-server/manage/windows-admin-center/use/vm-conversion-extension-faq',
  processorCompatibility: 'https://learn.microsoft.com/windows-server/virtualization/hyper-v/processor-compatibility-mode',
} as const

/** Generation 1 limits on a Windows Server 2025 host. [MS] maximum-scale-limits */
export const GEN1_LIMITS = { vCpu: 64, ramGiB: 1024, disks: 4 + 256 } as const
/** Generation 2: 256 SCSI disks (4 controllers × 64). [MS] maximum-scale-limits */
export const GEN2_MAX_DISKS = 256

export type GuestSupport = 'supported' | 'supported-family' | 'legacy' | 'not-listed' | 'unknown'

/**
 * Where a guest OS stands against Microsoft's supported-guest pages. supported: a current Windows
 * guest listed for Windows Server 2025 hosts. supported-family: a Linux or FreeBSD family Microsoft
 * lists (check the version on the Linux page). legacy: on the list only as an older release past end
 * of support. not-listed: not on either page. unknown: no OS in the inventory.
 */
export function guestOsSupport(guestOs: string | undefined): { support: GuestSupport; label: string } {
  const os = (guestOs ?? '').trim()
  if (!os) return { support: 'unknown', label: 'No guest OS in the inventory' }
  if (/windows/i.test(os)) {
    if (/server/i.test(os) || /20(0[03]|08|12|16|19|22|25)\b/.test(os)) {
      if (/\b20(25|22|19|16)\b/.test(os)) return { support: 'supported', label: os }
      if (/\b2012\b/.test(os) || /\b2008\b/.test(os)) return { support: 'legacy', label: os }
      if (/\b(2003|2000)\b|\bnt\b/i.test(os)) return { support: 'not-listed', label: os }
      return { support: 'unknown', label: `${os} (version not shown)` }
    }
    if (/windows\s*(11|10)\b/i.test(os)) return { support: 'supported', label: os }
    if (/windows\s*(8\.1|7)\b/i.test(os)) return { support: 'legacy', label: os }
    if (/windows\s*(xp|vista|8|2000|9[58]|me)\b/i.test(os)) return { support: 'not-listed', label: os }
    return { support: 'unknown', label: `${os} (version not shown)` }
  }
  if (/red\s*hat|rhel|centos|debian|suse|sles|oracle\s*(enterprise\s*)?linux|oraclelinux|ubuntu|freebsd/i.test(os)) return { support: 'supported-family', label: os }
  return { support: 'not-listed', label: os }
}

type Status = ReadinessFinding['status']

export function assessMigrationReadiness(vms: Vm[], cfg: ClusterConfig): MigrationReadiness {
  const included = vms.filter((vm) => vm.include)
  const findings: ReadinessFinding[] = []
  const gaps = new Map<string, ReadinessGap>()
  const gap = (check: string, needs: string) => {
    const current = gaps.get(check) ?? { check, vms: 0, needs }
    current.vms += 1
    gaps.set(check, current)
  }
  const add = (vm: Vm, status: Status, category: ReadinessFinding['category'], finding: string, action: string, source?: string) => findings.push({ vmId: vm.id, vmName: vm.name, status, category, finding, action, source })
  const targetVendor = cfg.node.cpuVendor
  included.forEach((vm) => {
    if (vm.vCpu > LIMITS.MAX_VCPU_PER_VM) add(vm, 'blocked', 'configuration', `${vm.vCpu} vCPUs exceed the Hyper-V per-VM maximum.`, 'Reduce the VM topology or split the workload before migration.', READINESS_SOURCES.scaleLimits)

    // Guest OS.
    const guest = guestOsSupport(vm.guestOs)
    if (guest.support === 'unknown' && !(vm.guestOs ?? '').trim()) {
      add(vm, 'review', 'data', 'Your inventory has no guest OS for this VM, so guest support was not checked.', 'Record the guest OS and check it against Microsoft\'s supported-guest lists.', READINESS_SOURCES.windowsGuests)
    } else if (guest.support === 'unknown') {
      add(vm, 'review', 'operating-system', `${guest.label}: the Windows version could not be read, so guest support was not confirmed.`, 'Confirm the exact version against Microsoft\'s supported Windows guests.', READINESS_SOURCES.windowsGuests)
    } else if (guest.support === 'legacy') {
      add(vm, 'review', 'operating-system', `${guest.label} is an older release past end of support. Microsoft's list does not confirm it as a guest on Windows Server 2025 hosts.`, 'Upgrade the guest, or confirm Microsoft and application-vendor support for your target host before you migrate it.', READINESS_SOURCES.windowsGuests)
    } else if (guest.support === 'not-listed') {
      add(vm, 'review', 'operating-system', `${guest.label} is not on Microsoft's supported Windows, Linux or FreeBSD guest lists.`, 'Treat it as unsupported on Hyper-V: confirm with the OS vendor, replatform it, or keep it outside this migration.', /windows/i.test(guest.label) ? READINESS_SOURCES.windowsGuests : READINESS_SOURCES.linuxGuests)
    } else if (guest.support === 'supported-family') {
      add(vm, 'info', 'operating-system', `${guest.label}: the family is on Microsoft's Linux and FreeBSD list; the supported versions are listed per release.`, 'Check the exact release on the Linux and FreeBSD page.', READINESS_SOURCES.linuxGuests)
    }

    // Firmware and generation.
    const firmware = vm.firmware
    if (firmware === undefined || firmware === 'unknown') {
      add(vm, 'review', 'data', 'Your inventory has no firmware type for this VM, so the target generation and its limits were not checked.', 'Confirm BIOS or UEFI. BIOS maps to Generation 1, UEFI to Generation 2.', READINESS_SOURCES.generations)
    } else if (firmware === 'bios') {
      add(vm, 'review', 'firmware', 'BIOS firmware maps to a Generation 1 Hyper-V VM.', 'Confirm Generation 1 is acceptable or plan an application-supported UEFI conversion.', READINESS_SOURCES.generations)
      if (vm.vCpu > GEN1_LIMITS.vCpu) add(vm, 'blocked', 'firmware', `${vm.vCpu} vCPUs exceed the Generation 1 limit of ${GEN1_LIMITS.vCpu}.`, 'Convert the guest to UEFI and Generation 2 before migration, or reduce its vCPUs.', READINESS_SOURCES.scaleLimits)
      if (vm.ramGiB > GEN1_LIMITS.ramGiB) add(vm, 'blocked', 'firmware', `${vm.ramGiB.toLocaleString('en-US')} GiB of memory exceeds the Generation 1 limit of 1 TB.`, 'Convert the guest to UEFI and Generation 2 before migration, or reduce its memory.', READINESS_SOURCES.scaleLimits)
      if (vm.hasVtpm) add(vm, 'review', 'security', 'vTPM is enabled on a BIOS VM. Virtual TPM is available for Generation 2 VMs only.', 'Convert the guest to UEFI and Generation 2, or plan for no vTPM on the target.', READINESS_SOURCES.generations)
    }
    const maxDisks = firmware === 'bios' ? GEN1_LIMITS.disks : GEN2_MAX_DISKS
    if (vm.diskCount === undefined) gap('Virtual disk count against the per-VM limit', 'vDisk rows or a Disks column')
    else if (vm.diskCount > maxDisks) add(vm, 'blocked', 'configuration', `${vm.diskCount} virtual disks exceed the ${firmware === 'bios' ? 'Generation 1 limit of 260 (4 IDE and 256 SCSI)' : 'limit of 256 SCSI disks'}.`, 'Consolidate disks before migration.', READINESS_SOURCES.scaleLimits)
    else if (vm.diskCount > 64) add(vm, 'info', 'configuration', `${vm.diskCount} virtual disks need more than one SCSI controller (64 disks each).`, 'Map every disk to a SCSI controller and check backup limits.', READINESS_SOURCES.scaleLimits)

    // Storage.
    if (vm.hasRdm === undefined) gap('Raw device mappings', 'the vDisk Raw or Raw Comp. Mode column')
    else if (vm.hasRdm) add(vm, 'blocked', 'storage', vm.rdmPhysical ? 'Physical-mode raw device mapping detected. Windows Admin Center VM conversion does not support physical-mode RDMs.' : 'Raw device mapping detected.', 'Replace the RDM with a VHDX, a shared VHDX or VHD Set, or application-native storage before conversion.', vm.rdmPhysical ? READINESS_SOURCES.wacConvertTroubleshoot : undefined)
    if (vm.hasSharedDisk === undefined) gap('Shared or multi-writer disks', 'the vDisk Sharing mode or Shared Bus column')
    else if (vm.hasSharedDisk) add(vm, 'review', 'storage', 'Shared virtual disk detected (multi-writer or SCSI bus sharing).', 'Design the Hyper-V equivalent, such as a shared VHDX or VHD Set for a guest cluster, and confirm your migration method supports it.')
    if (vm.hasIndependentDisk === undefined) gap('Independent disks', 'the vDisk Disk Mode column')
    else if (vm.hasIndependentDisk) add(vm, 'review', 'storage', 'Independent disk detected. Windows Admin Center VM conversion does not support independent disks (persistent or nonpersistent).', 'Change the disk to dependent mode before conversion, or use another migration method.', READINESS_SOURCES.wacConvertTroubleshoot)
    if (vm.onVsan === undefined) gap('vSAN placement', 'the vDatastore tab with a Type column')
    else if (vm.onVsan) add(vm, 'review', 'storage', 'The VM is on vSAN storage. VMM cannot convert VMs on vSAN, and Windows Admin Center VM conversion does not support them.', 'Move the VM to a VMFS or NFS datastore first, or use another migration method.', READINESS_SOURCES.vmmConvert)
    if (vm.snapshotCount === undefined) gap('Snapshots', 'the vSnapshot tab')
    else if (vm.snapshotCount > 0) add(vm, 'review', 'snapshot', `${vm.snapshotCount} VMware snapshot(s) detected. VMM converts only VMs with no snapshots.`, 'Consolidate snapshots and verify backup consistency before conversion.', READINESS_SOURCES.vmmConvert)

    // Security.
    if (vm.encrypted === undefined && vm.hasVtpm === undefined) gap('Encryption and vTPM', 'an Encrypted and a TPM column in vInfo')
    else if ((vm.encrypted || vm.hasVtpm) && !(firmware === 'bios' && vm.hasVtpm && !vm.encrypted)) add(vm, 'review', 'security', 'Encryption or vTPM is enabled.', 'Design target key protection and vTPM handling, and choose a migration method that supports it.')

    // Processor vendor: conversion is a cold migration or a replication with cutover, so a vendor change is expected.
    if (vm.sourceCpuVendor && vm.sourceCpuVendor !== 'unknown' && targetVendor && targetVendor !== 'unknown' && vm.sourceCpuVendor !== targetVendor) {
      add(vm, 'info', 'processor', `Source CPU vendor is ${vm.sourceCpuVendor.toUpperCase()} and target is ${targetVendor.toUpperCase()}.`, 'No action for conversion: VMM converts stopped VMs, and replication tools cut over with a restart. Live migration cannot cross Intel and AMD, so plan any later host moves within one vendor.', READINESS_SOURCES.processorCompatibility)
    }
  })
  const statusByVm: Record<string, ReadinessStatus> = {}
  const byVm = new Map<string, ReadinessFinding[]>()
  findings.forEach((finding) => byVm.set(finding.vmId, [...(byVm.get(finding.vmId) ?? []), finding]))
  included.forEach((vm) => {
    const vmFindings = (byVm.get(vm.id) ?? []).filter((finding) => finding.status !== 'info')
    statusByVm[vm.id] = vmFindings.some((finding) => finding.status === 'blocked') ? 'blocked' : vmFindings.length ? 'review' : 'ready'
  })
  const notChecked = [...gaps.values()]
  const readyMeaning = notChecked.length === 0
    ? 'Ready means no check found an exception; every check had the data it needs.'
    : `Ready means no check found an exception in the data you have. ${notChecked.length} check${notChecked.length === 1 ? ' was' : 's were'} not run for some VMs because the data is missing: ${notChecked.map((item) => `${item.check.toLowerCase()} (${item.vms} VM${item.vms === 1 ? '' : 's'}, needs ${item.needs})`).join('; ')}.`
  const statuses = Object.values(statusByVm)
  return {
    assessed: included.length,
    ready: statuses.filter((status) => status === 'ready').length,
    review: statuses.filter((status) => status === 'review').length,
    blocked: statuses.filter((status) => status === 'blocked').length,
    findings,
    statusByVm,
    notChecked,
    readyMeaning,
  }
}
