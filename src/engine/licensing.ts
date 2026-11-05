/**
 * Licensing estimate (audit section E). Quantities come from the resolved platform design, never from
 * separate inputs, so the Cost Model tab, the report and the workbook price the same hosts and VMs.
 *
 * The estimate is a planning figure, not a quote. Every price carries its date, source and confidence
 * (src/data/priceBook.ts). A price the tool could not verify on a Microsoft or Azure page is shown as
 * "quote required" in the report and left out of the report totals.
 *
 * Rules, each checked on 2026-11-05 at the URL given:
 * - System Center includes the SQL Server technology it uses: "No additional licenses are needed for
 *   management servers or SQL Server technology used in System Center" (SC_PRICING_URL). SQL is $0
 *   unless you choose to license it separately.
 * - Windows Server Standard covers 2 virtual OSEs per fully licensed host and stacks; Datacenter is
 *   unlimited (WS_PRICING_URL). Storage Spaces Direct is in Datacenter only (EDITIONS_URL), so S2D and
 *   hybrid designs are Datacenter.
 * - System Center Standard manages up to two OSEs per license; Datacenter any number (SC_PRICING_URL).
 * - Update Manager, Machine Configuration and Change Tracking are free for a Windows server attested
 *   with Software Assurance or a Windows Server subscription, enrolled in Windows Server pay-as-you-go
 *   or in ESU enabled by Azure Arc (WS_MANAGEMENT_URL, UPDATE_MANAGER_FAQ_URL), and for any Arc-enabled
 *   server, Linux included, in a subscription with Defender for Servers Plan 2 (UPDATE_MANAGER_FAQ_URL,
 *   ESSENTIAL_MANAGEMENT_URL). SPLA is not listed.
 * - Windows Server pay-as-you-go licenses each machine, host and VMs alike, by its cores, with no core
 *   minimum (PAYG_URL, PAYG_BILLING_URL). It needs no Windows Server CALs, but RDS CALs still apply.
 */
import type { PlaneId } from '../data/managementPlane'
import { LOG_ANALYTICS_FREE_GB_PER_MONTH, PRICE_BOOK, PRICE_ENTRIES, type PriceKey } from '../data/priceBook'
import type { ArcServiceId } from './managementDeployment'
import type { PlatformDesign, PlatformPath } from './platformDesign'
import { licensableCores, totalCores } from './compute'
import type { NodeSpec, StorageArchitecture, Vm } from './types'

export const SC_PRICING_URL = 'https://www.microsoft.com/en-us/system-center/pricing'
export const WS_PRICING_URL = 'https://www.microsoft.com/en-us/windows-server/pricing'
export const EDITIONS_URL = 'https://learn.microsoft.com/windows-server/get-started/editions-comparison'
export const WS_MANAGEMENT_URL = 'https://learn.microsoft.com/azure/azure-arc/servers/windows-server-management-overview'
export const UPDATE_MANAGER_FAQ_URL = 'https://learn.microsoft.com/azure/update-manager/update-manager-faq'
export const ESSENTIAL_MANAGEMENT_URL = 'https://learn.microsoft.com/azure/azure-arc/servers/essential-machine-management/enrollment'
export const PAYG_URL = 'https://learn.microsoft.com/windows-server/get-started/windows-server-pay-as-you-go'
export const PAYG_BILLING_URL = 'https://learn.microsoft.com/azure/azure-arc/servers/billing-windows-server-pay-go'
export const MONITOR_PRICING_URL = 'https://azure.microsoft.com/pricing/details/monitor/'
export const AZURE_LOCAL_PRICING_URL = 'https://azure.microsoft.com/pricing/details/azure-local/'

export type LicensingBasis = 'perpetual-sa' | 'spla' | 'csp'
export type EditionChoice = 'auto' | 'datacenter' | 'standard'
export type Edition = 'datacenter' | 'standard'
export type CommercialMotion = 'internal' | 'csp' | 'msp'
export type ArcMeterId = 'updateManager' | 'defenderP2' | 'machineConfig' | 'changeTracking' | 'logAnalytics'
export type FollowDesign = 'design' | 'include' | 'exclude'

export interface CommercialInputs {
  motion: CommercialMotion
  tenantCount: number
  microsoftDiscountPct: number
  licenseMarkupPct: number
  azureMarkupPct: number
  onboardingDeliveryCostPerTenant: number
  onboardingFeePerTenant: number
  monthlyPlatformFeePerTenant: number
  monthlyManagedFeePerVm: number
  monthlyOpsCostPerVm: number
  monthlySharedOpsCost: number
  targetGrossMarginPct: number
  useLighthouse: boolean
}

/** Cost Model inputs. Saved with the project, in browser state and in share links. */
export interface CostModelInputs {
  termYears: number
  basis: LicensingBasis
  windowsEdition: EditionChoice
  systemCenterEdition: EditionChoice
  /** 'system-center-rights': SQL used only by System Center is included ($0). 'separate': priced. */
  sqlLicensing: 'system-center-rights' | 'separate'
  /** Null: the SQL vCPUs of the management bill of materials. */
  sqlCores: number | null
  systemCenter: FollowDesign
  arcServers: FollowDesign
  /** Null: the Arc services chosen in the management design. */
  arcMeters: Record<ArcMeterId, boolean> | null
  /** Meter the Hyper-V hosts as Arc-enabled servers too. */
  meterArcHosts: boolean
  logAnalyticsGbPerServerMonth: number
  /** Qualifying entitlements for the Update Manager, Machine Configuration and Change Tracking waiver. Off by default. */
  entitlements: { windowsSaOrSubscription: boolean; windowsPayg: boolean; esu: boolean }
  windowsCals: { count: number; kind: 'user' | 'device' }
  rds: { inScope: boolean; users: number }
  /** Your rates. Only values you changed are kept. */
  rateOverrides: Partial<Record<PriceKey, number>>
  commercial: CommercialInputs
  /** Null: the plane the management design uses. */
  selectedPlane: PlaneId | null
  /** Adds the "Licensing (estimate, not a quote)" section to the report and a sheet to the workbook. */
  includeInReport: boolean
}

export const DEFAULT_COMMERCIAL_INPUTS: CommercialInputs = {
  motion: 'internal',
  tenantCount: 1,
  microsoftDiscountPct: 0,
  licenseMarkupPct: 8,
  azureMarkupPct: 8,
  onboardingDeliveryCostPerTenant: 1_500,
  onboardingFeePerTenant: 3_000,
  monthlyPlatformFeePerTenant: 1_000,
  monthlyManagedFeePerVm: 55,
  monthlyOpsCostPerVm: 18,
  monthlySharedOpsCost: 2_500,
  targetGrossMarginPct: 35,
  useLighthouse: true,
}

