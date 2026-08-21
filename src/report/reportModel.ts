import { MANAGEMENT_PLANES, type PlaneId } from '../data/managementPlane'
import {
  deploymentComponentsToVms,
  deploymentInputsFromStack,
  normalizeManagementDeploymentInputs,
  planManagementDeployment,
  type ManagementDeploymentInputs,
} from '../engine/managementDeployment'
import { compareArchitectures, forecastGrowth } from '../engine/solve'
import { RESILIENCY } from '../engine/rules'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'

export const REPORT_SECTION_DEFINITIONS = [
  { id: 'executive', label: 'Executive summary' },
  { id: 'architecture', label: 'Solution architecture' },
  { id: 'nodes', label: 'Node requirements' },
  { id: 'workloads', label: 'Workload summary' },
  { id: 'storage', label: 'Storage and CSV plan' },
  { id: 'management', label: 'Management plane' },
  { id: 'assumptions', label: 'Assumptions and policies' },
  { id: 'findings', label: 'Findings and cautions' },
  { id: 'inventory', label: 'VM inventory' },
  { id: 'sources', label: 'Sources and methodology' },
] as const

export type ReportSectionId = typeof REPORT_SECTION_DEFINITIONS[number]['id']
export type ReportSelection = Record<ReportSectionId, boolean>

export interface ReportMetric {
  label: string
  value: string
  detail?: string
}

export interface ReportTable {
  title?: string
  headers: string[]
  rows: string[][]
}

export interface ReportSection {
  id: ReportSectionId
  title: string
  paragraphs: string[]
  metrics: ReportMetric[]
  bullets: string[]
  tables: ReportTable[]
}

export interface SolutionReport {
  schemaVersion: 1
  title: string
  customerName: string
  generatedAt: string
  selectedArchitecture: string
  sections: ReportSection[]
}

export interface SolutionReportInputs {
  customerName: string
  cfg: ClusterConfig
  vms: Vm[]
  tiers: Record<TierId, TierPolicy>
  chosenKey: string
  managementDeploymentInputs: ManagementDeploymentInputs | null
  includeManagementInSizing: boolean
  generatedAt?: string
}

export function defaultReportSelection(): ReportSelection {
  return Object.fromEntries(REPORT_SECTION_DEFINITIONS.map(({ id }) => [id, true])) as ReportSelection
}

function number(value: number, maximumFractionDigits = 0) {
  return value.toLocaleString('en-US', { maximumFractionDigits })
}

function gib(value: number) {
  return `${number(value)} GiB`
}

function tib(value: number | null) {
  return value === null ? 'Not applicable' : `${number(value, 2)} TiB`
}

function yesNo(value: boolean) {
  return value ? 'Yes' : 'No'
}

function managementLabel(inputs: ManagementDeploymentInputs) {
  const resolved = normalizeManagementDeploymentInputs(inputs)
  const foundation = inputs.foundation === 'scvmm'
    ? `SCVMM 2025 (${resolved.fabricHighAvailability ? 'HA' : 'standalone'})`
    : 'Classic Hyper-V tools'
  const wac = inputs.wac === 'wac-admin'
    ? 'WAC Administration Mode'
    : inputs.wac === 'wac-virtual'
      ? 'WAC Virtualization Mode'
      : 'No WAC gateway'
  const monitoring = inputs.monitoring === 'scom'
    ? resolved.scomHighAvailability
      ? `SCOM 2025 HA${resolved.scomSqlPlacement === 'shared-vmm' && inputs.foundation === 'scvmm' ? ' on shared VMM SQL infrastructure' : ''}`
      : 'SCOM 2025 single-server management group'
    : 'Existing / no monitoring platform'
  const arc = inputs.includeArc
    ? `; Azure Arc core management${resolved.arcServices.length ? ` + ${resolved.arcServices.length} add-on${resolved.arcServices.length === 1 ? '' : 's'}` : ' only'}`
    : ''
  return `${foundation}; ${wac}; ${monitoring}${arc}`
}

function storageProtectionMetric(cfg: ClusterConfig): ReportMetric {
  const s2dResiliency = RESILIENCY[cfg.resiliency].label
  if (cfg.architecture === 'san') {
    return {
      label: 'Storage protection',
      value: 'External SAN (array-managed; not modeled)',
      detail: 'S2D resiliency does not apply to this design. Confirm array protection and replication in the final storage design.',
    }
  }
  if (cfg.architecture === 'hybrid') {
    return {
      label: 'Storage protection',
      value: `S2D: ${s2dResiliency}; SAN: array-managed`,
      detail: 'The S2D setting applies only to S2D-hosted data. SAN protection and replication are not modeled by Surveyor.',
    }
  }
  return {
    label: 'S2D resiliency',
    value: s2dResiliency,
    detail: 'Applies to Storage Spaces Direct capacity in this design.',
  }
}

