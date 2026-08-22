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
import { DEFAULT_PLACEMENT_INPUTS, planMultipleClusters, type PlacementInputs } from '../engine/deploymentPlanning'
import { assessMigrationReadiness } from '../engine/readiness'
import { DEFAULT_NETWORK_INPUTS, designNetwork, type NetworkDesignInputs } from '../engine/networkDesign'
import { DEFAULT_DR_INPUTS, designDisasterRecovery, type DrDesignInputs } from '../engine/drDesign'
import { DEFAULT_REPORT_METADATA, ENGINE_VERSION, type ProjectDataSource, type ReportMetadata } from '../state/project'

export const REPORT_SECTION_DEFINITIONS = [
  { id: 'executive', label: 'Executive summary' },
  { id: 'architecture', label: 'Solution architecture' },
  { id: 'nodes', label: 'Node requirements' },
  { id: 'deployment', label: 'Multi-cluster implementation plan' },
  { id: 'workloads', label: 'Workload summary' },
  { id: 'data-quality', label: 'Sizing evidence and confidence' },
  { id: 'readiness', label: 'Migration readiness' },
  { id: 'storage', label: 'Storage and CSV plan' },
  { id: 'network', label: 'Network design' },
  { id: 'recovery', label: 'Backup and disaster recovery' },
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
  schemaVersion: 2
  title: string
  customerName: string
  generatedAt: string
  selectedArchitecture: string
  metadata: ReportMetadata
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
  placementInputs?: PlacementInputs
  networkDesignInputs?: NetworkDesignInputs
  drDesignInputs?: DrDesignInputs
  reportMetadata?: ReportMetadata
  dataSources?: ProjectDataSource[]
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
  const placementPlan = planMultipleClusters(chosen.cfg, input.vms, input.tiers, input.placementInputs ?? DEFAULT_PLACEMENT_INPUTS)
  const readiness = assessMigrationReadiness(input.vms, chosen.cfg)
  const network = designNetwork(chosen.cfg, placementPlan.totalNodes, input.networkDesignInputs ?? DEFAULT_NETWORK_INPUTS)
  const recovery = designDisasterRecovery(input.vms, chosen.result, input.drDesignInputs ?? DEFAULT_DR_INPUTS)
  const metadata = { ...DEFAULT_REPORT_METADATA, ...input.reportMetadata }
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
  network.findings.forEach((finding) => { if (finding.source) sourceMap.set(finding.source, finding.message) })
  recovery.findings.forEach((finding) => { if (finding.source) sourceMap.set(finding.source, finding.message) })

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
      bullets: [
        ...(metadata.decisionNotes ? [`Decision / sign-off: ${metadata.decisionNotes}`] : []),
        ...(finalSizing.feasible ? [] : finalSizing.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.message)),
      ],
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
              ? point.result.sanCapacityTiB !== null && point.result.requiredSanTiB > point.result.sanCapacityTiB
                ? `Expand SAN effective capacity by ${number(point.result.requiredSanTiB - point.result.sanCapacityTiB, 1)} TiB`
                : 'Review node density or split into multiple clusters'
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
      id: 'deployment',
      title: 'Multi-cluster implementation plan',
      paragraphs: [placementPlan.feasible
        ? `The selected placement policy distributes the estate across ${placementPlan.clusters.length} target cluster(s) using ${placementPlan.totalNodes} total nodes.`
        : 'The selected placement constraints cannot place the full estate. Revise the cluster ceiling, hardware density, or grouping rules before implementation.'],
      metrics: [
        { label: 'Target clusters', value: number(placementPlan.clusters.length) },
        { label: 'Total nodes', value: placementPlan.feasible ? number(placementPlan.totalNodes) : 'Review required' },
        { label: 'Workload-bearing nodes', value: placementPlan.feasible ? number(placementPlan.totalWorkloadNodes) : 'Review required' },
        { label: 'Placement status', value: placementPlan.feasible ? 'Feasible' : 'Needs revision' },
      ],
      bullets: placementPlan.warnings,
      tables: [{
        title: 'Target cluster plan',
        headers: ['Cluster', 'Purpose', 'VMs', 'Nodes', 'Binding constraint', 'Source clusters', 'Data confidence'],
        rows: placementPlan.clusters.map((cluster) => [
          cluster.name,
          cluster.purpose,
          number(cluster.vms.length),
          cluster.result.feasible ? number(cluster.result.nodes) : 'Review',
          cluster.result.binding,
          cluster.sourceClusters.join(', ') || 'Mixed / not provided',
          `${cluster.result.performanceAssessment.confidence.replace('-', ' ')} (${cluster.result.performanceAssessment.score}/100)`,
        ]),
      }],
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
      id: 'data-quality',
      title: 'Sizing evidence and confidence',
      paragraphs: [
        finalSizing.performanceAssessment.basis === 'measured-p95'
          ? `CPU and memory use per-VM P95 measurements where available, multiplied by a ${number(chosen.cfg.performanceComfortFactor ?? 1.25, 2)}x comfort factor. A ${number(chosen.cfg.cpuPerformanceFactor ?? 1, 2)}x target/source per-core benchmark factor is applied to CPU. Missing measurements fall back to the tier allocation policy; a measured resource does not also receive the tier right-sizing factor.`
          : 'CPU and memory are sized from allocation. Imported performance data is informational until measured P95 sizing is selected.',
      ],
      metrics: [
        { label: 'Sizing basis', value: finalSizing.performanceAssessment.basis === 'measured-p95' ? 'Measured P95 with fallback' : 'Allocation' },
        { label: 'Confidence', value: `${finalSizing.performanceAssessment.confidence.replace('-', ' ')} (${finalSizing.performanceAssessment.score}/100)` },
        { label: 'CPU P95 coverage', value: `${number(finalSizing.performanceAssessment.cpuCoveragePct, 1)}%` },
        { label: 'Memory P95 coverage', value: `${number(finalSizing.performanceAssessment.memoryCoveragePct, 1)}%` },
        { label: 'Storage performance coverage', value: `${number(finalSizing.performanceAssessment.storagePerformanceCoveragePct, 1)}%` },
        { label: '7+ day observation coverage', value: `${number(finalSizing.performanceAssessment.observationCoveragePct, 1)}%` },
      ],
      bullets: finalSizing.performanceAssessment.notes,
      tables: input.dataSources?.length ? [{
        title: 'Imported data sources',
        headers: ['Type', 'File', 'Imported', 'Rows'],
        rows: input.dataSources.map((source) => [source.kind, source.fileName, source.importedAt ? new Date(source.importedAt).toLocaleString() : '', number(source.rows)]),
      }] : [],
    },
    {
      id: 'readiness',
      title: 'Migration readiness',
      paragraphs: ['Readiness uses the source metadata available in the imported inventory. Application-owner validation, test migration, backup verification, and cluster validation remain required.'],
      metrics: [
        { label: 'Ready', value: number(readiness.ready) },
        { label: 'Review', value: number(readiness.review) },
        { label: 'Blocked', value: number(readiness.blocked) },
        { label: 'Assessed', value: number(readiness.assessed) },
      ],
      bullets: [],
      tables: [{
        title: 'Readiness exceptions',
        headers: ['VM', 'Status', 'Category', 'Finding', 'Required action'],
        rows: readiness.findings.map((finding) => [finding.vmName, finding.status, finding.category, finding.finding, finding.action]),
      }],
    },
    {
      id: 'storage',
      title: 'Storage and CSV plan',
      paragraphs: [
        'Capacity values use consumed workload storage after the selected immediate-headroom and growth strategy, followed by the configured resiliency or SAN efficiency assumptions.',
        finalSizing.storagePerformance.validated
          ? `Storage performance is validated against the entered sustainable IOPS and throughput capabilities with ${number(finalSizing.storagePerformance.measuredVmCoveragePct, 1)}% VM coverage.`
          : `Storage performance is not fully validated. Matched IOPS/throughput coverage is ${number(finalSizing.storagePerformance.measuredVmCoveragePct, 1)}%; enter sustainable capabilities for each active domain and validate peak concurrency before approval.`,
      ],
      metrics: [
        { label: 'Required storage', value: tib(finalSizing.requiredStorageTiB) },
        { label: 'Required on S2D', value: tib(finalSizing.requiredS2dTiB) },
        { label: 'Required on SAN', value: tib(finalSizing.requiredSanTiB) },
        { label: 'S2D usable capacity', value: finalSizing.capacity ? tib(finalSizing.capacity.usableTiB) : 'Not applicable' },
        { label: 'SAN available capacity', value: tib(finalSizing.sanCapacityTiB) },
        { label: 'Planned CSVs / LUNs', value: number(finalSizing.totalCsvs) },
        { label: 'Performance validation', value: finalSizing.storagePerformance.validated ? 'Validated' : 'Incomplete' },
      ],
      bullets: [],
      tables: [
        {
          title: 'Storage performance',
          headers: ['Domain', 'Required IOPS', 'Available IOPS', 'Required MB/s', 'Available MB/s'],
          rows: [
            ...(chosen.cfg.architecture === 's2d' || chosen.cfg.architecture === 'hybrid' ? [[
              'S2D', number(finalSizing.storagePerformance.requiredS2dIops), finalSizing.storagePerformance.availableS2dIops === null ? 'Not entered' : number(finalSizing.storagePerformance.availableS2dIops), number(finalSizing.storagePerformance.requiredS2dThroughputMBps), finalSizing.storagePerformance.availableS2dThroughputMBps === null ? 'Not entered' : number(finalSizing.storagePerformance.availableS2dThroughputMBps),
            ]] : []),
            ...(chosen.cfg.architecture === 'san' || chosen.cfg.architecture === 'hybrid' ? [[
              'SAN', number(finalSizing.storagePerformance.requiredSanIops), finalSizing.storagePerformance.availableSanIops === null ? 'Not entered' : number(finalSizing.storagePerformance.availableSanIops), number(finalSizing.storagePerformance.requiredSanThroughputMBps), finalSizing.storagePerformance.availableSanThroughputMBps === null ? 'Not entered' : number(finalSizing.storagePerformance.availableSanThroughputMBps),
            ]] : []),
          ],
        },
        {
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
        },
      ],
    },
    {
      id: 'network',
      title: 'Network design',
      paragraphs: ['The host-network design separates management, compute, live migration, and storage intent while identifying switch and RDMA dependencies that must be validated against the physical fabric.'],
      metrics: [
        { label: 'Adapters / node', value: number((input.networkDesignInputs ?? DEFAULT_NETWORK_INPUTS).adaptersPerNode) },
        { label: 'Adapter speed', value: `${number((input.networkDesignInputs ?? DEFAULT_NETWORK_INPUTS).adapterSpeedGbps)} Gbps` },
        { label: 'Aggregate / node', value: `${number(network.aggregateGbpsPerNode)} Gbps` },
        { label: 'Host switch ports', value: number(network.totalHostPorts) },
        { label: 'RDMA', value: (input.networkDesignInputs ?? DEFAULT_NETWORK_INPUTS).rdmaProtocol.toUpperCase() },
      ],
      bullets: network.findings.map((finding) => `${finding.severity.toUpperCase()}: ${finding.message}`),
      tables: [{ title: 'Network intents', headers: ['Intent'], rows: network.intentSummary.map((intent) => [intent]) }],
    },
    {
      id: 'recovery',
      title: 'Backup and disaster recovery',
      paragraphs: ['Cluster high availability protects against selected local failures; the recovery design separately addresses site loss, corruption, and restoration objectives. Replication bandwidth remains an estimate until measured changed-block data is available.'],
      metrics: [
        { label: 'Strategy', value: (input.drDesignInputs ?? DEFAULT_DR_INPUTS).strategy },
        { label: 'Protected VMs', value: number(recovery.protectedVms) },
        { label: 'Protected storage', value: tib(recovery.protectedStorageTiB) },
        { label: 'Secondary storage', value: tib(recovery.secondaryStorageTiB) },
        { label: 'Estimated burst WAN', value: `${number(recovery.estimatedBurstMbps, 1)} Mbps`, detail: recovery.bandwidthPasses ? 'Within entered WAN capacity' : 'Above entered WAN capacity' },
        { label: 'RPO / RTO', value: `${number((input.drDesignInputs ?? DEFAULT_DR_INPUTS).rpoMinutes, 1)} min / ${number((input.drDesignInputs ?? DEFAULT_DR_INPUTS).rtoHours, 1)} hr` },
      ],
      bullets: recovery.findings.map((finding) => `${finding.severity.toUpperCase()}: ${finding.message}`),
      tables: [],
    },
    {
      id: 'management',
      title: 'Management plane',
      paragraphs: [
        managementLabel(managementInputs),
        `The management design is sized for ${managementInputs.managedHosts.toLocaleString()} hosts, ${managementInputs.managedVms.toLocaleString()} workload VMs, and ${managementInputs.managedClusters.toLocaleString()} clusters.`,
        `Management components are placed on ${managementInputs.managementPlacement.replace(/-/g, ' ')}.`,
      ],
      metrics: [
        { label: 'Management instances', value: number(managementPlan.totalInstances) },
        { label: 'Management vCPU', value: number(managementPlan.totalVCpu) },
        { label: 'Management memory', value: gib(managementPlan.totalRamGiB) },
        { label: 'Management disk', value: gib(managementPlan.totalDiskGiB) },
        { label: 'Host impact', value: managementHostDelta === null ? 'Could not compare' : managementHostDelta > 0 ? `+${managementHostDelta} nodes` : 'No additional nodes' },
        { label: 'Azure Arc services', value: managementInputs.includeArc ? `Core + ${managementInputs.arcServices.length} add-on${managementInputs.arcServices.length === 1 ? '' : 's'}` : 'Not selected' },
        { label: 'Arc connectivity', value: managementInputs.includeArc ? `${managementInputs.arcConnectivity} · ${managementInputs.arcRegion}` : 'Not applicable' },
        { label: 'Arc guest scope', value: managementInputs.includeArc ? `${number(managementInputs.arcGuestScopePct, 1)}% of managed VMs` : 'Not applicable' },
        { label: 'SCOM collection', value: managementInputs.monitoring === 'scom' ? `${number(managementInputs.scomDailyDataGiB, 1)} GiB/day · ${managementInputs.scomWarehouseRetentionDays} warehouse days` : 'Not selected' },
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
        { label: 'Quorum witness', value: chosen.cfg.witnessType ?? 'Not selected' },
        { label: 'Sizing evidence', value: finalSizing.performanceAssessment.basis === 'measured-p95' ? `Measured P95 × ${number(chosen.cfg.performanceComfortFactor ?? 1.25, 2)}` : 'Allocation' },
        { label: 'CPU benchmark factor', value: finalSizing.performanceAssessment.basis === 'measured-p95' ? `${number(chosen.cfg.cpuPerformanceFactor ?? 1, 2)}x target/source per core` : 'Not applied' },
      ],
      bullets: [],
      tables: [{
        title: 'Tier policies',
        headers: ['Tier', 'vCPU:pCore', 'Right-size factor', 'Dynamic memory policy', 'Storage tier', 'Hybrid placement', 'VMs / CSV', 'Blast radius'],
        rows: (Object.keys(input.tiers) as TierId[]).map((tierId) => {
          const tier = input.tiers[tierId]
          return [tier.label, `${tier.oversubscription}:1`, number(tier.rightSizingFactor, 2), yesNo(tier.allowDynamicMemory), tier.storageTier, tier.hybridPlacement ?? (tier.storageTier === 'performance' ? 's2d' : 'san'), number(tier.maxVmsPerCsv), `${tier.blastRadiusTiB} TiB`]
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
        headers: ['VM', 'Tier', 'vCPU', 'Memory', 'Consumed', 'Provisioned', 'CPU P95', 'Memory P95', 'Source cluster', 'Power state', 'Guest OS'],
        rows: includedVms.map((vm) => [
          vm.name,
          input.tiers[vm.tier].label,
          number(vm.vCpu),
          gib(vm.ramGiB),
          gib(vm.storageGiB),
          gib(vm.provisionedGiB),
          vm.performance?.cpuP95Pct === undefined ? '' : `${number(vm.performance.cpuP95Pct, 1)}%`,
          vm.performance?.memoryP95Pct === undefined ? '' : `${number(vm.performance.memoryP95Pct, 1)}%`,
          vm.sourceCluster ?? '',
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
        `Microsoft hard limits and recommendations are identified separately from Surveyor planning profiles. This report was produced by calculation engine ${ENGINE_VERSION}. Commercial terms and product support statements should be reverified before quotation or implementation.`,
      ],
      metrics: [],
      bullets: [],
      tables: [
        ...(input.dataSources?.length ? [{ title: 'Project data sources', headers: ['Type', 'File', 'Imported', 'Rows'], rows: input.dataSources.map((source) => [source.kind, source.fileName, source.importedAt ? new Date(source.importedAt).toLocaleString() : '', number(source.rows)]) }] : []),
        { title: 'Technical references', headers: ['Used for', 'Source'], rows: [...sourceMap.entries()].map(([source, description]) => [description, source]) },
      ],
    },
  ]

  return {
    schemaVersion: 2,
    title: `${input.customerName || 'Hyper-V'} solution report`,
    customerName: input.customerName || 'Untitled design',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    selectedArchitecture: chosen.label,
    metadata,
    sections,
  }
}

export function selectedReportSections(report: SolutionReport, selection: ReportSelection) {
  return report.sections.filter((section) => selection[section.id])
}

export function managementPlaneName(id: PlaneId) {
  return MANAGEMENT_PLANES.find((plane) => plane.id === id)?.name ?? id
}