export const DEFAULT_COST_MODEL_INPUTS: CostModelInputs = {
  termYears: 3,
  basis: 'perpetual-sa',
  windowsEdition: 'auto',
  systemCenterEdition: 'auto',
  sqlLicensing: 'system-center-rights',
  sqlCores: null,
  systemCenter: 'design',
  arcServers: 'design',
  arcMeters: null,
  meterArcHosts: false,
  logAnalyticsGbPerServerMonth: 2,
  entitlements: { windowsSaOrSubscription: false, windowsPayg: false, esu: false },
  windowsCals: { count: 0, kind: 'user' },
  rds: { inScope: false, users: 0 },
  rateOverrides: {},
  commercial: { ...DEFAULT_COMMERCIAL_INPUTS },
  selectedPlane: null,
  includeInReport: false,
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
const num = (value: unknown, fallback: number, min = 0, max = Number.POSITIVE_INFINITY) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback

/** Saved Cost Model inputs. Anything missing or malformed takes the default; older saves have none. */
export function normalizeCostModelInputs(value: unknown): CostModelInputs {
  const d = DEFAULT_COST_MODEL_INPUTS
  if (!record(value)) return structuredClone(d)
  const meters = record(value.arcMeters) ? value.arcMeters : null
  const entitlements = record(value.entitlements) ? value.entitlements : {}
  const cals = record(value.windowsCals) ? value.windowsCals : {}
  const rds = record(value.rds) ? value.rds : {}
  const commercial = record(value.commercial) ? value.commercial : {}
  const overrides = record(value.rateOverrides) ? value.rateOverrides : {}
  const dc = DEFAULT_COMMERCIAL_INPUTS
  return {
    termYears: Math.round(num(value.termYears, d.termYears, 1, 10)),
    basis: pick(value.basis, ['perpetual-sa', 'spla', 'csp'] as const, d.basis),
    windowsEdition: pick(value.windowsEdition, ['auto', 'datacenter', 'standard'] as const, d.windowsEdition),
    systemCenterEdition: pick(value.systemCenterEdition, ['auto', 'datacenter', 'standard'] as const, d.systemCenterEdition),
    sqlLicensing: pick(value.sqlLicensing, ['system-center-rights', 'separate'] as const, d.sqlLicensing),
    sqlCores: value.sqlCores === null || value.sqlCores === undefined ? null : num(value.sqlCores, 0),
    systemCenter: pick(value.systemCenter, ['design', 'include', 'exclude'] as const, d.systemCenter),
    arcServers: pick(value.arcServers, ['design', 'include', 'exclude'] as const, d.arcServers),
    arcMeters: meters ? {
      updateManager: bool(meters.updateManager, false),
      defenderP2: bool(meters.defenderP2, false),
      machineConfig: bool(meters.machineConfig, false),
      changeTracking: bool(meters.changeTracking, false),
      logAnalytics: bool(meters.logAnalytics, false),
    } : null,
    meterArcHosts: bool(value.meterArcHosts, d.meterArcHosts),
    logAnalyticsGbPerServerMonth: num(value.logAnalyticsGbPerServerMonth, d.logAnalyticsGbPerServerMonth),
    entitlements: {
      windowsSaOrSubscription: bool(entitlements.windowsSaOrSubscription, false),
      windowsPayg: bool(entitlements.windowsPayg, false),
      esu: bool(entitlements.esu, false),
    },
    windowsCals: { count: Math.round(num(cals.count, 0)), kind: pick(cals.kind, ['user', 'device'] as const, 'user') },
    rds: { inScope: bool(rds.inScope, false), users: Math.round(num(rds.users, 0)) },
    rateOverrides: Object.fromEntries(Object.entries(overrides)
      .filter(([key, rate]) => key in PRICE_ENTRIES && typeof rate === 'number' && Number.isFinite(rate) && rate >= 0)) as Partial<Record<PriceKey, number>>,
    commercial: {
      motion: pick(commercial.motion, ['internal', 'csp', 'msp'] as const, dc.motion),
      tenantCount: Math.max(1, Math.round(num(commercial.tenantCount, dc.tenantCount))),
      microsoftDiscountPct: num(commercial.microsoftDiscountPct, dc.microsoftDiscountPct, 0, 100),
      licenseMarkupPct: num(commercial.licenseMarkupPct, dc.licenseMarkupPct),
      azureMarkupPct: num(commercial.azureMarkupPct, dc.azureMarkupPct),
      onboardingDeliveryCostPerTenant: num(commercial.onboardingDeliveryCostPerTenant, dc.onboardingDeliveryCostPerTenant),
      onboardingFeePerTenant: num(commercial.onboardingFeePerTenant, dc.onboardingFeePerTenant),
      monthlyPlatformFeePerTenant: num(commercial.monthlyPlatformFeePerTenant, dc.monthlyPlatformFeePerTenant),
      monthlyManagedFeePerVm: num(commercial.monthlyManagedFeePerVm, dc.monthlyManagedFeePerVm),
      monthlyOpsCostPerVm: num(commercial.monthlyOpsCostPerVm, dc.monthlyOpsCostPerVm),
      monthlySharedOpsCost: num(commercial.monthlySharedOpsCost, dc.monthlySharedOpsCost),
      targetGrossMarginPct: num(commercial.targetGrossMarginPct, dc.targetGrossMarginPct, 0, 95),
      useLighthouse: bool(commercial.useLighthouse, dc.useLighthouse),
    },
    selectedPlane: (['classic', 'scvmm', 'wac-admin', 'wac-virtual'] as const).includes(value.selectedPlane as PlaneId) ? value.selectedPlane as PlaneId : null,
    includeInReport: bool(value.includeInReport, false),
  }
}

// ---------------------------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------------------------

export type GuestOsFamily = 'windows' | 'linux' | 'unknown'

const LINUX_PATTERN = /linux|ubuntu|red ?hat|rhel|centos|suse|sles|debian|oracle linux|rocky|alma|fedora|photon|freebsd/i

/** The guest OS family from the inventory's guest OS text. Anything unrecognised is unknown. */
export function guestOsFamily(vm: Pick<Vm, 'guestOs'>): GuestOsFamily {
  const os = vm.guestOs?.trim() ?? ''
  if (!os) return 'unknown'
  if (/windows/i.test(os)) return 'windows'
  if (LINUX_PATTERN.test(os)) return 'linux'
  return 'unknown'
}

export interface VmCounts {
  windows: number
  linux: number
  unknown: number
  total: number
  /** vCPUs of Windows and unknown guests, for per-VM pay-as-you-go. */
  windowsOrUnknownVcpu: number
}

export function countVms(vms: Vm[], extraWindows: Vm[] = []): VmCounts {
  const counts: VmCounts = { windows: 0, linux: 0, unknown: 0, total: 0, windowsOrUnknownVcpu: 0 }
  for (const vm of vms) {
    const family = guestOsFamily(vm)
    counts[family] += 1
    counts.total += 1
    if (family !== 'linux') counts.windowsOrUnknownVcpu += Math.max(1, Math.round(vm.vCpu))
  }
  for (const vm of extraWindows) {
    counts.windows += 1
    counts.total += 1
    counts.windowsOrUnknownVcpu += Math.max(1, Math.round(vm.vCpu))
  }
  return counts
}

export interface HostLine {
  label: string
  hosts: number
  sockets: number
  coresPerSocket: number
  physicalCoresPerHost: number
  licensableCoresPerHost: number
}

export interface LicensingScope {
  id: string
  label: string
  role: 'workload' | 'management' | 'existing' | 'addition' | 'managed'
  /** False for your current estate on the fit path: it is shown, not priced. */
  priced: boolean
  architecture: StorageArchitecture | null
  hostLines: HostLine[]
  hosts: number
  spareHosts: number
  workloadHosts: number
  physicalCores: number
  licensableCores: number
  vms: VmCounts
  /** Windows (and unknown) VMs per host for Standard stacking, rounded up. */
  windowsVmsPerHost: number
  /** All VMs per host, for System Center Standard (it manages any OS). */
  managedOsesPerHost: number
  note: string | null
}

export interface LicensingQuantities {
  path: PlatformPath
  engagementMode: PlatformDesign['engagementMode']
  status: 'ready' | 'not-calculated'
  reason: string | null
  label: string
  scopes: LicensingScope[]
  /** Workload VMs you entered (management VMs excluded): the per-VM denominator. */
  realVms: number
  /** False on management-only: the managed hosts' Windows licensing is outside the estimate. */
  windowsClaim: boolean
  validationNote: string | null
  design: {
    plane: PlaneId
    systemCenter: boolean
    /** SCOM is planned: it needs System Center licensing on any plane. */
    scom: boolean
    arc: boolean
    arcMeters: Record<ArcMeterId, boolean>
    arcGuestScopePct: number
    sqlCores: number
  }
}

export const DESIGN_DOES_NOT_FIT = 'Design does not fit: licensing not calculated'

function hostLine(label: string, hosts: number, node: Pick<NodeSpec, 'sockets' | 'coresPerSocket'>): HostLine {
  const spec = node as NodeSpec
  return {
    label,
    hosts,
    sockets: node.sockets,
    coresPerSocket: node.coresPerSocket,
    physicalCoresPerHost: totalCores(spec),
    licensableCoresPerHost: licensableCores(spec),
  }
}

function scope(args: {
  id: string
  label: string
  role: LicensingScope['role']
  priced?: boolean
  architecture: StorageArchitecture | null
  hostLines: HostLine[]
  spareHosts: number
  workloadHosts?: number
  vms: VmCounts
  densityHosts?: number
  note?: string | null
}): LicensingScope {
  const hosts = args.hostLines.reduce((sum, line) => sum + line.hosts, 0)
  const workloadHosts = args.workloadHosts ?? Math.max(1, hosts - args.spareHosts)
  const densityHosts = Math.max(1, args.densityHosts ?? workloadHosts)
  return {
    id: args.id,
    label: args.label,
    role: args.role,
    priced: args.priced ?? true,
    architecture: args.architecture,
    hostLines: args.hostLines.filter((line) => line.hosts > 0),
    hosts,
    spareHosts: args.spareHosts,
    workloadHosts,
    physicalCores: args.hostLines.reduce((sum, line) => sum + line.hosts * line.physicalCoresPerHost, 0),
    licensableCores: args.hostLines.reduce((sum, line) => sum + line.hosts * line.licensableCoresPerHost, 0),
    vms: args.vms,
    windowsVmsPerHost: Math.ceil((args.vms.windows + args.vms.unknown) / densityHosts),
    managedOsesPerHost: Math.ceil(args.vms.total / densityHosts),
    note: args.note ?? null,
  }
}

const ARC_SERVICE_TO_METER: Record<ArcServiceId, ArcMeterId[]> = {
  'update-manager': ['updateManager'],
  'defender-for-servers': ['defenderP2'],
  'machine-configuration': ['machineConfig'],
  'change-tracking': ['changeTracking', 'logAnalytics'],
  'azure-monitor': ['logAnalytics'],
}

function designPlane(design: PlatformDesign): PlaneId {
  const inputs = design.management.inputs
  if (inputs.foundation === 'scvmm') return 'scvmm'
  if (inputs.wac === 'wac-admin' || inputs.wac === 'wac-virtual') return inputs.wac
  return 'classic'
}

/** The licensing quantities of the design: hosts, sockets, cores and VMs, per cluster. */
export function licensingQuantities(design: PlatformDesign, vms: Vm[]): LicensingQuantities {
  const included = design.path === 'management-only' ? [] : vms.filter((vm) => vm.include)
  const management = design.management
  const designed = management.decision === 'design'
  const inputs = management.inputs
  const scomPlanned = inputs.monitoring === 'scom' || (inputs.monitoring === 'scom-features' && inputs.foundation === 'scvmm')
  const arcMeters: Record<ArcMeterId, boolean> = { updateManager: false, defenderP2: false, machineConfig: false, changeTracking: false, logAnalytics: false }
  if (designed && inputs.includeArc) inputs.arcServices.forEach((service) => ARC_SERVICE_TO_METER[service]?.forEach((meter) => { arcMeters[meter] = true }))
  const sqlCores = management.plan.components
    .filter((component) => component.resourceType === 'vm' && component.id.includes('sql'))
    .reduce((sum, component) => sum + component.vCpu * component.count, 0)
  const base = {
    path: design.path,
    engagementMode: design.engagementMode,
    realVms: design.path === 'management-only' ? Math.max(0, Math.round(inputs.managedVms)) : included.length,
    windowsClaim: design.path !== 'management-only',
    validationNote: design.path === 'existing' ? 'Current licensing not validated: these are the hosts you entered, priced as if licensed today. Check your existing agreements before you buy anything.' : null,
    design: {
      plane: designed ? designPlane(design) : 'classic' as PlaneId,
      systemCenter: designed && (inputs.foundation === 'scvmm' || scomPlanned),
      scom: designed && scomPlanned,
      arc: designed && inputs.includeArc,
      arcMeters,
      arcGuestScopePct: inputs.arcGuestScopePct,
      sqlCores: designed && (inputs.foundation === 'scvmm' || scomPlanned) ? Math.max(4, sqlCores) : 0,
    },
  }
  const notCalculated = (reason: string, label = design.platformLabel): LicensingQuantities => ({ ...base, status: 'not-calculated', reason, label, scopes: [] })

  if (design.path === 'management-only') {
    const hosts = Math.max(0, Math.round(inputs.managedHosts))
    const sockets = Math.max(0, Math.round(inputs.managedHostSockets ?? 0))
    const coresPerSocket = Math.max(0, Math.round(inputs.managedHostCoresPerSocket ?? 0))
    if (!designed || hosts === 0 || sockets === 0 || coresPerSocket === 0) {
      return notCalculated('Enter the managed hosts and their sockets and cores per socket in the management inputs: licensing not calculated', 'Managed hosts')
    }
    const managedVms = Math.max(0, Math.round(inputs.managedVms))
    const vmCounts: VmCounts = { windows: 0, linux: 0, unknown: managedVms, total: managedVms, windowsOrUnknownVcpu: 0 }
    return {
      ...base,
      status: 'ready',
      reason: null,
      label: 'Managed hosts',
      scopes: [scope({
        id: 'managed', label: 'Managed hosts', role: 'managed', architecture: null,
        hostLines: [hostLine(`${sockets} × ${coresPerSocket} cores`, hosts, { sockets, coresPerSocket })],
        spareHosts: 0, workloadHosts: hosts, vms: vmCounts,
        note: 'System Center coverage only. Windows Server licensing for these hosts is outside this estimate.',
      })],
    }
  }

  if (design.path === 'new-platform') {
    const chosen = design.chosen
    if (!chosen || design.status === 'no-workload') return notCalculated('Add workloads first: licensing not calculated')
    if (design.feasible !== true) return notCalculated(DESIGN_DOES_NOT_FIT)
    const node = chosen.cfg.node
    const spec = `${node.sockets} × ${node.coresPerSocket} cores`
    const scopes: LicensingScope[] = []
    if (design.status === 'split' && design.placement) {
      design.placement.clusters.forEach((cluster) => {
        // cluster.vms already ends with the management VMs placed on it: count each VM once.
        const workloadVms = cluster.vms.slice(0, cluster.vms.length - cluster.managementVmCount)
        const counted = management.counted ? cluster.vms.slice(workloadVms.length) : []
        scopes.push(scope({
          id: cluster.id, label: cluster.name, role: 'workload', architecture: chosen.cfg.architecture,
          hostLines: [hostLine(spec, cluster.result.nodes, node)],
          spareHosts: chosen.cfg.spareNodes, workloadHosts: cluster.result.workloadNodes,
          vms: countVms(workloadVms, counted),
        }))
      })
    } else {
      const r = chosen.result
      scopes.push(scope({
        id: 'workload', label: 'Workload cluster', role: 'workload', architecture: chosen.cfg.architecture,
        hostLines: [hostLine(spec, r.nodes, node)],
        spareHosts: chosen.cfg.spareNodes, workloadHosts: r.workloadNodes,
        vms: countVms(included, management.countedVms),
      }))
    }
    const dedicated = management.dedicated
    if (dedicated) {
      if (dedicated.nodes === null) return notCalculated(`${DESIGN_DOES_NOT_FIT} (the dedicated management cluster does not fit)`)
      scopes.push(scope({
        id: 'management', label: 'Dedicated management cluster', role: 'management', architecture: chosen.cfg.architecture,
        hostLines: [hostLine(spec, dedicated.nodes, node)],
        spareHosts: chosen.cfg.spareNodes, workloadHosts: dedicated.sizing?.workloadNodes,
        vms: countVms([], management.vms),
      }))
    }
    return { ...base, status: 'ready', reason: null, label: `${design.platformLabel}${design.status === 'split' ? ', split by your choice' : ''}`, scopes }
  }

  // Existing hardware: existing capacity prices the estate; fit shows it and prices only what you add.
  const existing = design.existing
  if (!existing || design.status === 'no-hardware') return notCalculated('Enter your hardware: licensing not calculated')
  const fit = design.engagementMode === 'fit-gap'
  const scopes: LicensingScope[] = existing.clusters.map((cluster) => scope({
    id: cluster.id,
    label: existing.clusters.length > 1 ? cluster.name : 'Your hosts',
    role: 'existing',
    priced: !fit,
    architecture: cluster.cfg.architecture,
    hostLines: cluster.hostGroups
      .filter((group) => group.count > 0 && group.sockets > 0 && group.coresPerSocket > 0)
      .map((group) => hostLine(`${group.sockets} × ${group.coresPerSocket} cores`, Math.round(group.count), group)),
    spareHosts: cluster.spareNodes,
    workloadHosts: cluster.workloadNodes,
    vms: countVms(cluster.vms, cluster.fixedVms),
    note: fit ? 'Your current hosts: shown for reference, not priced.' : null,
  }))
  if (fit) {
    for (const remedy of existing.remedies.compute) {
      if (remedy.hostsToAdd <= 0) continue
      const parent = existing.clusters.find((cluster) => cluster.name === remedy.cluster) ?? existing.clusters[0]
      const parentCounts = parent ? countVms(parent.vms, parent.fixedVms) : countVms([])
      const densityHosts = Math.max(1, (parent?.workloadNodes ?? 0) + remedy.hostsToAdd)
      const addition = scope({
        id: `add-${remedy.cluster}`,
        label: `Hosts to add${existing.clusters.length > 1 ? ` to ${remedy.cluster}` : ''}`,
        role: 'addition',
        architecture: parent?.cfg.architecture ?? null,
        hostLines: [hostLine(remedy.specLabel, remedy.hostsToAdd, remedy.spec)],
        spareHosts: 0,
        workloadHosts: remedy.hostsToAdd,
        vms: { windows: 0, linux: 0, unknown: 0, total: 0, windowsOrUnknownVcpu: 0 },
        note: `Licensed for the same VM density as ${parent?.name ?? 'the cluster'} after the addition.`,
      })
      addition.windowsVmsPerHost = Math.ceil((parentCounts.windows + parentCounts.unknown) / densityHosts)
      addition.managedOsesPerHost = Math.ceil(parentCounts.total / densityHosts)
      scopes.push(addition)
    }
  }
  return { ...base, status: 'ready', reason: null, label: design.platformLabel, scopes }
}

// ---------------------------------------------------------------------------------------------
// Rates and editions
// ---------------------------------------------------------------------------------------------

export type RateConfidence = 'verified' | 'unverified' | 'entered'

export interface Rate {
  key: PriceKey
  value: number
  confidence: RateConfidence
  /** True when the report must show "quote required": unverified, or no price at all. */
  quoteRequired: boolean
  checked: string
  source: string
  label: string
  unit: string
}

export function resolveRate(key: PriceKey, overrides: Partial<Record<PriceKey, number>> = {}): Rate {
  const entry = PRICE_ENTRIES[key]
  const override = overrides[key]
  const entered = typeof override === 'number' && override !== entry.value
  const value = entered ? override : entry.value
  const confidence: RateConfidence = entered ? 'entered' : entry.confidence
  return {
    key, value, confidence, quoteRequired: confidence === 'unverified' || value <= 0,
    checked: entry.checked, source: entry.source, label: entry.label, unit: entry.unit,
  }
}

export interface EditionDecision {
  edition: Edition
  forced: boolean
  reason: string
  /** Licensing cost per year-one purchase for each edition, for one host. Null when not comparable. */
  datacenterPerHost: number | null
  standardPerHost: number | null
  /** Smallest VMs per host from which Datacenter costs no more than Standard. */
  breakEvenVmsPerHost: number | null
  standardSetsPerHost: number
}

/** Standard license sets needed per host: one set covers 2 OSEs, and at least one set is needed. */
export function standardSetsPerHost(osesPerHost: number): number {
  return Math.max(1, Math.ceil(Math.max(0, osesPerHost) / 2))
}

/** The VM density per host from which Datacenter costs no more than stacked Standard. */
export function breakEvenVmsPerHost(datacenterRate: number, standardRate: number): number | null {
  if (standardRate <= 0 || datacenterRate <= 0) return null
  const sets = Math.ceil(datacenterRate / standardRate - 1e-9)
  return 2 * (sets - 1) + 1
}

export function decideEdition(args: {
  product: 'windows' | 'system-center'
  choice: EditionChoice
  architecture: StorageArchitecture | null
  osesPerHost: number
  licensableCoresPerHost: number
  datacenterRate: number
  standardRate: number
}): EditionDecision {
  const packs = args.licensableCoresPerHost / 2
  const sets = standardSetsPerHost(args.osesPerHost)
  const datacenterPerHost = args.datacenterRate > 0 ? packs * args.datacenterRate : null
  const standardPerHost = args.standardRate > 0 ? packs * args.standardRate * sets : null
  const breakEven = breakEvenVmsPerHost(args.datacenterRate, args.standardRate)
  const productName = args.product === 'windows' ? 'Windows Server' : 'System Center'
  const what = args.product === 'windows' ? 'Windows VMs' : 'managed OSEs'
  if (args.product === 'windows' && (args.architecture === 's2d' || args.architecture === 'hybrid')) {
    return {
      edition: 'datacenter', forced: true,
      reason: `Datacenter is required: Storage Spaces Direct is available only in Windows Server Datacenter (${EDITIONS_URL}).${args.choice === 'standard' ? ' Your Standard choice cannot apply to this design.' : ''}`,
      datacenterPerHost, standardPerHost, breakEvenVmsPerHost: breakEven, standardSetsPerHost: sets,
    }
  }
  if (args.choice !== 'auto') {
    return {
      edition: args.choice, forced: false,
      reason: `${args.choice === 'datacenter' ? 'Datacenter' : 'Standard'} by your choice. At ${args.osesPerHost} ${what} per host, Standard needs ${sets} license set${sets === 1 ? '' : 's'} per host.`,
      datacenterPerHost, standardPerHost, breakEvenVmsPerHost: breakEven, standardSetsPerHost: sets,
    }
  }
  const standardCheaper = datacenterPerHost !== null && standardPerHost !== null && standardPerHost < datacenterPerHost
  const breakEvenText = breakEven === null ? '' : ` Standard costs less up to ${breakEven - 1} ${what} per host; Datacenter from ${breakEven}.`
  return {
    edition: standardCheaper ? 'standard' : 'datacenter', forced: false,
    reason: `${standardCheaper ? 'Standard' : 'Datacenter'} costs less at ${args.osesPerHost} ${what} per host (${productName} Standard covers 2 per license set and stacks; Datacenter is unlimited).${breakEvenText}`,
    datacenterPerHost, standardPerHost, breakEvenVmsPerHost: breakEven, standardSetsPerHost: sets,
  }
}

// ---------------------------------------------------------------------------------------------
// Estimate
// ---------------------------------------------------------------------------------------------

export type LineCategory = 'windows' | 'system-center' | 'sql' | 'arc' | 'cal' | 'rds' | 'sa'
export type LineConfidence = RateConfidence | 'tool' | 'included'

export interface LicensingLine {
  id: string
  category: LineCategory
  product: string
  scope: string
  quantity: string
  unitPrice: number | null
  unitLabel: string
  confidence: LineConfidence
  quoteRequired: boolean
  /** Cost per year, year 1 first. */
  years: number[]
  total: number
  note: string
  source: string | null
}

export interface EligibilityRow {
  meter: string
  servers: string
  charged: string
  rule: string
  source: string
}

export interface ScopeEdition {
  scopeId: string
  scope: string
  windows: EditionDecision | null
  systemCenter: EditionDecision | null
}

export interface LicensingEstimate {
  status: 'ready' | 'not-calculated'
  reason: string | null
  plane: PlaneId
  basis: LicensingBasis
  termYears: number
  months: number
  systemCenterIncluded: boolean
  arcIncluded: boolean
  lines: LicensingLine[]
  editions: ScopeEdition[]
  /** Every line the tab can price, including unverified starting values. */
  perYear: number[]
  total: number
  /** Only lines with a verified or entered price: what the report totals show. */
  pricedPerYear: number[]
  pricedTotal: number
  quoteRequired: LicensingLine[]
  /** Cost per real VM per month, on the full total. Null with no VMs. */
  perVmMonth: number | null
  perVmMonthPriced: number | null
  realVms: number
  saMultiplier: number | null
  assumptions: string[]
  eligibility: EligibilityRow[]
  warnings: string[]
  alternatives: Array<{ label: string; perYear: number; total: number; detail: string; source: string }>
  priceDate: string
}

const BASIS_LABEL: Record<LicensingBasis, string> = {
  'perpetual-sa': 'Perpetual licenses with Software Assurance',
  spla: 'SPLA (monthly, service provider)',
  csp: 'CSP (Cloud Solution Provider)',
}
export function basisLabel(basis: LicensingBasis) { return BASIS_LABEL[basis] }

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 100 ? 2 : 0 })
const n = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 0 })
const fill = (years: number, value: number) => Array.from({ length: years }, () => value)

