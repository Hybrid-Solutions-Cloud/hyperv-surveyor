/**
 * Workbook exports. Every sheet is built from the resolved platform design, so the workbook shows
 * the numbers the pages and the report show. The sheet data is built by pure functions that tests
 * read directly; the download only writes those rows.
 */
import * as XLSX from 'xlsx'
import type { ArchitectureOption } from '../engine/solve'
import { giBToTiB } from '../engine/compute'
import { RESILIENCY, TIER_IDS } from '../engine/rules'
import type { SizingResult, Vm } from '../engine/types'
import { additionalVmsByTier, computeHostsToAdd, exhaustionText, existingVerdictLabel, hostGroupLabel, RESOURCE_LABELS, usedShareText } from '../engine/existingHardware'
import { singleClusterNodesLabel, type PlatformDesign } from '../engine/platformDesign'
import type { CostModelInputs } from '../engine/licensing'
import { buildLicensingContent, licensingSheetRows } from '../report/licensingReport'

const r1 = (n: number) => Math.round(n * 10) / 10
const r0 = (n: number) => Math.round(n)
/** Infinity and NaN are not readable in a spreadsheet. */
const finite = (n: number, unit = 'n/a') => Number.isFinite(n) ? n : unit

export interface WorkbookSheet {
  name: string
  rows: unknown[][]
}

/** The Licensing sheet, only when the report's licensing option is on. Same content as the report section. */
export function licensingSheet(design: PlatformDesign, vms: Vm[], costModel: CostModelInputs | null | undefined): WorkbookSheet[] {
  if (!costModel?.includeInReport) return []
  return [{ name: 'Licensing', rows: licensingSheetRows(buildLicensingContent(design, vms, costModel, design.options)) }]
}

/** A design that does not fit reports the node count it needs, never the cluster limit. */
function nodesForExport(result: SizingResult): number | string {
  return result.feasible ? result.nodes : singleClusterNodesLabel(result)
}

function protectionLabel(design: PlatformDesign): string {
  const cfg = design.cfg
  if (cfg.architecture === 'san') return 'External SAN (array-managed; not modeled)'
  if (cfg.architecture === 'hybrid') return `S2D: ${RESILIENCY[cfg.resiliency].label}; SAN: array-managed`
  return RESILIENCY[cfg.resiliency].label
}

/** Available storage for one option: S2D usable plus SAN effective, the same as the Results page. */
function optionStorage(option: ArchitectureOption) {
  const s = option.result
  return {
    s2d: s.feasible && s.capacity ? r1(s.capacity.usableTiB) : '—',
    san: s.sanCapacityTiB !== null ? r1(s.sanCapacityTiB) : '—',
    total: s.feasible && (s.capacity || s.sanCapacityTiB !== null) ? r1((s.capacity?.usableTiB ?? 0) + (s.sanCapacityTiB ?? 0)) : '—',
  }
}

function inventoryRows(vms: Vm[]): unknown[][] {
  const rows: unknown[][] = [[
    'VM', 'Tier', 'Included', 'Power state', 'vCPU', 'RAM (GiB)',
    'Consumed (GiB)', 'Provisioned (GiB, not sized)', 'Thin gap (GiB)', 'Guest OS',
    'Source cluster', 'Source host', 'Source CPU vendor', 'Firmware', 'Disks', 'NICs', 'Snapshots', 'RDM', 'Encrypted', 'vTPM',
    'CPU P95 %', 'Memory P95 %', 'IOPS P95', 'Throughput MBps P95', 'Latency ms P95', 'Network Mbps P95', 'Observation days', 'Performance source', 'Auto-classified',
  ]]
  for (const v of vms) {
    rows.push([v.name, v.tier, v.include ? 'YES' : 'no', v.powerState, v.vCpu, r1(v.ramGiB),
      r1(v.storageGiB), r1(v.provisionedGiB), r1(Math.max(0, v.provisionedGiB - v.storageGiB)),
      v.guestOs ?? '', v.sourceCluster ?? '', v.sourceHost ?? '', v.sourceCpuVendor ?? '', v.firmware ?? '', v.diskCount ?? '', v.nicCount ?? '', v.snapshotCount ?? '', v.hasRdm ? 'YES' : '', v.encrypted ? 'YES' : '', v.hasVtpm ? 'YES' : '',
      v.performance?.cpuP95Pct ?? '', v.performance?.memoryP95Pct ?? '', v.performance?.storageIopsP95 ?? '', v.performance?.storageThroughputMBpsP95 ?? '', v.performance?.storageLatencyMsP95 ?? '', v.performance?.networkMbpsP95 ?? '', v.performance?.observationDays ?? '', v.performance?.source ?? '', v.autoClassified ? 'YES' : ''])
  }
  return rows
}

