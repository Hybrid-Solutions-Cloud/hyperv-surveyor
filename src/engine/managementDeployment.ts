import type { PlaneId } from '../data/managementPlane'
import type { Vm } from './types'

export type ManagementFoundation = 'classic' | 'scvmm'
export type WacExperience = 'none' | 'wac-admin' | 'wac-virtual'
export type MonitoringSolution = 'none' | 'scom'
export type ScomSqlPlacement = 'dedicated' | 'shared-vmm'
export type ArcServiceId = 'update-manager' | 'azure-monitor' | 'defender-for-servers' | 'machine-configuration' | 'change-tracking'
export type ManagementScale = 'small' | 'medium' | 'large' | 'beyond-tested-scale'
export type DeploymentBasis = 'MS' | 'MS-REC' | 'TOOL'

export interface ManagementDeploymentInputs {
  foundation: ManagementFoundation
  wac: WacExperience
  includeArc: boolean
  monitoring: MonitoringSolution
  /** Legacy persisted value used as the fallback for the independent HA choices. */
  highAvailability?: boolean
  fabricHighAvailability?: boolean
  scomHighAvailability?: boolean
  scomSqlPlacement?: ScomSqlPlacement
  arcServices?: ArcServiceId[]
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
  arcServices: ArcServicePlan[]
  dependencies: string[]
  cautions: string[]
  totalInstances: number
  totalVCpu: number
  totalRamGiB: number
  totalDiskGiB: number
}

export interface ArcServicePlan {
  id: 'core-management' | ArcServiceId
  name: string
  category: 'Core management' | 'Add-on service'
  billing: string
  requirement: string
  source: string
}

export type ResolvedManagementDeploymentInputs = ManagementDeploymentInputs & {
  highAvailability: boolean
  fabricHighAvailability: boolean
  scomHighAvailability: boolean
  scomSqlPlacement: ScomSqlPlacement
  arcServices: ArcServiceId[]
}

const SRC = {
  vmm: 'https://learn.microsoft.com/system-center/vmm/system-requirements?view=sc-vmm-2025',
  vmmHa: 'https://learn.microsoft.com/system-center/vmm/plan-ha-install?view=sc-vmm-2025',
  wac: 'https://learn.microsoft.com/windows-server/manage/windows-admin-center/plan/installation-options',
  wacHa: 'https://learn.microsoft.com/windows-server/manage/windows-admin-center/deploy/high-availability',
  wacVirtual: 'https://learn.microsoft.com/windows-server/manage/windows-admin-center/install-virtualization-mode',
  arcQuickstart: 'https://learn.microsoft.com/azure/azure-arc/system-center-virtual-machine-manager/quickstart-connect-system-center-virtual-machine-manager-to-arc',
  arcGuestManagement: 'https://learn.microsoft.com/azure/azure-arc/system-center-virtual-machine-manager/enable-guest-management-at-scale',
  arcPricing: 'https://azure.microsoft.com/pricing/details/azure-arc/core-control-plane/',
  updateManager: 'https://learn.microsoft.com/azure/update-manager/workflow-update-manager',
  azureMonitor: 'https://learn.microsoft.com/azure/azure-arc/servers/azure-monitor-agent-deployment',
  defenderServers: 'https://learn.microsoft.com/azure/defender-for-cloud/defender-for-servers-overview',
  machineConfiguration: 'https://learn.microsoft.com/azure/governance/machine-configuration/',
  changeTracking: 'https://learn.microsoft.com/azure/automation/change-tracking/overview',
  scom: 'https://learn.microsoft.com/system-center/scom/system-requirements?view=sc-om-2025',
  scomSingle: 'https://learn.microsoft.com/system-center/scom/deploy-single-server?view=sc-om-2025',
  scomHa: 'https://learn.microsoft.com/system-center/scom/plan-hadr-design?view=sc-om-2025',
  scomSql: 'https://learn.microsoft.com/system-center/scom/plan-sqlserver-design?view=sc-om-2025',
  scomDesign: 'https://learn.microsoft.com/system-center/scom/plan-mgmt-group-design?view=sc-om-2025',
}