export function buildSolutionReport(input: SolutionReportInputs): SolutionReport {
  const includedVms = input.vms.filter((vm) => vm.include)
  const options = compareArchitectures(input.cfg, input.vms, input.tiers)
  const chosen = options.find((option) => option.key === input.chosenKey) ?? options[0]
  const defaultStack: PlaneId[] = chosen.result.feasible && chosen.result.nodes <= 4
    ? ['classic', 'wac-admin']
    : ['scvmm', 'wac-admin']
  const managementInputs = normalizeManagementDeploymentInputs(input.managementDeploymentInputs
    ? { ...input.managementDeploymentInputs, monitoring: input.managementDeploymentInputs.monitoring ?? 'none' }
    : deploymentInputsFromStack(
      defaultStack,
      chosen.result.feasible ? chosen.result.nodes : 0,
      includedVms.length,
    ))
  const managementPlan = planManagementDeployment(managementInputs)
  const managementVms = deploymentComponentsToVms(managementPlan.components)
  const growthForecast = forecastGrowth(
    chosen.cfg,
    input.vms,
    input.tiers,
    input.includeManagementInSizing ? managementVms : [],
  )
  const plannedGrowthPoint = growthForecast.plan.strategy === 'build-now'
    ? growthForecast.points[growthForecast.points.length - 1]
    : growthForecast.points[0]
  const finalSizing = plannedGrowthPoint.result
  const managementHostDelta = finalSizing.feasible && chosen.result.feasible
    ? finalSizing.nodes - chosen.result.nodes
    : null

  const workloadTotals = includedVms.reduce((totals, vm) => ({
    vCpu: totals.vCpu + vm.vCpu,
    ramGiB: totals.ramGiB + vm.ramGiB,
    storageGiB: totals.storageGiB + vm.storageGiB,
    provisionedGiB: totals.provisionedGiB + vm.provisionedGiB,
  }), { vCpu: 0, ramGiB: 0, storageGiB: 0, provisionedGiB: 0 })

  const tierRows = (Object.keys(input.tiers) as TierId[]).map((tierId) => {
    const tierVms = includedVms.filter((vm) => vm.tier === tierId)
    return [
      input.tiers[tierId].label,
      number(tierVms.length),
      number(tierVms.reduce((sum, vm) => sum + vm.vCpu, 0)),
      gib(tierVms.reduce((sum, vm) => sum + vm.ramGiB, 0)),
      tib(tierVms.reduce((sum, vm) => sum + vm.storageGiB, 0) / 1024),
    ]
  })

  const sourceMap = new Map<string, string>()
  finalSizing.findings.forEach((finding) => {
    if (finding.source) sourceMap.set(finding.source, finding.message)
  })
  managementPlan.components.forEach((component) => {
    if (component.source) sourceMap.set(component.source, component.name)
  })
  managementPlan.arcServices.forEach((service) => sourceMap.set(service.source, service.name))

  const sections: ReportSection[] = [
    {
      id: 'executive',
      title: 'Executive summary',
      paragraphs: [
        `${input.customerName || 'This solution'} is sized on ${chosen.label}. ${finalSizing.feasible ? `The calculated design requires ${finalSizing.nodes} nodes, including ${chosen.cfg.spareNodes} spare nodes.` : 'The selected design is not currently feasible within the platform limits.'}`,
        `The report includes ${includedVms.length.toLocaleString()} workload VMs${input.includeManagementInSizing ? ` plus ${managementPlan.totalInstances} management VM instances in capacity sizing` : ', with management infrastructure shown separately from capacity sizing'}.`,
      ],
      metrics: [
        { label: 'Selected design', value: chosen.label },
        { label: 'Required nodes', value: finalSizing.feasible ? number(finalSizing.nodes) : 'Review required', detail: finalSizing.bindingExplanation },
        { label: 'Workload VMs', value: number(includedVms.length) },
        { label: 'Management VMs', value: number(managementPlan.totalInstances), detail: input.includeManagementInSizing ? 'Included in node sizing' : 'Excluded from node sizing' },
      ],
      bullets: finalSizing.feasible ? [] : finalSizing.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.message),
      tables: [],
    },
    {
      id: 'architecture',
      title: 'Solution architecture',
      paragraphs: [chosen.result.bindingExplanation],
      metrics: [
        { label: 'Architecture', value: chosen.label },
        storageProtectionMetric(chosen.cfg),
        { label: 'Failure reserve', value: `N+${chosen.cfg.spareNodes}` },
        { label: 'Binding constraint', value: finalSizing.binding },
      ],
      bullets: [],
      tables: [{
        title: 'Architecture comparison',
        headers: ['Option', 'Feasible', 'Nodes', 'Binding constraint'],
        rows: options.map((option) => [
          option.label,
          yesNo(option.result.feasible),
          option.result.feasible ? number(option.result.nodes) : 'N/A',
          option.result.binding,
        ]),
      }],
    },
    {
      id: 'nodes',
      title: 'Node requirements',
      paragraphs: [
        finalSizing.bindingExplanation,
        growthForecast.plan.strategy === 'build-now'
          ? `The current design includes the full Year ${growthForecast.plan.horizonYears} forecast at ${(growthForecast.plan.annualGrowthPct * 100).toFixed(1)}% compounded annual workload growth.`
          : `The current design is sized for today's demand; the timeline phases node additions over ${growthForecast.plan.horizonYears} years at ${(growthForecast.plan.annualGrowthPct * 100).toFixed(1)}% compounded annual workload growth.`,
      ],
      metrics: [
        { label: 'Total nodes', value: finalSizing.feasible ? number(finalSizing.nodes) : 'Review required' },
        { label: 'Workload-bearing nodes', value: finalSizing.feasible ? number(finalSizing.workloadNodes) : 'N/A' },
        { label: 'CPU-only requirement', value: Number.isFinite(finalSizing.nodesIfCpuOnly) ? number(finalSizing.nodesIfCpuOnly) : 'N/A' },
        { label: 'Memory-only requirement', value: Number.isFinite(finalSizing.nodesIfMemoryOnly) ? number(finalSizing.nodesIfMemoryOnly) : 'N/A' },
        { label: 'Storage-only requirement', value: Number.isFinite(finalSizing.nodesIfStorageOnly) ? number(finalSizing.nodesIfStorageOnly) : 'N/A' },
        { label: 'Licensable cores', value: number(finalSizing.totalLicensableCores) },
        { label: 'Growth strategy', value: growthForecast.plan.strategy === 'build-now' ? 'Build forecast capacity now' : 'Phase nodes with growth' },
        { label: 'Annual growth', value: `${number(growthForecast.plan.annualGrowthPct * 100, 1)}% for ${growthForecast.plan.horizonYears} years` },
      ],
      bullets: [],
      tables: [
        {
          title: 'Per-node hardware profile',
          headers: ['Sockets', 'Cores / socket', 'Physical cores', 'Memory', 'Capacity drives', 'Cache drives'],
          rows: [[
            number(chosen.cfg.node.sockets),
            number(chosen.cfg.node.coresPerSocket),
            number(chosen.cfg.node.sockets * chosen.cfg.node.coresPerSocket),
            gib(chosen.cfg.node.ramGiB),
            `${chosen.cfg.node.capacityDrivesPerNode} x ${chosen.cfg.node.capacityDriveTB} TB`,
            `${chosen.cfg.node.cacheDrivesPerNode} x ${chosen.cfg.node.cacheDriveTB} TB`,
          ]],
        },
        {
          title: 'Node growth timeline',
          headers: ['Timeline', 'Demand multiplier', 'Nodes required', 'Binding constraint', 'Deployment action'],
          rows: growthForecast.points.map((point, index) => {
            const action = !point.result.feasible
              ? 'Review node density or split into multiple clusters'
              : growthForecast.plan.strategy === 'build-now'
                ? index === 0
                  ? `Build ${growthForecast.plannedNodesToday ?? 'N/A'} nodes now`
                  : `Covered by initial ${growthForecast.plannedNodesToday ?? 'N/A'}-node build`
                : index === 0
                  ? `Initial build: ${point.result.nodes} nodes`
                  : point.additionalNodes && point.additionalNodes > 0
                    ? `Add ${point.additionalNodes} node${point.additionalNodes === 1 ? '' : 's'}`
                    : 'No node addition'
            return [
              point.year === 0 ? 'Today' : `Year ${point.year}`,
              `${number(point.demandFactor, 2)}x`,
              point.result.feasible ? number(point.result.nodes) : 'Review required',
              point.result.binding,
              action,
            ]
          }),
        },
      ],
    },
    {
      id: 'workloads',
      title: 'Workload summary',
      paragraphs: ['Only workloads marked Include are represented in demand and inventory totals.'],
      metrics: [
        { label: 'VMs', value: number(includedVms.length) },
        { label: 'Allocated vCPU', value: number(workloadTotals.vCpu) },
        { label: 'Allocated memory', value: gib(workloadTotals.ramGiB) },
        { label: 'Consumed storage', value: tib(workloadTotals.storageGiB / 1024) },
        { label: 'Provisioned storage', value: tib(workloadTotals.provisionedGiB / 1024) },
      ],
      bullets: [],
      tables: [{ title: 'Workloads by tier', headers: ['Tier', 'VMs', 'vCPU', 'Memory', 'Consumed storage'], rows: tierRows }],
    },
    {
      id: 'storage',
      title: 'Storage and CSV plan',
      paragraphs: ['Capacity values use consumed workload storage after the selected immediate-headroom and growth strategy, followed by the configured resiliency or SAN efficiency assumptions.'],
      metrics: [
        { label: 'Required storage', value: tib(finalSizing.requiredStorageTiB) },
        { label: 'S2D usable capacity', value: finalSizing.capacity ? tib(finalSizing.capacity.usableTiB) : 'Not applicable' },
        { label: 'SAN available capacity', value: tib(finalSizing.sanCapacityTiB) },
        { label: 'Planned CSVs / LUNs', value: number(finalSizing.totalCsvs) },
      ],
      bullets: [],
      tables: [{
        title: 'CSV / LUN plan',
        headers: ['Tier', 'Domain', 'Count', 'Size each', 'Total', 'VMs each', 'Filesystem', 'Driver'],
        rows: finalSizing.csvPlans.map((plan) => [
          input.tiers[plan.tier].label,
          plan.domain.toUpperCase(),
          number(plan.count),
          tib(plan.sizeTiB),
          tib(plan.totalTiB),
          number(plan.vmsPerCsv),
          plan.filesystem,
          plan.driver,
        ]),
      }],
    },
    {
      id: 'management',
      title: 'Management plane',
      paragraphs: [
        managementLabel(managementInputs),
        `The management design is sized for ${managementInputs.managedHosts.toLocaleString()} hosts, ${managementInputs.managedVms.toLocaleString()} workload VMs, and ${managementInputs.managedClusters.toLocaleString()} clusters.`,
      ],
      metrics: [
        { label: 'Management instances', value: number(managementPlan.totalInstances) },
        { label: 'Management vCPU', value: number(managementPlan.totalVCpu) },
        { label: 'Management memory', value: gib(managementPlan.totalRamGiB) },
        { label: 'Management disk', value: gib(managementPlan.totalDiskGiB) },
        { label: 'Host impact', value: managementHostDelta === null ? 'Could not compare' : managementHostDelta > 0 ? `+${managementHostDelta} nodes` : 'No additional nodes' },
        { label: 'Azure Arc services', value: managementInputs.includeArc ? `Core + ${managementInputs.arcServices.length} add-on${managementInputs.arcServices.length === 1 ? '' : 's'}` : 'Not selected' },
      ],
      bullets: [...managementPlan.dependencies.map((item) => `Dependency: ${item}`), ...managementPlan.cautions.map((item) => `Caution: ${item}`)],
      tables: [
        {
          title: 'Management-plane bill of materials',
          headers: ['Component', 'Qty', 'Availability', 'vCPU each', 'RAM each', 'Disk each', 'Basis'],
          rows: managementPlan.components.map((component) => [
            component.name,
            number(component.count),
            component.availability,
            component.resourceType === 'vm' ? number(component.vCpu) : 'N/A',
            component.resourceType === 'vm' ? gib(component.ramGiB) : 'N/A',
            gib(component.diskGiB),
            component.basis,
          ]),
        },
        ...(managementPlan.arcServices.length ? [{
          title: 'Selected Azure Arc services',
          headers: ['Service', 'Type', 'Billing basis', 'Deployment requirement'],
          rows: managementPlan.arcServices.map((service) => [service.name, service.category, service.billing, service.requirement]),
        }] : []),
      ],
    },
    {
      id: 'assumptions',
      title: 'Assumptions and policies',
      paragraphs: ['Values marked as planning assumptions should be validated against measured workload behavior and the final hardware bill of materials.'],
      metrics: [
        { label: 'Immediate headroom', value: `${number(growthForecast.plan.immediateHeadroomPct, 1)}%` },
        { label: 'Annual workload growth', value: `${number(growthForecast.plan.annualGrowthPct * 100, 1)}% compounded` },
        { label: 'Growth horizon', value: `${growthForecast.plan.horizonYears} years` },
        { label: 'Growth deployment', value: growthForecast.plan.strategy === 'build-now' ? 'Build terminal forecast now' : 'Add nodes as thresholds are crossed' },
        { label: 'SMT factor', value: number(chosen.cfg.smtFactor, 2) },
        { label: 'Host core reserve', value: `${number(chosen.cfg.hostCoreReservePct * 100, 1)}%` },
        {
          label: 'Host RAM reserve',
          value: `Greater of ${gib(chosen.cfg.hostRamReserveGiB)} or ${number(chosen.cfg.hostRamReservePct * 100, 1)}%`,
          detail: 'The larger value is reserved per host; the two values are not added together.',
        },
        { label: 'Backup method', value: chosen.cfg.backupMethod },
      ],
      bullets: [],
      tables: [{
        title: 'Tier policies',
        headers: ['Tier', 'vCPU:pCore', 'Right-size factor', 'Dynamic memory', 'Storage tier', 'VMs / CSV', 'Blast radius'],
        rows: (Object.keys(input.tiers) as TierId[]).map((tierId) => {
          const tier = input.tiers[tierId]
          return [tier.label, `${tier.oversubscription}:1`, number(tier.rightSizingFactor, 2), yesNo(tier.allowDynamicMemory), tier.storageTier, number(tier.maxVmsPerCsv), `${tier.blastRadiusTiB} TiB`]
        }),
      }],
    },
    {
      id: 'findings',
      title: 'Findings and cautions',
      paragraphs: [],
      metrics: [
        { label: 'Errors', value: number(finalSizing.findings.filter((item) => item.severity === 'error').length) },
        { label: 'Warnings', value: number(finalSizing.findings.filter((item) => item.severity === 'warning').length) },
        { label: 'Information', value: number(finalSizing.findings.filter((item) => item.severity === 'info').length) },
      ],
      bullets: [],
      tables: [{
        headers: ['Severity', 'Basis', 'Finding'],
        rows: finalSizing.findings.map((finding) => [finding.severity.toUpperCase(), finding.basis, finding.message]),
      }],
    },
    {
      id: 'inventory',
      title: 'VM inventory',
      paragraphs: [`${includedVms.length.toLocaleString()} included workload records. The detailed inventory is intentionally placed near the end of the report, immediately before sources and methodology.`],
      metrics: [],
      bullets: [],
      tables: [{
        headers: ['VM', 'Tier', 'vCPU', 'Memory', 'Consumed', 'Provisioned', 'Power state', 'Guest OS'],
        rows: includedVms.map((vm) => [
          vm.name,
          input.tiers[vm.tier].label,
          number(vm.vCpu),
          gib(vm.ramGiB),
          gib(vm.storageGiB),
          gib(vm.provisionedGiB),
          vm.powerState,
          vm.guestOs ?? '',
        ]),
      }],
    },
    {
      id: 'sources',
      title: 'Sources and methodology',
      paragraphs: [
        'Hyper-V Surveyor computes workload demand from included VMs, applies visible tier and host-reserve assumptions, evaluates CPU, memory, and storage independently, and selects the first node count satisfying all constraints.',
        'Microsoft hard limits and recommendations are identified separately from Surveyor planning profiles. Commercial terms and product support statements should be reverified before quotation or implementation.',
      ],
      metrics: [],
      bullets: [],
      tables: [{
        headers: ['Used for', 'Source'],
        rows: [...sourceMap.entries()].map(([source, description]) => [description, source]),
      }],
    },
  ]

  return {
    schemaVersion: 1,
    title: `${input.customerName || 'Hyper-V'} solution report`,
    customerName: input.customerName || 'Untitled design',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    selectedArchitecture: chosen.label,
    sections,
  }
}

export function selectedReportSections(report: SolutionReport, selection: ReportSelection) {
  return report.sections.filter((section) => selection[section.id])
}

export function managementPlaneName(id: PlaneId) {
  return MANAGEMENT_PLANES.find((plane) => plane.id === id)?.name ?? id
}