function growthSheet(design: PlatformDesign): WorkbookSheet {
  const growth = design.growth
  const rows: unknown[][] = [['CAPACITY GROWTH PLAN']]
  if (!growth) {
    rows.push(['Not calculated: add workloads to forecast growth.'])
    return { name: 'Growth Plan', rows }
  }
  const showSan = growth.points.some((point) => point.sanToBuyUsableTiB !== null)
  rows.push(
    ['Annual growth compounds across CPU, memory, and consumed storage while preserving N+n at each forecast point.'],
    ['Forecast scope', growth.scopeLabel],
    ['Strategy', growth.plan.strategy === 'build-now' ? 'Build terminal forecast capacity now' : 'Phase nodes as demand crosses thresholds'],
    ['Immediate headroom', `${r1(growth.plan.immediateHeadroomPct)}%`],
    ['Annual growth', `${r1(growth.plan.annualGrowthPct * 100)}%`],
    ['Horizon', `${growth.plan.horizonYears} years`],
    [],
    ['Timeline', 'Demand multiplier', 'Nodes required', 'Binding constraint', ...(showSan ? ['SAN usable to buy (TiB)'] : []), 'Deployment action'],
  )
  growth.points.forEach((point) => rows.push([
    point.year === 0 ? 'Today' : `Year ${point.year}`,
    r1(point.demandFactor),
    point.nodes ?? point.nodesLabel,
    point.binding,
    ...(showSan ? [point.sanToBuyUsableTiB === null ? 'Not calculated' : r1(point.sanToBuyUsableTiB)] : []),
    point.action,
  ]))
  return { name: 'Growth Plan', rows }
}

function storagePlanSheet(design: PlatformDesign): WorkbookSheet {
  const cfg = design.cfg
  const storage = design.storage
  const title = cfg.architecture === 'san'
    ? 'SAN CSV / LUN LAYOUT PLAN'
    : cfg.architecture === 's2d' ? 'S2D VOLUME / CSV LAYOUT PLAN' : 'HYBRID STORAGE VOLUME LAYOUT PLAN'
  const rows: unknown[][] = [
    [title],
    ['This is a logical workload-volume plan, not a physical disk or RAID layout. A SAN LUN maps 1:1 to a CSV; an S2D volume/CSV has no SAN LUN.'],
  ]
  if (!storage?.csvPlans) {
    rows.push([], [storage?.csvNotCalculatedReason ?? 'Not calculated: add workloads first.'])
    return { name: 'CSV Plan', rows }
  }
  rows.push(
    ['SAN layout mode', cfg.sanCsvLayoutMode ?? 'balanced', 'Custom SAN target', cfg.sanCustomCsvCount ?? 'Not set'],
    ['Balanced SAN starts at one CSV/LUN per node in a SAN-only cluster and treats tier recovery targets as advisory. Granular mode enforces those targets.'],
    [],
    [...(storage.perCluster ? ['Cluster'] : []), 'Tier', 'Storage tier', 'Storage object', 'Filesystem', 'Planned storage (TiB)', 'Planned VMs',
      'Applied max size (TiB)', 'Count by applied size', 'Target max VMs / recovery unit',
      'Count by VM grouping', 'Granular alternative', 'Recovery targets applied', 'Layout mode',
      'Base count', 'Final count', 'Size each (TiB)', 'VMs each', 'Controlling rule'],
  )
  for (const p of storage.csvPlans) {
    rows.push([...(storage.perCluster ? [p.cluster ?? ''] : []), p.tier, p.storageTier, p.domain === 'san' ? 'SAN CSV / LUN' : 'S2D volume / CSV', p.filesystem,
      r1(p.totalTiB), p.plannedVms, r1(p.maxSizeTiB), p.countByCapacity, p.maxVmsPerCsv,
      p.countByVmLimit, p.granularAdvisoryCount, p.recoveryGroupingApplied ? 'Yes' : 'Advisory', p.layoutMode,
      p.roundedUpFrom, p.count, r1(p.sizeTiB), p.vmsPerCsv, p.driver])
  }
  rows.push([], ['Total logical storage objects', storage.totalCsvs], ['Count above 64', 'Generates a design warning'],
    [], ['NOTE: Microsoft imposes NO limit on VMs per CSV. Recovery-unit size and target VMs per recovery unit are editable TOOL assumptions.'],
    ['For SAN, Balanced and Custom modes report those recovery targets as an alternative; Granular mode enforces them.'],
    ['Workload growth increases logical capacity and equivalent planned VM count. The imported inventory count remains unchanged.'])
  return { name: 'CSV Plan', rows }
}

