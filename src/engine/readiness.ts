import { LIMITS } from './rules'
import type { ClusterConfig, Vm } from './types'

export type ReadinessStatus = 'ready' | 'review' | 'blocked'

export interface ReadinessFinding {
  vmId: string
  vmName: string
  status: Exclude<ReadinessStatus, 'ready'>
  category: 'operating-system' | 'firmware' | 'storage' | 'security' | 'snapshot' | 'processor' | 'configuration'
  finding: string
  action: string
}

export interface MigrationReadiness {
  ready: number
  review: number
  blocked: number
  assessed: number
  findings: ReadinessFinding[]
  statusByVm: Record<string, ReadinessStatus>
}

export function assessMigrationReadiness(vms: Vm[], cfg: ClusterConfig): MigrationReadiness {
  const included = vms.filter((vm) => vm.include)
  const findings: ReadinessFinding[] = []
  const add = (vm: Vm, status: 'review' | 'blocked', category: ReadinessFinding['category'], finding: string, action: string) => findings.push({ vmId: vm.id, vmName: vm.name, status, category, finding, action })
  included.forEach((vm) => {
    if (vm.vCpu > LIMITS.MAX_VCPU_PER_VM) add(vm, 'blocked', 'configuration', `${vm.vCpu} vCPUs exceed the Hyper-V per-VM maximum.`, 'Reduce the VM topology or split the workload before migration.')
    if (/windows\s*(xp|2000|2003|2008(?!\s*r2))/i.test(vm.guestOs ?? '')) add(vm, 'review', 'operating-system', 'Legacy Windows guest detected; current support and integration components require validation.', 'Confirm Microsoft and application-vendor support or modernize the guest before migration.')
    if (vm.firmware === 'bios') add(vm, 'review', 'firmware', 'BIOS firmware maps to a Generation 1 Hyper-V VM.', 'Confirm Generation 1 is acceptable or plan an application-supported UEFI conversion.')
    if (vm.firmware === 'unknown') add(vm, 'review', 'firmware', 'Firmware type is missing from the source inventory.', 'Confirm BIOS versus UEFI before choosing the target VM generation.')
    if (vm.hasRdm) add(vm, 'blocked', 'storage', 'Raw Device Mapping detected.', 'Replace the RDM with a supported VHDX, pass-through, shared-VHDX/VHD Set, or application-native storage design.')
    if ((vm.snapshotCount ?? 0) > 0) add(vm, 'review', 'snapshot', `${vm.snapshotCount} VMware snapshot(s) detected.`, 'Consolidate snapshots and verify backup consistency before conversion.')
    if (vm.encrypted || vm.hasVtpm) add(vm, 'review', 'security', 'Encryption or vTPM is enabled.', 'Design target key protection, shielding/vTPM handling, and a supported migration method.')
    if (vm.sourceCpuVendor && vm.sourceCpuVendor !== 'unknown' && cfg.node.cpuVendor && cfg.node.cpuVendor !== 'unknown' && vm.sourceCpuVendor !== cfg.node.cpuVendor) {
      add(vm, 'review', 'processor', `Source CPU vendor is ${vm.sourceCpuVendor.toUpperCase()} and target is ${cfg.node.cpuVendor.toUpperCase()}.`, 'Plan a powered-off migration; live migration processor compatibility cannot cross Intel and AMD vendors.')
    }
    if ((vm.diskCount ?? 0) > 64) add(vm, 'review', 'configuration', `${vm.diskCount} virtual disks require a detailed controller and attachment design.`, 'Map every disk and controller to supported Hyper-V SCSI attachments and validate backup limits.')
  })
  const statusByVm: Record<string, ReadinessStatus> = {}
  included.forEach((vm) => {
    const vmFindings = findings.filter((finding) => finding.vmId === vm.id)
    statusByVm[vm.id] = vmFindings.some((finding) => finding.status === 'blocked') ? 'blocked' : vmFindings.length ? 'review' : 'ready'
  })
  return {
    assessed: included.length,
    ready: Object.values(statusByVm).filter((status) => status === 'ready').length,
    review: Object.values(statusByVm).filter((status) => status === 'review').length,
    blocked: Object.values(statusByVm).filter((status) => status === 'blocked').length,
    findings,
    statusByVm,
  }
}