export const ARC_SERVICE_CATALOG: readonly ArcServicePlan[] = [
  {
    id: 'update-manager',
    name: 'Azure Update Manager',
    category: 'Add-on service',
    billing: 'Metered per Arc-enabled server unless a qualifying entitlement covers it.',
    requirement: 'Azure Connected Machine agent plus Update Manager extensions on each selected guest.',
    source: SRC.updateManager,
  },
  {
    id: 'azure-monitor',
    name: 'Azure Monitor and Log Analytics',
    category: 'Add-on service',
    billing: 'Usage-based ingestion, retention, alerts, and enabled insight charges can apply.',
    requirement: 'Azure Connected Machine agent, Azure Monitor Agent, data collection rules, and a Log Analytics workspace.',
    source: SRC.azureMonitor,
  },
  {
    id: 'defender-for-servers',
    name: 'Microsoft Defender for Servers',
    category: 'Add-on service',
    billing: 'Paid Defender for Servers Plan 1 or Plan 2 subscription.',
    requirement: 'Arc-enabled server resources onboarded to Microsoft Defender for Cloud.',
    source: SRC.defenderServers,
  },
  {
    id: 'machine-configuration',
    name: 'Azure Machine Configuration',
    category: 'Add-on service',
    billing: 'Metered for Arc-enabled servers unless a qualifying entitlement covers it.',
    requirement: 'Azure Connected Machine agent, Machine Configuration extension, and Azure Policy assignments.',
    source: SRC.machineConfiguration,
  },
  {
    id: 'change-tracking',
    name: 'Change Tracking and Inventory',
    category: 'Add-on service',
    billing: 'Azure Arc service and Log Analytics ingestion or retention charges can apply.',
    requirement: 'Azure Connected Machine agent, Azure Monitor Agent, Change Tracking extension, and a Log Analytics workspace.',
    source: SRC.changeTracking,
  },
] as const

const ARC_CORE_SERVICE: ArcServicePlan = {
  id: 'core-management',
  name: 'Azure Arc core management',
  category: 'Core management',
  billing: 'No additional charge for the Azure Arc core control plane; enabled add-on services are billed separately.',
  requirement: 'Arc resource bridge for SCVMM inventory and VM lifecycle management. A guest agent is not required for core SCVMM projection.',
  source: SRC.arcPricing,
}

export function normalizeManagementDeploymentInputs(inputs: ManagementDeploymentInputs): ResolvedManagementDeploymentInputs {
  const legacyHa = inputs.highAvailability ?? true
  const knownArcServices = new Set(ARC_SERVICE_CATALOG.map((service) => service.id))
  return {
    ...inputs,
    highAvailability: legacyHa,
    fabricHighAvailability: inputs.fabricHighAvailability ?? legacyHa,
    scomHighAvailability: inputs.scomHighAvailability ?? legacyHa,
    scomSqlPlacement: inputs.scomSqlPlacement ?? 'dedicated',
    arcServices: (inputs.arcServices ?? []).filter((service): service is ArcServiceId => knownArcServices.has(service)),
  }
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
  recommendations: Partial<Pick<ManagementDeploymentInputs, 'monitoring' | 'highAvailability'>> = {},
): ManagementDeploymentInputs {
  const highAvailability = recommendations.highAvailability ?? true
  return {
    foundation: stack.includes('scvmm') || stack.includes('arc-scvmm') ? 'scvmm' : 'classic',
    wac: stack.includes('wac-virtual') ? 'wac-virtual' : stack.includes('wac-admin') ? 'wac-admin' : 'none',
    includeArc: stack.includes('arc-scvmm'),
    monitoring: recommendations.monitoring ?? 'none',
    highAvailability,
    fabricHighAvailability: highAvailability,
    scomHighAvailability: highAvailability,
    scomSqlPlacement: 'dedicated',
    arcServices: [],
    managedHosts: Math.max(0, managedHosts),
    managedVms: Math.max(0, managedVms),
    managedClusters: 1,
    libraryContentGiB: 500,
    includeIdentityServices: false,
  }
}