/** What to buy for the selected design, from the same bill of materials as the page and report. */
export function bomSheet(design: PlatformDesign): WorkbookSheet {
  const bom = design.bom
  if (!bom.available) return { name: 'What to Buy', rows: [['WHAT TO BUY'], [bom.reason ?? 'Not available.']] }
  return {
    name: 'What to Buy',
    rows: [
      [bom.title.toUpperCase()],
      ['Recommended starting points: validate with your vendor and the Windows Server Catalog.'],
      [],
      ['Category', 'Item', 'Quantity', 'Detail', 'Basis', 'Source'],
      ...bom.lines.map((line) => [line.category, line.item, line.quantity, line.detail, line.basis, line.source ?? '']),
      [],
      ['SAN connectivity', bom.sanConnectivity.note],
      [],
      ['Caveats'],
      ...bom.caveats.map((caveat) => [caveat]),
    ],
  }
}

/** The Implementation plan: readiness, network with SAN connectivity, and recovery, from the resolved design. */
export function implementationSheets(design: PlatformDesign): WorkbookSheet[] {
  const { readiness, network, networkInputs, recovery, recoveryInputs } = design.implementation
  const sheets: WorkbookSheet[] = []
  if (readiness) {
    sheets.push({ name: 'Readiness', rows: [
      ['MIGRATION READINESS'],
      [readiness.readyMeaning],
      ['Ready', readiness.ready],
      ['Review', readiness.review],
      ['Blocked', readiness.blocked],
      ['Assessed', readiness.assessed],
      [],
      ['VM', 'Status', 'Category', 'Finding', 'Required action', 'Source'],
      ...readiness.findings.map((finding) => [finding.vmName, finding.status, finding.category, finding.finding, finding.action, finding.source ?? '']),
      ...(readiness.notChecked.length > 0 ? [[], ['CHECKS NOT RUN (DATA MISSING)'], ['Check', 'VMs', 'Data it needs'], ...readiness.notChecked.map((gap) => [gap.check, gap.vms, gap.needs])] : []),
    ] })
  }
  if (design.path !== 'management-only') {
    sheets.push({ name: 'Network', rows: network ? [
      ['HOST NETWORK DESIGN'],
      ['Nodes', design.network.nodes],
      ['Host switch ports', network.totalHostPorts],
      ['BMC ports', network.bmcPorts],
      ['Aggregate per host (Gbps)', network.aggregateGbpsPerNode],
      ['RDMA', networkInputs.rdmaProtocol],
      [],
      ['Intent', 'Traffic', 'Adapters per host', 'Speed (Gbps)', 'SET team', 'Ports'],
      ...network.intents.map((intent) => [intent.name, intent.types.join(', '), intent.adapters, intent.speedGbps, intent.setTeam ? 'Yes' : 'No', intent.portsTotal]),
      ...(network.san ? [[], ['SAN CONNECTIVITY'],
        ['Protocol', network.san.protocol],
        ['Adapters per host', networkInputs.san.adaptersPerHost],
        ['Ports per adapter', networkInputs.san.portsPerAdapter],
        ['Speed (Gbps)', networkInputs.san.speedGbps],
        ['Host ports', network.san.totalHostPorts],
        ['Fabrics', networkInputs.san.fabrics],
        ['Fabric ports needed', network.san.fabricPortsNeeded],
        ['Paths per LUN', networkInputs.san.pathsPerLun],
        ['Most paths possible', network.san.maxPathsPerLun],
        ['MPIO', networkInputs.san.mpio ? 'On' : 'Off']] : []),
      ...(network.traffic ? [[], ['NETWORK P95'], ['Sum of VM P95 (Mbps)', Math.round(network.traffic.totalP95Mbps)], ['Compute bandwidth (Mbps)', Math.round(network.traffic.computeMbps)], ['VMs measured', network.traffic.measuredVms]] : []),
      [], ['Severity', 'Finding', 'Source'],
      ...network.findings.map((finding) => [finding.severity.toUpperCase(), finding.message, finding.source ?? '']),
    ] : [['HOST NETWORK DESIGN'], [design.network.reason ?? 'Not calculated.']] })
    sheets.push({ name: 'Recovery', rows: !recovery || recoveryInputs.strategy === 'none' ? [
      ['BACKUP AND DISASTER RECOVERY'], ['Strategy', 'Not selected'], ['No protected scope, WAN or recovery-time figures are given.'],
    ] : [
      ['BACKUP AND DISASTER RECOVERY'],
      ['Strategy', recoveryInputs.strategy],
      ['RPO (minutes)', recoveryInputs.rpoMinutes],
      ['RTO (hours)', recoveryInputs.rtoHours],
      ['Protected VMs', recovery.protectedVms],
      ['Protected storage (TiB)', Math.round(recovery.protectedStorageTiB * 100) / 100],
      ['Secondary storage (TiB)', Math.round(recovery.secondaryStorageTiB * 100) / 100],
      ['Estimated burst WAN (Mbps)', recovery.estimatedBurstMbps === null ? 'Not applicable' : Math.round(recovery.estimatedBurstMbps)],
      ['Replication interval (minutes)', recovery.replicationIntervalMinutes ?? 'Not applicable'],
      ['RPO check', recovery.rpoPasses === null ? 'Validate with your vendor' : recovery.rpoPasses ? 'Meets' : 'Misses'],
      ['Recovery estimate (hours)', recovery.estimatedRecoveryHours === null ? 'Not estimated' : Math.round(recovery.estimatedRecoveryHours * 10) / 10],
      ['RTO check', recovery.rtoPasses === null ? 'Not estimated' : recovery.rtoPasses ? 'Meets' : 'Misses'],
      ['Initial copy over the WAN (days)', recovery.seedingDays === null ? 'Not applicable' : Math.round(recovery.seedingDays * 10) / 10],
      ['Secondary hosts', recovery.secondaryHosts ?? 'Not applicable'],
      [], ['ASSUMPTIONS'], ...recovery.assumptions.map((item) => [item]),
      ...(recovery.asrBlockers.length > 0 ? [[], ['AZURE SITE RECOVERY BLOCKERS'], ['VM', 'Blocker'], ...recovery.asrBlockers.map((item) => [item.vmName, item.reason])] : []),
      [], ['Severity', 'Finding', 'Source'],
      ...recovery.findings.map((finding) => [finding.severity.toUpperCase(), finding.message, finding.source ?? '']),
    ] })
  }
  return sheets
}

