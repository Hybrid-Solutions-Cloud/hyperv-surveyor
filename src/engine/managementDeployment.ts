import type { PlaneId } from '../data/managementPlane'
import type { Vm } from './types'

export type ManagementFoundation = 'classic' | 'scvmm'
export type WacExperience = 'none' | 'wac-admin' | 'wac-virtual'
export type ManagementScale = 'small' | 'medium' | 'large' | 'beyond-tested-scale'
export type DeploymentBasis = 'MS' | 'MS-REC' | 'TOOL'

export interface ManagementDeploymentInputs {
  foundation: ManagementFoundation
  wac: WacExperience
  includeArc: boolean
  highAvailability: boolean
  managedHosts: number
  managedVms: number
  managedClusters: number
  libraryContentGiB: number
  includeIdentityServices: boolean
}

export interface ManagementComponent {
  id: string
  resourceType: 'vm' | 'shared-storage'
  name: string
  role: string
  count: number
  vCpu: number
  ramGiB: number
  diskGiB: number
  availability: string
  basis: DeploymentBasis
  basisDetail: string
  operatingSystem: string
  licensing: string
  source: string
  notes: string[]
}

export interface ManagementDeploymentPlan {
  scale: ManagementScale
  scaleLabel: string
  components: ManagementComponent[]
  dependencies: string[]
  cautions: string[]
  totalInstances: number
  totalVCpu: number
  totalRamGiB: number
  totalDiskGiB: number
}

const SRC = {
  vmm: 'https://learn.microsoft.com/system-center/vmm/system-requirements?view=sc-vmm-2025',
  vmmHa: 'https://learn.microsoft.com/system-center/vmm/plan-ha-install?view=sc-vmm-2025',
  wac: 'https://learn.microsoft.com/windows-server/manage/windows-admin-center/plan/installation-options',
  wacHa: 'https://learn.microsoft.com/windows-server/manage/windows-admin-center/deploy/high-availability',
  wacVirtual: 'https://learn.microsoft.com/windows-server/manage/windows-admin-center/install-virtualization-mode',
  arc: 'https://learn.microsoft.com/azure/azure-arc/system-center-virtual-machine-manager/support-matrix-for-system-center-virtual-machine-manager',
}

function scaleFor(hosts: number, vms: number): ManagementScale {
  if (hosts > 1_000 || vms > 25_000) return 'beyond-tested-scale'
  if (hosts > 250 || vms > 5_000) return 'large'
  if (hosts > 50 || vms > 1_000) return 'medium'
  return 'small'
}

function scaledSize(
  scale: ManagementScale,
  sizes: Record<'small' | 'medium' | 'large', { vCpu: number; ramGiB: number; diskGiB: number }>,
) {
  return sizes[scale === 'beyond-tested-scale' ? 'large' : scale]
}

function component(
  value: Omit<ManagementComponent, 'basis' | 'resourceType'> & {
    basis?: DeploymentBasis
    resourceType?: ManagementComponent['resourceType']
  },
): ManagementComponent {
  return { ...value, basis: value.basis ?? 'TOOL', resourceType: value.resourceType ?? 'vm' }
}

export function deploymentInputsFromStack(
  stack: PlaneId[],
  managedHosts: number,
  managedVms: number,
): ManagementDeploymentInputs {
  return {
    foundation: stack.includes('scvmm') || stack.includes('arc-scvmm') ? 'scvmm' : 'classic',
    wac: stack.includes('wac-virtual') ? 'wac-virtual' : stack.includes('wac-admin') ? 'wac-admin' : 'none',
    includeArc: stack.includes('arc-scvmm'),
    highAvailability: true,
    managedHosts: Math.max(0, managedHosts),
    managedVms: Math.max(0, managedVms),
    managedClusters: 1,
    libraryContentGiB: 500,
    includeIdentityServices: false,
  }
}