export interface EstimateOptions {
  /** Price this plane instead of the design's (the Cost Model tab compares planes). */
  plane?: PlaneId
}

/** System Center is needed for SCVMM, and for SCOM on any plane. */
export function systemCenterNeeded(quantities: LicensingQuantities, inputs: CostModelInputs, plane: PlaneId): boolean {
  if (inputs.systemCenter === 'include') return true
  if (inputs.systemCenter === 'exclude') return false
  return plane === 'scvmm' || quantities.design.scom
}

export function arcMetersInUse(quantities: LicensingQuantities, inputs: CostModelInputs): { include: boolean; meters: Record<ArcMeterId, boolean> } {
  const include = inputs.arcServers === 'include' ? true : inputs.arcServers === 'exclude' ? false : quantities.design.arc
  return { include, meters: inputs.arcMeters ?? quantities.design.arcMeters }
}

export function estimateLicensing(quantities: LicensingQuantities, inputs: CostModelInputs, options: EstimateOptions = {}): LicensingEstimate {
  const plane = options.plane ?? inputs.selectedPlane ?? quantities.design.plane
  const years = Math.max(1, Math.round(inputs.termYears))
  const months = years * 12
  const rate = (key: PriceKey) => resolveRate(key, inputs.rateOverrides)
  const sa = rate('softwareAssuranceAnnualRate')
  const basis = inputs.basis
  const scIncluded = systemCenterNeeded(quantities, inputs, plane)
  const arc = arcMetersInUse(quantities, inputs)
  const lines: LicensingLine[] = []
  const editions: ScopeEdition[] = []
  const warnings: string[] = []
  const assumptions: string[] = []
  const eligibility: EligibilityRow[] = []
  const alternatives: LicensingEstimate['alternatives'] = []

  const empty = (reason: string | null): LicensingEstimate => ({
    status: 'not-calculated', reason, plane, basis, termYears: years, months, systemCenterIncluded: scIncluded, arcIncluded: arc.include,
    lines: [], editions: [], perYear: fill(years, 0), total: 0, pricedPerYear: fill(years, 0), pricedTotal: 0, quoteRequired: [],
    perVmMonth: null, perVmMonthPriced: null, realVms: quantities.realVms, saMultiplier: null, assumptions: [], eligibility: [], warnings: [], alternatives: [],
    priceDate: PRICE_ENTRIES.windowsPerTwoCorePack.checked,
  })
  if (quantities.status !== 'ready') return empty(quantities.reason)

  const priced = quantities.scopes.filter((item) => item.priced)

  /** A license line: perpetual + SA, SPLA monthly or CSP (quote required). */
  const licenseLine = (args: {
    id: string; category: LineCategory; product: string; scope: string; packs: number; quantity: string;
    perpetualKey: PriceKey | null; splaKey: PriceKey | null; note: string
  }) => {
    if (args.packs <= 0) return
    if (basis === 'csp') {
      lines.push({ id: args.id, category: args.category, product: `${args.product} (CSP)`, scope: args.scope, quantity: args.quantity, unitPrice: null, unitLabel: 'CSP price', confidence: 'unverified', quoteRequired: true, years: fill(years, 0), total: 0, note: `${args.note} No sourced CSP price: quote required from your CSP partner.`, source: null })
      return
    }
    const key = basis === 'spla' ? args.splaKey : args.perpetualKey
    if (!key) {
      lines.push({ id: args.id, category: args.category, product: args.product, scope: args.scope, quantity: args.quantity, unitPrice: null, unitLabel: basis === 'spla' ? 'SPLA price' : 'price', confidence: 'unverified', quoteRequired: true, years: fill(years, 0), total: 0, note: `${args.note} No sourced price: quote required.`, source: null })
      return
    }
    const r = rate(key)
    const perYear = basis === 'spla' ? args.packs * r.value * 12 : 0
    const purchase = basis === 'spla' ? 0 : args.packs * r.value
    const yearly = basis === 'spla' ? fill(years, perYear) : [purchase, ...fill(years - 1, 0)]
    lines.push({
      id: args.id, category: args.category, product: args.product, scope: args.scope, quantity: args.quantity,
      unitPrice: r.value, unitLabel: r.unit, confidence: r.confidence, quoteRequired: r.quoteRequired,
      years: yearly, total: yearly.reduce((sum, value) => sum + value, 0), note: args.note, source: r.source,
    })
    if (basis === 'perpetual-sa' && purchase > 0) {
      const annual = purchase * sa.value
      const saYears = fill(years, annual)
      lines.push({
        id: `${args.id}-sa`, category: 'sa', product: `Software Assurance on ${args.product}`, scope: args.scope,
        quantity: `${(sa.value * 100).toFixed(0)}% of ${money(purchase)} a year, from year 1`,
        unitPrice: null, unitLabel: 'per year', confidence: sa.confidence === 'entered' ? 'entered' : 'tool', quoteRequired: r.quoteRequired,
        years: saYears, total: annual * years,
        note: 'TOOL assumption, not a Microsoft-published rate. Replace it with your agreement\'s SA price.', source: sa.source,
      })
    }
  }

  // Windows Server and System Center per priced scope.
  for (const item of quantities.scopes) {
    const firstLine = item.hostLines[0]
    const licCoresPerHost = firstLine?.licensableCoresPerHost ?? 16
    const windows = quantities.windowsClaim ? decideEdition({
      product: 'windows', choice: inputs.windowsEdition, architecture: item.architecture, osesPerHost: item.windowsVmsPerHost,
      licensableCoresPerHost: licCoresPerHost,
      datacenterRate: basis === 'spla' ? rate('windowsSplaPerTwoCorePackMonth').value : rate('windowsPerTwoCorePack').value,
      standardRate: basis === 'spla' ? rate('windowsStandardSplaPerTwoCorePackMonth').value : rate('windowsStandardPerTwoCorePack').value,
    }) : null
    const systemCenter = scIncluded ? decideEdition({
      product: 'system-center', choice: inputs.systemCenterEdition, architecture: item.architecture, osesPerHost: item.managedOsesPerHost,
      licensableCoresPerHost: licCoresPerHost,
      datacenterRate: basis === 'spla' ? rate('systemCenterSplaPerTwoCorePackMonth').value : rate('systemCenterPerTwoCorePack').value,
      standardRate: basis === 'spla' ? rate('systemCenterStandardSplaPerTwoCorePackMonth').value : rate('systemCenterStandardPerTwoCorePack').value,
    }) : null
    editions.push({ scopeId: item.id, scope: item.label, windows, systemCenter })
    if (!item.priced) continue
    const packs = item.licensableCores / 2
    const coresText = `${n(item.hosts)} host${item.hosts === 1 ? '' : 's'}, ${n(item.licensableCores)} licensable cores`
    if (windows) {
      const sets = windows.edition === 'standard' ? windows.standardSetsPerHost : 1
      licenseLine({
        id: `windows-${item.id}`, category: 'windows',
        product: `Windows Server ${windows.edition === 'datacenter' ? 'Datacenter' : 'Standard'}`,
        scope: item.label, packs: packs * sets,
        quantity: `${coresText}${sets > 1 ? ` × ${sets} license sets` : ''} = ${n(packs * sets)} two-core packs`,
        perpetualKey: windows.edition === 'datacenter' ? 'windowsPerTwoCorePack' : 'windowsStandardPerTwoCorePack',
        splaKey: windows.edition === 'datacenter' ? 'windowsSplaPerTwoCorePackMonth' : 'windowsStandardSplaPerTwoCorePackMonth',
        note: windows.reason,
      })
    }
    if (systemCenter) {
      const sets = systemCenter.edition === 'standard' ? systemCenter.standardSetsPerHost : 1
      licenseLine({
        id: `system-center-${item.id}`, category: 'system-center',
        product: `System Center ${systemCenter.edition === 'datacenter' ? 'Datacenter' : 'Standard'}`,
        scope: item.label, packs: packs * sets,
        quantity: `${coresText}${sets > 1 ? ` × ${sets} license sets` : ''} = ${n(packs * sets)} two-core packs`,
        perpetualKey: systemCenter.edition === 'datacenter' ? 'systemCenterPerTwoCorePack' : 'systemCenterStandardPerTwoCorePack',
        splaKey: systemCenter.edition === 'datacenter' ? 'systemCenterSplaPerTwoCorePackMonth' : 'systemCenterStandardSplaPerTwoCorePackMonth',
        note: `${systemCenter.reason} Every physical core of each managed host is licensed.`,
      })
    }
  }

  // SQL Server for System Center.
  if (scIncluded) {
    const cores = Math.max(0, Math.round(inputs.sqlCores ?? quantities.design.sqlCores))
    if (inputs.sqlLicensing === 'system-center-rights') {
      lines.push({
        id: 'sql', category: 'sql', product: 'SQL Server for System Center', scope: 'Management', quantity: cores > 0 ? `${n(cores)} cores` : 'As deployed',
        unitPrice: 0, unitLabel: 'included', confidence: 'included', quoteRequired: false, years: fill(years, 0), total: 0,
        note: `$0: "No additional licenses are needed for management servers or SQL Server technology used in System Center" (${SC_PRICING_URL}). Confirm the Product Terms limits on these rights: SQL Server used for anything else is licensed separately.`,
        source: SC_PRICING_URL,
      })
    } else if (cores > 0) {
      if (basis === 'spla') {
        const r = rate('sqlStandardSplaPerTwoCorePackMonth')
        const perYear = (cores / 2) * r.value * 12
        lines.push({ id: 'sql', category: 'sql', product: 'SQL Server Standard (licensed separately)', scope: 'Management', quantity: `${n(cores)} cores = ${n(cores / 2)} two-core packs`, unitPrice: r.value, unitLabel: r.unit, confidence: r.confidence, quoteRequired: r.quoteRequired, years: fill(years, perYear), total: perYear * years, note: 'SPLA SQL Server is paid monthly over the term.', source: r.source })
      } else {
        licenseLine({ id: 'sql', category: 'sql', product: 'SQL Server Standard (licensed separately)', scope: 'Management', packs: cores, quantity: `${n(cores)} cores`, perpetualKey: 'sqlStandardPerCore', splaKey: null, note: 'Licensed outside System Center rights, by your choice.' })
      }
    }
  }

  // Azure Arc-enabled servers.
  if (arc.include) {
    const pct = Math.min(100, Math.max(0, quantities.design.arcGuestScopePct)) / 100
    let windowsServers = 0
    let otherServers = 0
    let hostServers = 0
    for (const item of priced) {
      windowsServers += Math.round(item.vms.windows * pct)
      otherServers += Math.round((item.vms.linux + item.vms.unknown) * pct)
      if (inputs.meterArcHosts) hostServers += item.hosts
    }
    const totalServers = windowsServers + otherServers + hostServers
    const ent = inputs.entitlements
    const saClaim = ent.windowsSaOrSubscription && basis !== 'spla'
    if (ent.windowsSaOrSubscription && basis === 'spla') warnings.push('SPLA is not listed as a qualifying entitlement for Windows Server Management enabled by Azure Arc, so the Software Assurance waiver is not applied. Confirm with your SPLA reseller.')
    const windowsEligible = saClaim || ent.windowsPayg || ent.esu
    // Hosts are Windows Server; on management-only their licensing is outside the estimate, so not assumed eligible.
    const eligibleWindows = windowsEligible ? windowsServers + (quantities.windowsClaim ? hostServers : 0) : 0
    const defender = arc.meters.defenderP2
    const serversText = `${n(totalServers)} server${totalServers === 1 ? '' : 's'}${hostServers ? ` (${n(hostServers)} hosts)` : ''}`
    const meter = (id: ArcMeterId, key: PriceKey, name: string, waivable: boolean) => {
      if (!arc.meters[id]) return
      const r = rate(key)
      const free = defender && waivable ? totalServers : waivable ? eligibleWindows : 0
      const charged = Math.max(0, totalServers - free)
      const perYear = charged * r.value * 12
      lines.push({
        id: `arc-${id}`, category: 'arc', product: name, scope: 'Azure Arc-enabled servers',
        quantity: `${n(charged)} of ${serversText} charged`, unitPrice: r.value, unitLabel: r.unit, confidence: r.confidence, quoteRequired: r.quoteRequired,
        years: fill(years, perYear), total: perYear * years,
        note: !waivable ? '' : defender ? 'Included with Defender for Servers Plan 2 for every Arc-enabled server in the subscription, Linux included.'
          : free > 0 ? `${n(free)} Windows servers covered by the entitlement you confirmed.` : 'No qualifying entitlement confirmed.',
        source: r.source,
      })
      if (waivable) eligibility.push({
        meter: name, servers: serversText, charged: n(charged),
        rule: defender ? 'Defender for Servers Plan 2 is enabled: no charge for any Arc-enabled server in that subscription (not when Defender is used through a security connector).'
          : windowsEligible ? `Free for Windows servers you attest with ${[saClaim ? 'Software Assurance or a Windows Server subscription' : '', ent.windowsPayg ? 'Windows Server pay-as-you-go' : '', ent.esu ? 'ESU enabled by Azure Arc' : ''].filter(Boolean).join(', ')}. Linux and unknown guests are not covered by Windows entitlements.`
            : 'Charged: no qualifying entitlement confirmed. Qualifying: Windows Server SA or subscription (attested per server), Windows Server pay-as-you-go, ESU enabled by Azure Arc, or Defender for Servers Plan 2.',
        source: defender ? `${UPDATE_MANAGER_FAQ_URL}; ${ESSENTIAL_MANAGEMENT_URL}` : `${WS_MANAGEMENT_URL}; ${UPDATE_MANAGER_FAQ_URL}`,
      })
    }
    meter('updateManager', 'updateManagerPerVmMonth', 'Azure Update Manager', true)
    meter('machineConfig', 'guestConfigPerVmMonth', 'Azure Machine Configuration', true)
    meter('changeTracking', 'changeTrackingPerVmMonth', 'Change Tracking and Inventory', true)
    meter('defenderP2', 'defenderP2PerVmMonth', 'Defender for Servers Plan 2', false)
    if (arc.meters.logAnalytics) {
      const r = rate('logAnalyticsPerGb')
      const gb = Math.max(0, totalServers * inputs.logAnalyticsGbPerServerMonth - LOG_ANALYTICS_FREE_GB_PER_MONTH)
      const perYear = gb * r.value * 12
      lines.push({
        id: 'arc-logAnalytics', category: 'arc', product: 'Log Analytics ingestion', scope: 'Azure Arc-enabled servers',
        quantity: `${n(totalServers)} servers × ${inputs.logAnalyticsGbPerServerMonth} GB a month, less ${LOG_ANALYTICS_FREE_GB_PER_MONTH} GB free = ${n(gb)} GB a month`,
        unitPrice: r.value, unitLabel: r.unit, confidence: r.confidence, quoteRequired: r.quoteRequired, years: fill(years, perYear), total: perYear * years,
        note: `The first ${LOG_ANALYTICS_FREE_GB_PER_MONTH} GB per billing account per month is free (${MONITOR_PRICING_URL}). GB per server is your planning input.${defender ? ' Defender for Servers Plan 2 adds a 500 MB per server per day allowance for some security data types; not modelled.' : ''}`,
        source: r.source,
      })
    }
  }

  // CALs and RDS.
  if (quantities.windowsClaim && inputs.windowsCals.count > 0) {
    if (basis === 'spla') {
      assumptions.push('Windows Server CALs are not used under SPLA, so the CAL count you entered is not priced.')
    } else {
      const r = rate('windowsCalPerUnit')
      const purchase = basis === 'csp' ? 0 : inputs.windowsCals.count * r.value
      lines.push({
        id: 'windows-cal', category: 'cal', product: `Windows Server ${inputs.windowsCals.kind} CALs`, scope: 'Access', quantity: `${n(inputs.windowsCals.count)} ${inputs.windowsCals.kind}s`,
        unitPrice: basis === 'csp' || r.value <= 0 ? null : r.value, unitLabel: r.unit, confidence: r.confidence, quoteRequired: basis === 'csp' || r.quoteRequired,
        years: [purchase, ...fill(years - 1, 0)], total: purchase,
        note: `CALs are required for every user or device accessing a server (${WS_PRICING_URL}). Windows Server pay-as-you-go needs no CALs for standard functionality (${PAYG_URL}).`,
        source: WS_PRICING_URL,
      })
    }
  }
  if (inputs.rds.inScope && inputs.rds.users > 0) {
    const users = inputs.rds.users
    if (basis === 'spla') {
      const r = rate('rdsSalPerUserMonth')
      const perYear = users * r.value * 12
      lines.push({ id: 'rds', category: 'rds', product: 'RDS SALs', scope: 'Access', quantity: `${n(users)} users`, unitPrice: r.value, unitLabel: r.unit, confidence: r.confidence, quoteRequired: r.quoteRequired, years: fill(years, perYear), total: perYear * years, note: 'Monthly subscriber access licenses, reported to your SPLA reseller.', source: r.source })
    } else {
      const r = rate('rdsCalPerUser')
      const purchase = basis === 'csp' ? 0 : users * r.value
      lines.push({ id: 'rds', category: 'rds', product: 'RDS user CALs', scope: 'Access', quantity: `${n(users)} users`, unitPrice: basis === 'csp' ? null : r.value, unitLabel: r.unit, confidence: r.confidence, quoteRequired: basis === 'csp' || r.quoteRequired, years: [purchase, ...fill(years - 1, 0)], total: purchase, note: `RDS CALs are still required with Windows Server pay-as-you-go (${PAYG_URL}).`, source: r.source })
    }
  }

  // Alternatives, excluded from totals.
  if (quantities.windowsClaim) {
    const payg = rate('windowsPaygPerCoreMonth')
    const hostCores = priced.reduce((sum, item) => sum + item.physicalCores, 0)
    const vmCores = priced.reduce((sum, item) => sum + item.vms.windowsOrUnknownVcpu, 0)
    const paygPerYear = (hostCores + vmCores) * payg.value * 12
    alternatives.push({
      label: 'Windows Server pay-as-you-go enabled by Azure Arc',
      perYear: paygPerYear, total: paygPerYear * years,
      detail: `${n(hostCores)} host cores plus ${n(vmCores)} vCPUs of Windows and unknown-OS VMs at ${money(payg.value)} per core per month. Each VM needs its own license, with no core minimum; no Windows Server CALs, but RDS CALs still apply.`,
      source: `${PAYG_URL}; ${PAYG_BILLING_URL}`,
    })
    const local = rate('azureLocalPerCoreMonth')
    const localPerYear = hostCores * local.value * 12
    alternatives.push({
      label: 'Azure Local host service fee (reference)',
      perYear: localPerYear, total: localPerYear * years,
      detail: `${n(hostCores)} physical cores at ${money(local.value)} per core per month, with no Windows core floors. Windows Server guests are licensed separately; Azure Hybrid Benefit can waive the fee.`,
      source: AZURE_LOCAL_PRICING_URL,
    })
  }

  // Warnings.
  if (basis === 'csp') warnings.push('CSP basis: Surveyor has no sourced CSP price for Windows Server, System Center or SQL Server, so those lines are quote required. Azure meters are priced at list.')
  if (basis === 'spla' && inputs.commercial.motion === 'internal') warnings.push('Internal platform with SPLA: SPLA is for hosting services you provide to others. An internal platform normally uses volume licensing or CSP. Confirm with your licensing partner.')
  if (inputs.commercial.motion === 'msp' && basis !== 'spla') warnings.push('A provider-hosted service normally needs SPLA or another explicit service-provider right. Customer-owned perpetual or CSP licenses do not cover your hosted platform.')
  if (inputs.commercial.motion === 'csp' && basis === 'spla') warnings.push('The commercial route is CSP but the licensing basis is SPLA. Choose the basis that matches who owns the licenses.')

  // Totals.
  const sumYears = (selected: LicensingLine[]) => Array.from({ length: years }, (_, index) => selected.reduce((sum, line) => sum + (line.years[index] ?? 0), 0))
  const perYear = sumYears(lines)
  const pricedLines = lines.filter((line) => !line.quoteRequired)
  const pricedPerYear = sumYears(pricedLines)
  const total = perYear.reduce((sum, value) => sum + value, 0)
  const pricedTotal = pricedPerYear.reduce((sum, value) => sum + value, 0)
  const realVms = quantities.realVms
  const saMultiplier = basis === 'perpetual-sa' ? 1 + sa.value * years : null

  assumptions.unshift(
    `Licensing basis: ${BASIS_LABEL[basis]} over ${years} year${years === 1 ? '' : 's'}.`,
    ...(saMultiplier !== null ? [`Software Assurance at ${(sa.value * 100).toFixed(0)}% of the license price a year (TOOL assumption, not Microsoft-published), paid from year 1: licenses cost ${saMultiplier.toFixed(2)}× their purchase price over ${years} year${years === 1 ? '' : 's'}.`] : []),
    ...(basis === 'spla' ? ['SPLA licenses are paid monthly for every month of the term.'] : []),
    'Windows Server and System Center license every physical core, at least 8 per processor and 16 per server.',
    ...(quantities.windowsClaim ? ['Every host, spares included, is licensed for the busiest host: Windows VMs ÷ workload-bearing hosts, rounded up, so a failover stays covered (TOOL). VMs with no guest OS in the inventory count as Windows.'] : ['Windows Server for the managed hosts is outside this estimate.']),
    ...(scIncluded ? ['System Center Standard is counted per managed OSE of any operating system; the host OS used only to run VMs is not counted.'] : []),
    ...(realVms > 0 ? [`Per-VM cost divides by your ${n(realVms)} workload VMs; management VMs and spare hosts are not in the denominator.`] : []),
  )

  return {
    status: 'ready', reason: null, plane, basis, termYears: years, months, systemCenterIncluded: scIncluded, arcIncluded: arc.include,
    lines, editions, perYear, total, pricedPerYear, pricedTotal,
    quoteRequired: lines.filter((line) => line.quoteRequired),
    perVmMonth: realVms > 0 ? total / realVms / months : null,
    perVmMonthPriced: realVms > 0 ? pricedTotal / realVms / months : null,
    realVms, saMultiplier, assumptions, eligibility, warnings, alternatives,
    priceDate: PRICE_ENTRIES.windowsPerTwoCorePack.checked,
  }
}

/** The default rate card values, for the editable rate card. */
export const DEFAULT_RATES = PRICE_BOOK