function findingsSheet(design: PlatformDesign): WorkbookSheet {
  return {
    name: 'Findings',
    rows: [
      ['VALIDATION FINDINGS'],
      ['Basis: MS = Microsoft hard rule · MS-REC = Microsoft recommendation · TOOL = our assumption'],
      ['Design status', design.headline],
      [],
      ['Severity', 'Basis', 'Code', 'Message', 'Source'],
      ...(design.status === 'split-failed' ? design.placement?.warnings.map((warning) => ['ERROR', 'TOOL', 'SPLIT_NOT_FEASIBLE', warning, '']) ?? [] : []),
      ...design.findings.map((f) => [f.severity.toUpperCase(), f.basis, f.code, f.message, f.source ?? '']),
    ],
  }
}

function storageRows(design: PlatformDesign): unknown[][] {
  const storage = design.storage
  if (!storage) return []
  const rows: unknown[][] = [[], ['STORAGE'],
    ['Required storage (TiB)', r1(storage.requiredTiB)],
  ]
  if (storage.architecture !== 'san') rows.push(['S2D usable capacity (TiB)', storage.s2dUsableTiB === null ? 'Not calculated' : r1(storage.s2dUsableTiB)])
  if (storage.sanMode) {
    rows.push(['SAN data reduction ratio', `${storage.sanDrr}:1`])
    if (storage.sanMode === 'calculated') {
      rows.push(
        ['SAN usable capacity to buy (TiB)', storage.sanToBuyUsableTiB === null ? 'Not calculated' : r1(storage.sanToBuyUsableTiB)],
        ['SAN effective capacity to buy (TiB, usable × DRR)', storage.sanToBuyEffectiveTiB === null ? 'Not calculated' : r1(storage.sanToBuyEffectiveTiB)],
      )
    } else {
      rows.push(
        ['SAN usable capacity entered (TiB)', storage.sanUsableTiB === null ? '—' : r1(storage.sanUsableTiB)],
        ['SAN effective capacity (TiB, usable × DRR)', storage.sanEffectiveTiB === null ? '—' : r1(storage.sanEffectiveTiB)],
      )
    }
    rows.push(['SAN free-space target', `${r0((storage.sanFreeSpaceTargetPct ?? 0) * 100)}%`])
  }
  return rows
}