export function planManagementDeployment(inputs: ManagementDeploymentInputs): ManagementDeploymentPlan {
  const hosts = Math.max(0, Math.round(inputs.managedHosts))
  const vms = Math.max(0, Math.round(inputs.managedVms))
  const clusters = Math.max(1, Math.round(inputs.managedClusters))
  const scale = scaleFor(hosts, vms)
  const components: ManagementComponent[] = []
  const dependencies = new Set<string>()
  const cautions: string[] = []

  if (inputs.includeIdentityServices) {
    components.push(component({
      id: 'identity',
      name: 'Active Directory Domain Services / DNS',
      role: 'Identity, service discovery, Kerberos, and management-plane name resolution.',
      count: inputs.highAvailability ? 2 : 1,
      vCpu: 2,
      ramGiB: 8,
      diskGiB: 100,
      availability: inputs.highAvailability ? 'Two independent domain controllers' : 'Standalone',
      basisDetail: 'Surveyor planning profile; domain sizing depends on the wider identity estate.',
      operatingSystem: 'Windows Server 2025',
      licensing: 'Windows Server guest licensing applies',
      source: '',
      notes: ['Place redundant domain controllers in separate failure domains when possible.'],
    }))
  } else {
    dependencies.add('Existing highly available Active Directory and DNS services')
  }

  if (inputs.foundation === 'scvmm') {
    const vmmSize = scaledSize(scale, {
      small: { vCpu: 16, ramGiB: 16, diskGiB: 100 },
      medium: { vCpu: 16, ramGiB: 24, diskGiB: 150 },
      large: { vCpu: 16, ramGiB: 32, diskGiB: 200 },
    })
    const sqlSize = scaledSize(scale, {
      small: { vCpu: 16, ramGiB: 16, diskGiB: 200 },
      medium: { vCpu: 16, ramGiB: 32, diskGiB: 300 },
      large: { vCpu: 16, ramGiB: 64, diskGiB: 500 },
    })

    components.push(component({
      id: 'vmm',
      name: 'System Center VMM management server',
      role: `Fabric management for ${hosts.toLocaleString()} hosts across ${clusters.toLocaleString()} cluster${clusters === 1 ? '' : 's'}.`,
      count: inputs.highAvailability ? 2 : 1,
      ...vmmSize,
      availability: inputs.highAvailability ? 'Windows failover cluster · active/passive' : 'Standalone',
      basis: scale === 'small' ? 'MS-REC' : 'TOOL',
      basisDetail: scale === 'small'
        ? 'Microsoft recommended compute, plus a Surveyor 100 GiB OS/application disk allowance.'
        : 'Microsoft recommended compute with Surveyor scale headroom for the selected estate size.',
      operatingSystem: 'Windows Server 2025',
      licensing: 'System Center Datacenter or Standard management licenses',
      source: SRC.vmm,
      notes: ['Install Windows ADK on every VMM management node.', 'Do not install the VMM server on a Hyper-V parent partition.'],
    }))

    components.push(component({
      id: 'sql',
      name: 'SQL Server for the VMM database',
      role: 'VMM configuration and operational database.',
      count: inputs.highAvailability ? 2 : 1,
      ...sqlSize,
      availability: inputs.highAvailability ? 'Always On availability group · synchronous commit' : 'Standalone',
      basis: scale === 'small' ? 'MS-REC' : 'TOOL',
      basisDetail: scale === 'small'
        ? 'Microsoft recommended VMM database resources.'
        : 'Microsoft recommendation with Surveyor memory and disk headroom for the selected estate size.',
      operatingSystem: 'Windows Server 2025 + supported SQL Server',
      licensing: 'SQL Server licensing must be confirmed with the licensing provider',
      source: inputs.highAvailability ? SRC.vmmHa : SRC.vmm,
      notes: ['Keep SQL separate from the VMM failover cluster.', 'Confirm System Center SQL runtime rights before removing SQL from the cost model.'],
    }))

    components.push(component({
      id: 'library',
      name: 'VMM library server',
      role: 'Templates, profiles, scripts, ISO images, and deployment content.',
      count: inputs.highAvailability ? 2 : 1,
      vCpu: 4,
      ramGiB: 8,
      diskGiB: 100,
      availability: inputs.highAvailability ? 'Highly available file-service role' : 'Standalone file server',
      basisDetail: 'Microsoft recommends 4 cores and 4 GB RAM; Surveyor adds RAM and a 100 GiB OS disk allowance.',
      operatingSystem: 'Windows Server 2025',
      licensing: 'Windows Server guest licensing applies',
      source: inputs.highAvailability ? SRC.vmmHa : SRC.vmm,
      notes: ['An HA library is not created automatically with HA VMM.', 'Do not place the HA library role on the VMM cluster.'],
    }))
    components.push(component({
      id: 'library-content',
      resourceType: 'shared-storage',
      name: 'VMM library content storage',
      role: 'Shared capacity for templates, profiles, scripts, ISO images, and deployment content.',
      count: 1,
      vCpu: 0,
      ramGiB: 0,
      diskGiB: Math.max(100, Math.round(inputs.libraryContentGiB)),
      availability: inputs.highAvailability ? 'Clustered shared storage' : 'Library data volume',
      basisDetail: 'Editable Surveyor content-capacity allowance; size it from the actual template and media library.',
      operatingSystem: 'Presented to the VMM library service',
      licensing: 'Storage platform licensing applies',
      source: inputs.highAvailability ? SRC.vmmHa : SRC.vmm,
      notes: ['Counted once as shared capacity rather than duplicated on every library node.'],
    }))

    dependencies.add('VMM service account and distributed key management container in Active Directory')
    dependencies.add('Kerberos SPNs for clustered SQL')
  }

  if (inputs.wac === 'wac-admin') {
    const wacSize = scaledSize(scale, {
      small: { vCpu: 4, ramGiB: 8, diskGiB: 100 },
      medium: { vCpu: 8, ramGiB: 16, diskGiB: 150 },
      large: { vCpu: 8, ramGiB: 24, diskGiB: 200 },
    })
    components.push(component({
      id: 'wac-admin',
      name: 'Windows Admin Center Administration Mode gateway',
      role: 'Browser-based day-two administration for servers and clusters.',
      count: inputs.highAvailability ? 2 : 1,
      ...wacSize,
      availability: inputs.highAvailability ? 'Failover cluster · active/passive' : 'Standalone gateway',
      basisDetail: 'Surveyor gateway profile; Microsoft documents the HA topology but does not publish a workload sizing formula.',
      operatingSystem: 'Windows Server 2025',
      licensing: 'Windows Admin Center is included at no additional charge',
      source: inputs.highAvailability ? SRC.wacHa : SRC.wac,
      notes: inputs.highAvailability ? ['Reserve a 10 GiB CSV for persistent gateway data.'] : [],
    }))
    if (inputs.highAvailability) {
      components.push(component({
        id: 'wac-data',
        resourceType: 'shared-storage',
        name: 'Windows Admin Center gateway data CSV',
        role: 'Persistent gateway data shared by the active/passive WAC cluster.',
        count: 1,
        vCpu: 0,
        ramGiB: 0,
        diskGiB: 10,
        availability: 'Cluster Shared Volume',
        basis: 'MS',
        basisDetail: 'Microsoft-published CSV requirement for a highly available WAC gateway.',
        operatingSystem: 'Presented to the WAC failover cluster',
        licensing: 'Storage platform licensing applies',
        source: SRC.wacHa,
        notes: [],
      }))
    }
    dependencies.add('Trusted TLS certificate and DNS name for the WAC gateway')
  }

  if (inputs.wac === 'wac-virtual') {
    const wacSize = scaledSize(scale, {
      small: { vCpu: 4, ramGiB: 8, diskGiB: 100 },
      medium: { vCpu: 8, ramGiB: 16, diskGiB: 150 },
      large: { vCpu: 8, ramGiB: 24, diskGiB: 200 },
    })
    components.push(component({
      id: 'wac-virtual',
      name: 'Windows Admin Center Virtualization Mode gateway',
      role: 'Stateful virtualization-fabric gateway with PostgreSQL and per-host agents.',
      count: 1,
      ...wacSize,
      availability: 'Standalone · HA is not documented for Virtualization Mode preview',
      basis: scale === 'small' ? 'MS' : 'TOOL',
      basisDetail: scale === 'small'
        ? 'Microsoft minimum compute with a Surveyor 100 GiB OS/database disk allowance.'
        : 'Microsoft minimum with Surveyor scale headroom for the selected estate size.',
      operatingSystem: 'Windows Server 2025 Standard or Datacenter',
      licensing: 'Windows Admin Center is included at no additional charge',
      source: SRC.wacVirtual,
      notes: ['PostgreSQL is installed as part of the gateway deployment.', 'Administration Mode must be installed on a separate system.'],
    }))
    dependencies.add('FQDN DNS resolution and TLS for gateway-to-agent communication')
    if (inputs.highAvailability) cautions.push('Virtualization Mode is still preview and Microsoft has not published an HA deployment. The plan keeps one gateway and flags the availability gap.')
  }

  if (inputs.includeArc) {
    if (inputs.foundation !== 'scvmm') {
      cautions.push('Arc-enabled SCVMM requires SCVMM underneath it. Select SCVMM as the fabric foundation to include the resource bridge.')
    } else {
      components.push(component({
        id: 'arc-bridge',
        name: 'Azure Arc resource bridge appliance',
        role: 'Persistent connection between the SCVMM fabric and Azure Resource Manager.',
        count: 1,
        vCpu: 4,
        ramGiB: 32,
        diskGiB: 100,
        availability: 'Managed appliance lifecycle',
        basis: 'MS',
        basisDetail: 'Published minimum free capacity for Arc-enabled SCVMM.',
        operatingSystem: 'Microsoft-managed appliance',
        licensing: 'Connector is free; attached Azure services are metered',
        source: SRC.arc,
        notes: ['Reserve three static IP addresses.', 'Requires outbound connectivity and internal/external DNS resolution.'],
      }))
      dependencies.add('Azure subscription, resource group, and appropriate Azure RBAC')
      dependencies.add('Three static IP addresses and required outbound firewall allow-list')
    }
  }

  if (scale === 'beyond-tested-scale') {
    cautions.push('The selected estate exceeds the published 1,000-host or 25,000-VM scale of one VMM or WAC Virtualization Mode instance. Split the management estate and validate the topology with Microsoft.')
  }
  if (inputs.foundation === 'classic' && inputs.wac === 'none' && !inputs.includeIdentityServices) {
    cautions.push('Classic Hyper-V tools require no dedicated management VM. Existing AD/DNS and operator workstations remain external dependencies.')
  }
  if (inputs.wac === 'wac-admin' && hosts > 50) {
    cautions.push('Administration Mode is typically positioned for 1-50 hosts. Use multiple gateways or evaluate SCVMM and Virtualization Mode for a larger estate.')
  }

  const totalInstances = components.reduce((sum, item) => sum + (item.resourceType === 'vm' ? item.count : 0), 0)
  const totalVCpu = components.reduce((sum, item) => sum + item.vCpu * item.count, 0)
  const totalRamGiB = components.reduce((sum, item) => sum + item.ramGiB * item.count, 0)
  const totalDiskGiB = components.reduce((sum, item) => sum + item.diskGiB * item.count, 0)
  const scaleLabel = scale === 'beyond-tested-scale'
    ? 'Beyond one published management instance'
    : `${scale[0].toUpperCase()}${scale.slice(1)} management estate`

  return {
    scale,
    scaleLabel,
    components,
    dependencies: [...dependencies],
    cautions,
    totalInstances,
    totalVCpu,
    totalRamGiB,
    totalDiskGiB,
  }
}

export function deploymentComponentsToVms(components: ManagementComponent[]): Vm[] {
  return components.filter((item) => item.resourceType === 'vm').flatMap((item) => Array.from({ length: item.count }, (_, index) => ({
    id: `management-${item.id}-${index + 1}`,
    name: `${item.name} ${index + 1}`,
    tier: 'infrastructure' as const,
    vCpu: item.vCpu,
    ramGiB: item.ramGiB,
    storageGiB: item.diskGiB,
    provisionedGiB: item.diskGiB,
    powerState: 'poweredOn' as const,
    include: true,
    notes: `${item.availability}. ${item.basisDetail}`,
  })))
}