export function planManagementDeployment(inputs: ManagementDeploymentInputs): ManagementDeploymentPlan {
  const resolved = normalizeManagementDeploymentInputs(inputs)
  const fabricHa = resolved.fabricHighAvailability
  const scomHa = resolved.scomHighAvailability
  const hosts = Math.max(0, Math.round(inputs.managedHosts))
  const vms = Math.max(0, Math.round(inputs.managedVms))
  const clusters = Math.max(1, Math.round(inputs.managedClusters))
  const scale = scaleFor(hosts, vms)
  const components: ManagementComponent[] = []
  const arcServices: ArcServicePlan[] = []
  const dependencies = new Set<string>()
  const cautions: string[] = []

  if (inputs.includeIdentityServices) {
    components.push(component({
      id: 'identity',
      name: 'Active Directory Domain Services / DNS',
      role: 'Identity, service discovery, Kerberos, and management-plane name resolution.',
      count: fabricHa ? 2 : 1,
      vCpu: 2,
      ramGiB: 8,
      diskGiB: 100,
      availability: fabricHa ? 'Two independent domain controllers' : 'Standalone',
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
      count: fabricHa ? 2 : 1,
      ...vmmSize,
      availability: fabricHa ? 'Windows failover cluster · active/passive' : 'Standalone',
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
      count: fabricHa ? 2 : 1,
      ...sqlSize,
      availability: fabricHa ? 'Always On availability group · synchronous commit' : 'Standalone',
      basis: scale === 'small' ? 'MS-REC' : 'TOOL',
      basisDetail: scale === 'small'
        ? 'Microsoft recommended VMM database resources.'
        : 'Microsoft recommendation with Surveyor memory and disk headroom for the selected estate size.',
      operatingSystem: 'Windows Server 2025 + supported SQL Server',
      licensing: 'SQL Server licensing must be confirmed with the licensing provider',
      source: fabricHa ? SRC.vmmHa : SRC.vmm,
      notes: ['Keep SQL separate from the VMM failover cluster.', 'Confirm System Center SQL runtime rights before removing SQL from the cost model.'],
    }))

    components.push(component({
      id: 'library',
      name: 'VMM library server',
      role: 'Templates, profiles, scripts, ISO images, and deployment content.',
      count: fabricHa ? 2 : 1,
      vCpu: 4,
      ramGiB: 8,
      diskGiB: 100,
      availability: fabricHa ? 'Highly available file-service role' : 'Standalone file server',
      basisDetail: 'Microsoft recommends 4 cores and 4 GB RAM; Surveyor adds RAM and a 100 GiB OS disk allowance.',
      operatingSystem: 'Windows Server 2025',
      licensing: 'Windows Server guest licensing applies',
      source: fabricHa ? SRC.vmmHa : SRC.vmm,
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
      availability: fabricHa ? 'Clustered shared storage' : 'Library data volume',
      basisDetail: 'Editable Surveyor content-capacity allowance; size it from the actual template and media library.',
      operatingSystem: 'Presented to the VMM library service',
      licensing: 'Storage platform licensing applies',
      source: fabricHa ? SRC.vmmHa : SRC.vmm,
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
      count: fabricHa ? 2 : 1,
      ...wacSize,
      availability: fabricHa ? 'Failover cluster · active/passive' : 'Standalone gateway',
      basisDetail: 'Surveyor gateway profile; Microsoft documents the HA topology but does not publish a workload sizing formula.',
      operatingSystem: 'Windows Server 2025',
      licensing: 'Windows Admin Center is included at no additional charge',
      source: fabricHa ? SRC.wacHa : SRC.wac,
      notes: fabricHa ? ['Reserve a 10 GiB CSV for persistent gateway data.'] : [],
    }))
    if (fabricHa) {
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
    if (fabricHa) cautions.push('Virtualization Mode is still preview and Microsoft has not published an HA deployment. The plan keeps one gateway and flags the availability gap.')
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
        source: SRC.arcQuickstart,
        notes: [
          'This is a separate on-premises appliance VM deployed into the SCVMM-managed fabric; it is not installed on the VMM server.',
          'VMM server and resource bridge have a 1:1 mapping.',
          'Reserve three static IP addresses, including a second appliance VM IP used when an upgrade creates a replacement VM.',
          'Requires outbound connectivity and internal/external DNS resolution.',
        ],
      }))
      dependencies.add('Azure subscription, resource group, and appropriate Azure RBAC')
      dependencies.add('Three static IP addresses and required outbound firewall allow-list')
      arcServices.push(ARC_CORE_SERVICE)
      const selectedAddOns = ARC_SERVICE_CATALOG.filter((service) => resolved.arcServices.includes(service.id as ArcServiceId))
      arcServices.push(...selectedAddOns)
      if (selectedAddOns.length > 0) {
        dependencies.add('Azure Connected Machine agent on every SCVMM VM selected for guest-level Azure services')
        dependencies.add('Guest-agent outbound connectivity, Azure Policy/RBAC assignments, and service-specific Azure extensions')
      }
    }
  }

  if (inputs.monitoring === 'scom') {
    const monitoredComputers = hosts + vms
    const publishedManagementServers = Math.max(1, Math.ceil(monitoredComputers / 3_000))
    const managementSize = scaledSize(scale, {
      small: { vCpu: 4, ramGiB: 8, diskGiB: 100 },
      medium: { vCpu: 8, ramGiB: 16, diskGiB: 150 },
      large: { vCpu: 8, ramGiB: 32, diskGiB: 200 },
    })
    const databaseSize = scaledSize(scale, {
      small: { vCpu: 16, ramGiB: 32, diskGiB: 500 },
      medium: { vCpu: 16, ramGiB: 64, diskGiB: 1_000 },
      large: { vCpu: 24, ramGiB: 128, diskGiB: 2_000 },
    })
    if (!scomHa) {
      const singleServerSize = scaledSize(scale, {
        small: { vCpu: 16, ramGiB: 48, diskGiB: 800 },
        medium: { vCpu: 24, ramGiB: 96, diskGiB: 1_500 },
        large: { vCpu: 32, ramGiB: 160, diskGiB: 2_500 },
      })
      components.push(component({
        id: 'scom-all-in-one',
        name: 'SCOM single-server management group',
        role: `Combines the management server, operational and data warehouse databases, reporting, web console, and Operations console for approximately ${monitoredComputers.toLocaleString()} managed computers.`,
        count: 1,
        ...singleServerSize,
        availability: 'Single server · all coexisting SCOM roles · no redundancy',
        basis: 'TOOL',
        basisDetail: 'Surveyor combined-role planning profile. Microsoft documents the topology but positions it primarily for evaluation, testing, and only the smallest production loads.',
        operatingSystem: 'Windows Server 2025 Desktop Experience + supported SQL Server and SSRS',
        licensing: 'System Center and SQL Server licensing rights must be confirmed',
        source: SRC.scomSingle,
        notes: [
          'Includes the OperationsManager, OperationsManagerDW, reporting, management server, and web console roles on one VM.',
          'No management-server agent failover or database failover is provided.',
          'Use SSRS native mode and validate SQL collation, Full-Text Search, retention, growth, and storage IOPS.',
        ],
      }))
      cautions.push('Microsoft positions the SCOM single-server topology mainly for evaluation, testing, management-pack development, and only the smallest production loads. Use distributed SCOM with HA for a production service that requires redundancy or meaningful scale.')
      if (resolved.scomSqlPlacement === 'shared-vmm') cautions.push('The shared VMM SQL selection is ignored for single-server SCOM because the all-in-one topology keeps the SCOM databases on the SCOM server.')
    } else {
      const managementServerCount = Math.max(2, publishedManagementServers)
      components.push(component({
        id: 'scom-management',
        name: 'SCOM management server',
        role: `Health, alert, performance, and availability monitoring for approximately ${monitoredComputers.toLocaleString()} managed computers.`,
        count: managementServerCount,
        ...managementSize,
        availability: 'Management server resource pool · agent failover',
        basis: scale === 'small' ? 'MS' : 'TOOL',
        basisDetail: scale === 'small'
          ? 'Microsoft-published minimum compute and 3,000 agent-managed computers per management server; Surveyor adds a 100 GiB OS/application disk allowance.'
          : 'Microsoft scale limit with a visible Surveyor compute and disk profile for the selected estate size.',
        operatingSystem: 'Windows Server 2025',
        licensing: 'System Center management licenses; confirm edition and managed OSE rights',
        source: SRC.scomHa,
        notes: ['Install the required OLE DB and ODBC SQL drivers on every management server.', 'Management servers and databases should remain on the same low-latency LAN.'],
      }))

      const shareVmmSql = resolved.scomSqlPlacement === 'shared-vmm' && inputs.foundation === 'scvmm' && fabricHa
      if (shareVmmSql) {
        const sharedSql = components.find((item) => item.id === 'sql')
        if (sharedSql) {
          sharedSql.name = 'Shared SQL Server for VMM and SCOM databases'
          sharedSql.role = 'Hosts separate VMM, OperationsManager, and OperationsManagerDW databases on one SQL Always On replica pair.'
          sharedSql.count = 2
          sharedSql.vCpu += databaseSize.vCpu
          sharedSql.ramGiB += databaseSize.ramGiB
          sharedSql.diskGiB += databaseSize.diskGiB
          sharedSql.availability = 'Shared SQL Always On infrastructure · separate application databases'
          sharedSql.basis = 'TOOL'
          sharedSql.basisDetail = 'Additive consolidated Surveyor profile. Microsoft documents Always On for both products but does not publish a universal combined VMM/SCOM SQL sizing profile.'
          sharedSql.source = SRC.scomSql
          sharedSql.notes.push(
            'Validate a SQL version and collation supported by both products, combined CPU/RAM/IOPS, backup windows, and the AG/listener design.',
            'Keep the VMM and SCOM application databases separate; do not share the SCOM SSRS instance with other reporting applications.',
          )
          dependencies.add('SQL Always On listener, logins, SPNs, and failover validation for both VMM and SCOM')
        }
      } else {
        if (resolved.scomSqlPlacement === 'shared-vmm' && !fabricHa) {
          cautions.push('Sharing the VMM SQL Always On infrastructure requires SCVMM / WAC high availability. The plan uses a dedicated SCOM SQL Always On pair while the fabric foundation is standalone.')
        }
        components.push(component({
          id: 'scom-sql',
          name: 'SQL Server for SCOM databases',
          role: 'Hosts the OperationsManager operational database and OperationsManagerDW reporting data warehouse.',
          count: 2,
          ...databaseSize,
          availability: 'Dedicated Always On availability group',
          basis: 'TOOL',
          basisDetail: 'Surveyor planning profile because Microsoft directs architects to workload sizing rather than publishing one universal SQL VM size.',
          operatingSystem: 'Windows Server 2025 + supported SQL Server',
          licensing: 'SQL Server licensing must be confirmed with the licensing provider',
          source: SRC.scomSql,
          notes: ['SQL Server Full-Text Search and a supported collation are required.', 'Validate database growth, retention, management packs, and storage IOPS with the Operations Manager Sizing Helper.'],
        }))
      }

      components.push(component({
        id: 'scom-reporting',
        name: 'SCOM reporting server',
        role: 'Operations Manager reporting integrated with SQL Server Reporting Services in native mode.',
        count: 1,
        vCpu: 4,
        ramGiB: 8,
        diskGiB: 100,
        availability: 'Dedicated reporting role · no automatic HA topology',
        basis: 'TOOL',
        basisDetail: 'Microsoft publishes a 4-core, 8 GiB minimum and recommends a dedicated reporting system; Surveyor adds a 100 GiB OS/application disk allowance.',
        operatingSystem: 'Windows Server 2025 Desktop Experience + supported SSRS',
        licensing: 'System Center and SQL Server reporting rights must be confirmed',
        source: SRC.scomDesign,
        notes: ['Use SSRS native mode.', 'Do not share the SSRS instance with other reporting applications.'],
      }))

      components.push(component({
        id: 'scom-web',
        name: 'SCOM web console server',
        role: 'Browser access to Monitoring and My Workspace views.',
        count: 1,
        vCpu: 4,
        ramGiB: 8,
        diskGiB: 100,
        availability: 'Standalone web console role',
        basis: 'TOOL',
        basisDetail: 'Microsoft-published 4-core, 8 GiB minimum with a Surveyor 100 GiB OS/application disk allowance.',
        operatingSystem: 'Windows Server 2025 Desktop Experience + IIS',
        licensing: 'System Center management licensing applies',
        source: SRC.scom,
        notes: ['Microsoft does not support Network Load Balancing for the Operations Manager web console server.'],
      }))
      cautions.push('The SCOM management servers and databases are redundant, but the calculated reporting and web console roles remain single instances and require a documented recovery procedure.')
    }

    dependencies.add('SCOM service accounts for management, data access, data warehouse write, and reporting data reader roles')
    dependencies.add('SCOM agents and applicable Microsoft or vendor management packs for monitored workloads')
    dependencies.add('SQL Server Full-Text Search, supported collation, SSRS native mode, and current SQL client drivers')
    if (!inputs.includeIdentityServices) dependencies.add('Existing healthy Active Directory and DNS services for SCOM authentication and discovery')
    cautions.push('SCOM database performance is storage-I/O sensitive. Validate database growth, retention, and IOPS before production deployment.')
    cautions.push('Do not checkpoint, pause, or save-state virtual machines running SCOM components; Microsoft does not support those virtualization operations.')
  }

  if (scale === 'beyond-tested-scale') {
    cautions.push('The selected estate exceeds the published 1,000-host or 25,000-VM scale of one VMM or WAC Virtualization Mode instance. Split the management estate and validate the topology with Microsoft.')
  }
  if (inputs.foundation === 'classic' && inputs.wac === 'none' && inputs.monitoring === 'none' && !inputs.includeIdentityServices) {
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
    arcServices,
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