/** Sheets for the new-platform workbook. */
export function designWorkbookSheets(design: PlatformDesign, vms: Vm[], generatedAt = new Date().toISOString(), costModel?: CostModelInputs | null): WorkbookSheet[] {
  const chosen = design.chosen
  if (!chosen || !design.sizing) return [{ name: 'Summary', rows: [['Hyper-V Surveyor — Sizing Result'], ['No new-platform design to export.']] }]
  const r = design.sizing
  const cfg = design.cfg
  const summary: unknown[][] = [
    ['Hyper-V Surveyor — Sizing Result'],
    ['Generated', generatedAt.slice(0, 16).replace('T', ' ')],
    [],
    ['ARCHITECTURE COMPARISON (one cluster each)'],
    ['Architecture', 'Nodes', 'Workload nodes', 'Fits one cluster', 'Binding constraint', 'S2D usable (TiB)', 'SAN effective (TiB)', 'Available (TiB)',
      'Required (TiB)', 'CSVs', 'Licensable cores', 'N+n overhead %'],
  ]
  for (const o of design.options) {
    const s = o.result
    const store = optionStorage(o)
    summary.push([
      o.label, nodesForExport(s), s.feasible ? s.workloadNodes : '—', s.feasible ? 'YES' : 'NO', s.binding,
      store.s2d, store.san, store.total,
      r1(s.requiredStorageTiB), s.feasible ? s.totalCsvs : '—', s.feasible ? s.totalLicensableCores : '—', s.feasible ? r1(s.resiliencyOverheadPct) : '—',
    ])
  }
  summary.push([], ['SELECTED DESIGN'],
    ['Architecture', chosen.label],
    ['Storage protection', protectionLabel(design)],
    ['Cluster layout', design.splitRequested ? 'Split into multiple clusters (your choice)' : 'One cluster'],
    ['Status', design.headline],
    ['Total nodes', design.totalNodes ?? design.nodesLabel],
    ['Workload nodes (after N+n)', design.workloadNodes ?? '—'],
    ['Target clusters', design.clusters.length],
    ['Licensable cores', design.licensableCores ?? design.licensableCoresDetail],
    ['Management VMs counted in sizing', design.management.countedVms.length],
    ['Management host impact', design.management.impactLabel],
    ['Binding constraint', r.binding], ['Explanation', design.explanation],
    ['Nodes if CPU alone', finite(r.nodesIfCpuOnly)],
    ['Nodes if memory alone', finite(r.nodesIfMemoryOnly)],
    ['Nodes if storage alone', finite(r.nodesIfStorageOnly)],
  )
  if (design.clusters.length > 0) {
    summary.push([], ['TARGET CLUSTERS'], ['Cluster', 'Purpose', 'Workload VMs', 'Management VMs', 'Nodes', 'Workload nodes', 'Binding', 'Required storage (TiB)', 'S2D usable (TiB)', 'SAN usable to buy (TiB)', 'Licensable cores'])
    design.clusters.forEach((cluster) => summary.push([
      cluster.name, cluster.purpose, cluster.workloadVms, cluster.managementVms, cluster.feasible && cluster.nodes !== null ? cluster.nodes : cluster.nodesLabel, cluster.workloadNodes ?? '—', cluster.binding,
      r1(cluster.requiredStorageTiB), cluster.s2dUsableTiB === null ? '—' : r1(cluster.s2dUsableTiB), cluster.sanToBuyUsableTiB === null ? '—' : r1(cluster.sanToBuyUsableTiB), cluster.licensableCores ?? '—',
    ]))
  }
  summary.push(...storageRows(design))
  summary.push([], ['NODE SPEC'],
    ['Sockets', cfg.node.sockets], ['Cores per socket', cfg.node.coresPerSocket],
    ['Total physical cores', cfg.node.sockets * cfg.node.coresPerSocket],
    ['Licensable cores per node (16/server, 8/socket minimum)', r.licensableCoresPerNode],
    ['RAM (GiB)', cfg.node.ramGiB],
    ...(design.storage?.showLocalDrives !== false ? [
      ['Capacity drives per node', cfg.node.capacityDrivesPerNode],
      ['Capacity drive size (TB)', cfg.node.capacityDriveTB],
      ['Cache drives per node', cfg.node.cacheDrivesPerNode],
      ['Cache drive size (TB)', cfg.node.cacheDriveTB],
      ['Media', cfg.node.media],
    ] : [['Local drives', 'Not used: workload data is on the SAN']]),
    [], ['WORKLOAD DEMAND'],
    ['VMs included', r.demand.vmCount],
    ['Total vCPU allocated', r0(r.demand.totalVCpu)],
    ['Physical cores required', r1(r.demand.requiredPCores)],
    ['RAM required (GiB)', r0(r.demand.requiredRamGiB)],
    ['Storage required (TiB)', r1(design.storage?.requiredTiB ?? r.requiredStorageTiB)],
  )
  if (design.growth) {
    const plan = design.growth.plan
    summary.push(
      ['Immediate headroom', `${r1(plan.immediateHeadroomPct)}%`],
      ['Annual workload growth', `${r1(plan.annualGrowthPct * 100)}%`],
      ['Growth horizon', `${plan.horizonYears} years`],
      ['Growth deployment strategy', plan.strategy === 'build-now' ? 'Build terminal forecast now' : 'Add nodes as thresholds are crossed'],
    )
  }
  // The S2D chain describes a built cluster, so a design that does not fit has none.
  if (r.capacity && design.status === 'feasible') {
    const c = r.capacity
    summary.push([], ['S2D CAPACITY CHAIN'],
      ['Raw pool (TiB)', r1(c.rawTiB)],
      ['Reserve — 1 drive/server, capped at 4 (TiB)', r1(c.reserveTiB)],
      ['Available (TiB)', r1(c.availableTiB)],
      ['Resiliency', c.efficiencyLabel],
      ['Efficiency', `${(c.efficiency * 100).toFixed(1)}%`],
      ['Usable (TiB)', r1(c.usableTiB)])
  }

  const tierPolicy: unknown[][] = [
    ['WORKLOAD TIER POLICY'],
    ['Every numeric value on this tab is a TOOL assumption. Microsoft publishes NO vCPU:pCore ratio —'],
    ['the WS2025 maximums table states "Virtual processors per logical processor: No ratio imposed by Hyper-V."'],
    [],
    ['Tier', 'vCPU:pCore', 'Right-sizing factor', 'Dynamic Memory policy', 'Storage tier', 'Hybrid placement',
      'Target max VMs / recovery unit', 'Max recovery-unit size (TiB)', 'VMs', 'pCores', 'RAM (GiB)', 'Storage (TiB)'],
  ]
  for (const id of TIER_IDS) {
    const t = design.tiers[id]
    const d = r.demand.byTier[id]
    tierPolicy.push([t.label, `${t.oversubscription}:1`, t.rightSizingFactor,
      t.allowDynamicMemory ? 'Allowed' : 'Blocked', t.storageTier, t.hybridPlacement ?? (t.storageTier === 'performance' ? 's2d' : 'san'), t.maxVmsPerCsv,
      t.blastRadiusTiB, d.vms, r1(d.pCores), r0(d.ramGiB), r1(giBToTiB(d.storageGiB))])
  }

  const quality = r.performanceAssessment
  const dataQuality: unknown[][] = [
    ['SIZING EVIDENCE AND DATA QUALITY'],
    ['Sizing basis', quality.basis],
    ['Confidence', quality.confidence],
    ['Score', quality.score],
    ['Included VMs', quality.includedVms],
    ['Measured VMs', quality.measuredVms],
    ['Allocation fallback VMs', quality.fallbackVms],
    ['CPU P95 coverage %', r1(quality.cpuCoveragePct)],
    ['Memory P95 coverage %', r1(quality.memoryCoveragePct)],
    ['Storage performance coverage %', r1(quality.storagePerformanceCoveragePct)],
    ['7+ day observation coverage %', r1(quality.observationCoveragePct)],
    ['Median observation days', quality.observationDaysMedian ?? ''],
    [],
    ['Notes'],
    ...quality.notes.map((note) => [note]),
    ...(vms.some((vm) => vm.outlierDecision) ? [
      [],
      ['DATA CHECK: STORAGE OUTLIER CHOICES'],
      ['VM', 'Your choice', 'Imported storage GiB', 'Counted storage GiB'],
      ...vms.filter((vm) => vm.outlierDecision).map((vm) => [
        vm.name,
        vm.outlierDecision!.choice === 'cap' ? `Capped at ${r1(vm.outlierDecision!.capGiB ?? vm.storageGiB)} GiB` : vm.outlierDecision!.choice === 'exclude' ? 'Excluded from sizing' : 'Counted as imported',
        r1(vm.outlierDecision!.originalStorageGiB),
        vm.include ? r1(vm.storageGiB) : 0,
      ]),
    ] : []),
  ]

  return [
    { name: 'Summary', rows: summary },
    bomSheet(design),
    growthSheet(design),
    storagePlanSheet(design),
    findingsSheet(design),
    { name: 'Tier Policy', rows: tierPolicy },
    { name: 'Inventory', rows: inventoryRows(vms) },
    { name: 'Data Quality', rows: dataQuality },
    ...implementationSheets(design),
    ...licensingSheet(design, vms, costModel),
  ]
}

/** Sheets for the existing-capacity and fit-gap workbook. */
export function existingWorkbookSheets(design: PlatformDesign, vms: Vm[], generatedAt = new Date().toISOString(), costModel?: CostModelInputs | null): WorkbookSheet[] {
  const assessment = design.existing
  if (!assessment) return [{ name: 'Capacity and Fit', rows: [['Hyper-V Surveyor — Existing Capacity and Fit'], ['No existing-hardware design to export.']] }]
  const header: unknown[][] = [
    ['Hyper-V Surveyor — Existing Capacity and Fit'],
    ['Generated', generatedAt.slice(0, 16).replace('T', ' ')],
    ['Engagement', design.engagementMode === 'fit-gap' ? 'Fit workloads to existing hardware' : 'Assess existing capacity'],
    [],
  ]
  if (assessment.verdict === 'no-hardware') {
    return [{ name: 'Capacity and Fit', rows: [...header, ['Decision', 'ENTER YOUR HARDWARE'], ['Enter your hardware. No hosts are entered yet, so nothing is calculated and nothing is invented.']] }]
  }
  const status = existingVerdictLabel(assessment.verdict).toUpperCase()
  const row = (resource: string) => assessment.resources.find((item) => item.resource === resource)
  const storage = design.storage
  const summary: unknown[][] = [
    ...header,
    ...assessment.notices.map((notice) => ['NOTICE', notice]),
    ...(assessment.notices.length > 0 ? [[]] : []),
    ['HARDWARE CAPACITY'],
    ['Existing nodes', assessment.totalHosts],
    ['Clusters', assessment.clusters.length],
    ['Reserved / unavailable nodes', assessment.totalHosts - assessment.workloadHosts],
    ['Workload-bearing nodes', assessment.workloadHosts],
    ['Spare host rule', assessment.spareRule],
    ['Architecture', design.platformLabel],
    ['Storage protection', protectionLabel(design)],
    ['Usable physical cores', r1(row('cpu')?.available ?? 0)],
    ['Usable memory (GiB)', r0(row('memory')?.available ?? 0)],
    ...(row('s2d-storage') ? [['S2D usable capacity (TiB)', r1(row('s2d-storage')!.available)]] : []),
    ...(row('san-storage') ? [
      ['SAN usable capacity entered (TiB)', r1(storage?.sanUsableTiB ?? 0)],
      ['SAN data reduction ratio', `${storage?.sanDrr ?? 1}:1`],
      ['SAN effective capacity (TiB, usable × DRR)', r1(row('san-storage')!.available)],
    ] : []),
    ['Licensable cores for the entered hosts', design.licensableCores ?? '—'],
    [],
    ['WORKLOAD FIT'],
    ['Included VMs', assessment.includedVms],
    ['Management VMs counted', assessment.managementVms],
    ['Management host impact', design.management.impactLabel],
    ['Decision', status],
    ['Explanation', assessment.explanation],
    ['First resource to run out', assessment.firstToRunOut ? `${assessment.firstToRunOut.label} at ${usedShareText(assessment.firstToRunOut.worstPct)}` : 'Not assessed'],
    ['Placement rule', assessment.placement.rule],
    ['VMs not placed', assessment.unplaced.length],
    ['Hosts to add for compute', computeHostsToAdd(assessment)],
    ['Host specification to add', assessment.addSpec ? hostGroupLabel(assessment.addSpec.group) : '—'],
  ]

  const hosts: unknown[][] = [
    ['YOUR HOSTS'],
    ['Cluster', 'Hosts', 'Sockets', 'Cores / socket', 'RAM (GiB)', 'CPU vendor', 'CPU model', 'Spare hosts', 'Storage'],
    ...assessment.clusters.flatMap((cluster) => cluster.hostGroups.map((group) => [cluster.name, group.count, group.sockets, group.coresPerSocket, r0(group.ramGiB), group.cpuVendor, group.cpuModel ?? '', cluster.spareNodes, cluster.cfg.architecture])),
    [],
    ['PER-CLUSTER RESULTS'],
    ['Cluster', 'Hosts', 'Workload hosts', 'VMs placed', 'Management VMs', 'Usable cores', 'Used cores', 'Usable memory (GiB)', 'Used memory (GiB)', 'Result'],
    ...assessment.clusters.map((cluster) => [cluster.name, cluster.hosts, cluster.workloadNodes, cluster.vms.length, cluster.fixedVms.length, r1(cluster.reverse.availablePCores), r1(cluster.reverse.usedPCores), r0(cluster.reverse.availableRamGiB), r0(cluster.reverse.usedRamGiB), cluster.fits === null ? 'Nothing placed' : cluster.fits ? 'FITS' : 'DOES NOT FIT']),
  ]

  const headroom: unknown[][] = [
    ['CAPACITY AND HEADROOM BY RESOURCE'],
    [`Annual growth ${r1(assessment.annualGrowthPct * 100)}%`],
    [assessment.exhaustionNote],
    ['Resource', 'Unit', 'Available', 'Used', 'Headroom', 'Used share (fullest cluster)', 'Runs out'],
    ...assessment.resources.map((item) => [item.label, item.unit, r1(item.available), r1(item.used), r1(item.headroom), usedShareText(item.worstPct), exhaustionText(item, assessment.annualGrowthPct)]),
  ]

  const whatToAdd: unknown[][] = [
    ['WHAT TO ADD'],
    ['Each line is a separate remedy: compute, storage, performance, and VMs that cannot fit any host.'],
    ['Area', 'Where', 'Quantity', 'Unit', 'Item', 'Detail'],
    ...(assessment.whatToAdd.length > 0
      ? assessment.whatToAdd.map((item) => [item.category, item.scope, item.quantity, item.unit, item.item, item.detail])
      : [[assessment.verdict === 'fits' ? 'Nothing: the workload fits.' : 'Nothing to add was calculated.']]),
    ...(assessment.remedies.blockers.length > 0 ? [[], ['RESOLVE FIRST'], ...assessment.remedies.blockers.map((blocker) => [blocker])] : []),
    ...(assessment.unplaced.length > 0 ? [[], ['VMS THAT COULD NOT BE PLACED'], ['VM', 'vCPU', 'RAM (GiB)', 'Reason'], ...assessment.unplaced.map((vm) => [vm.name, vm.vCpu, r1(vm.ramGiB), vm.detail])] : []),
  ]

  const counted = design.management.countedVms
  const byTier = additionalVmsByTier(assessment)
  const tierCapacity: unknown[][] = [
    ['ADDITIONAL VM CAPACITY'],
    ['Values are mutually exclusive. Filling one tier consumes headroom available to the others. Empty tiers use the documented nominal fallback profile. With one shared array, the clusters together cannot pass its room.'],
    [],
    ['Chosen profile', assessment.profile.label],
    ['Profile vCPU', r1(assessment.profile.vCpu)],
    ['Profile RAM (GiB)', r1(assessment.profile.ramGiB)],
    ['Profile storage (GiB)', r1(assessment.profile.storageGiB)],
    ['More VMs of the chosen profile', assessment.profile.count],
    ['Limited by', assessment.profile.limitedBy === 'host-size' ? 'Larger than a host' : assessment.profile.limitedBy ? RESOURCE_LABELS[assessment.profile.limitedBy] : 'Not limited'],
    [],
    ['Tier', 'Current VMs', 'Additional VMs', 'Ceiling', 'vCPU:pCore', 'Demand factor'],
    ...TIER_IDS.map((id) => {
      const current = [...vms, ...counted].filter((vm) => vm.include && vm.tier === id).length
      const more = byTier[id]
      return [design.tiers[id].label, current, more, current + more, design.tiers[id].oversubscription, design.tiers[id].rightSizingFactor]
    }),
  ]

  const findings: unknown[][] = [
    ['VALIDATION FINDINGS'],
    ['Severity', 'Basis', 'Code', 'Message', 'Source'],
    ...assessment.findings.map((finding) => [finding.severity.toUpperCase(), finding.basis, finding.code, finding.message, finding.source ?? '']),
  ]

  const inventory: unknown[][] = [[
    'VM', 'Tier', 'Included', 'Power state', 'vCPU', 'RAM (GiB)', 'Consumed (GiB)', 'Provisioned (GiB, not sized)', 'Guest OS', 'Source cluster', 'Source host', 'Placed on',
  ], ...vms.map((vm) => [
    vm.name, design.tiers[vm.tier].label, vm.include ? 'YES' : 'no', vm.powerState, vm.vCpu, r1(vm.ramGiB), r1(vm.storageGiB), r1(vm.provisionedGiB), vm.guestOs ?? '', vm.sourceCluster ?? '', vm.sourceHost ?? '',
    vm.include ? assessment.clusters.find((cluster) => cluster.vms.some((item) => item.id === vm.id))?.name ?? 'Not placed' : '',
  ])]

  return [
    { name: 'Capacity and Fit', rows: summary },
    { name: 'Hosts', rows: hosts },
    { name: 'Headroom', rows: headroom },
    { name: 'What to Add', rows: whatToAdd },
    { name: 'VM Capacity', rows: tierCapacity },
    growthSheet(design),
    storagePlanSheet(design),
    { name: 'Findings', rows: findings },
    { name: 'Inventory', rows: inventory },
    ...implementationSheets(design),
    ...licensingSheet(design, vms, costModel),
  ]
}

function writeWorkbook(sheets: WorkbookSheet[], filename: string) {
  const wb = XLSX.utils.book_new()
  sheets.forEach((sheet) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name))
  XLSX.writeFile(wb, filename)
}

export function exportDesign(design: PlatformDesign, vms: Vm[], costModel?: CostModelInputs | null, filename = 'HyperV_Surveyor_Sizing.xlsx') {
  writeWorkbook(designWorkbookSheets(design, vms, undefined, costModel), filename)
}

export function exportExistingCapacity(
  design: PlatformDesign,
  vms: Vm[],
  costModel?: CostModelInputs | null,
  filename = design.engagementMode === 'fit-gap' ? 'HyperV_Surveyor_Fit_Gap.xlsx' : 'HyperV_Surveyor_Existing_Capacity.xlsx',
) {
  writeWorkbook(existingWorkbookSheets(design, vms, undefined, costModel), filename)
}

export function summariseForClipboard(s: SizingResult, label: string): string {
  const lines = [
    `${label}: ${s.nodes} nodes (${s.workloadNodes} carrying workload after N+${s.nodes - s.workloadNodes})`,
    s.bindingExplanation,
    `Storage required ${r1(s.requiredStorageTiB)} TiB · ${s.totalCsvs} CSVs · ${s.totalLicensableCores} licensable cores`,
  ]
  return lines.join('\n')
}
