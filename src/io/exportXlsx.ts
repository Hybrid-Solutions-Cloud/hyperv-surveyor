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
import { fitGapAdditionalLabel, fitGapRequiredLabel } from '../engine/fitGap'
import { singleClusterNodesLabel, type PlatformDesign } from '../engine/platformDesign'

const r1 = (n: number) => Math.round(n * 10) / 10
const r0 = (n: number) => Math.round(n)
/** Infinity and NaN are not readable in a spreadsheet. */
const finite = (n: number, unit = 'n/a') => Number.isFinite(n) ? n : unit

export interface WorkbookSheet {
  name: string
  rows: unknown[][]
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
export function designWorkbookSheets(design: PlatformDesign, vms: Vm[], generatedAt = new Date().toISOString()): WorkbookSheet[] {
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
  ]
}

/** Sheets for the existing-capacity and fit-gap workbook. */
export function existingWorkbookSheets(design: PlatformDesign, vms: Vm[], generatedAt = new Date().toISOString()): WorkbookSheet[] {
  const assessment = design.fitGap
  if (!assessment) return [{ name: 'Capacity and Fit', rows: [['Hyper-V Surveyor — Existing Capacity and Fit'], ['No existing-hardware design to export.']] }]
  const cfg = design.cfg
  const r = assessment.reverse
  const status = assessment.fits === null ? 'NOT ASSESSED' : assessment.fits ? 'FITS' : 'DOES NOT FIT'
  const sanDomain = r.storageDomains.find((domain) => domain.domain === 'san')
  const summary: unknown[][] = [
    ['Hyper-V Surveyor — Existing Capacity and Fit'],
    ['Generated', generatedAt.slice(0, 16).replace('T', ' ')],
    ['Engagement', design.engagementMode === 'fit-gap' ? 'Fit workloads to existing hardware' : 'Assess existing capacity'],
    [],
    ['HARDWARE CAPACITY'],
    ['Existing nodes', assessment.existingNodes],
    ['Reserved / unavailable nodes', cfg.spareNodes],
    ['Workload-bearing nodes', r.workloadNodes],
    ['Architecture', cfg.architecture],
    ['Storage protection', protectionLabel(design)],
    ['Usable physical cores', r1(r.availablePCores)],
    ['Usable memory (GiB)', r0(r.availableRamGiB)],
    ...(r.capacity ? [['S2D usable capacity (TiB)', r1(r.capacity.usableTiB)]] : []),
    ...(sanDomain ? [
      ['SAN usable capacity entered (TiB)', r1(cfg.san.usableTiB)],
      ['SAN data reduction ratio', `${Math.max(1, cfg.san.drr)}:1`],
      ['SAN effective capacity (TiB, usable × DRR)', r1(sanDomain.availableTiB)],
    ] : []),
    ['Total available storage (TiB, S2D usable + SAN effective)', r1(r.availableStorageTiB)],
    ['Licensable cores for the entered hosts', design.licensableCores ?? '—'],
    [],
    ['WORKLOAD FIT'],
    ['Included VMs', assessment.assessedVms],
    ['Management VMs counted', assessment.managementVms],
    ['Management host impact', design.management.impactLabel],
    ['Decision', status],
    ['Binding resource', r.binding],
    ['Explanation', r.bindingExplanation],
    ['Same-spec nodes required', fitGapRequiredLabel(assessment)],
    ['Additional same-spec nodes', fitGapAdditionalLabel(assessment)],
    ['CPU deficit (physical cores)', r1(assessment.deficits.physicalCores)],
    ['Memory deficit (GiB)', r1(assessment.deficits.ramGiB)],
    ['S2D capacity deficit (usable TiB)', r1(assessment.deficits.s2dTiB)],
    ['SAN capacity deficit (effective TiB)', r1(assessment.deficits.sanTiB)],
    [],
    ['RECOMMENDATIONS'],
    ...assessment.recommendations.map((recommendation) => [recommendation]),
  ]

  const counted = design.management.countedVms
  const tierCapacity: unknown[][] = [
    ['ADDITIONAL VM CAPACITY'],
    ['Values are mutually exclusive. Filling one tier consumes headroom available to the others. Empty tiers use the documented nominal fallback profile.'],
    [],
    ['Tier', 'Current VMs', 'Additional VMs', 'Ceiling', 'vCPU:pCore', 'Demand factor'],
    ...TIER_IDS.map((id) => {
      const current = [...vms, ...counted].filter((vm) => vm.include && vm.tier === id).length
      const more = finite(r.additionalVmsByTier[id], 'Not limited')
      return [design.tiers[id].label, current, more, typeof more === 'number' ? current + more : more, design.tiers[id].oversubscription, design.tiers[id].rightSizingFactor]
    }),
  ]

  const findings: unknown[][] = [
    ['VALIDATION FINDINGS'],
    ['Severity', 'Basis', 'Code', 'Message', 'Source'],
    ...r.findings.map((finding) => [finding.severity.toUpperCase(), finding.basis, finding.code, finding.message, finding.source ?? '']),
  ]

  const inventory: unknown[][] = [[
    'VM', 'Tier', 'Included', 'Power state', 'vCPU', 'RAM (GiB)', 'Consumed (GiB)', 'Provisioned (GiB, not sized)', 'Guest OS', 'Source cluster', 'Source host',
  ], ...vms.map((vm) => [
    vm.name, design.tiers[vm.tier].label, vm.include ? 'YES' : 'no', vm.powerState, vm.vCpu, r1(vm.ramGiB), r1(vm.storageGiB), r1(vm.provisionedGiB), vm.guestOs ?? '', vm.sourceCluster ?? '', vm.sourceHost ?? '',
  ])]

  return [
    { name: 'Capacity and Fit', rows: summary },
    { name: 'VM Capacity', rows: tierCapacity },
    growthSheet(design),
    storagePlanSheet(design),
    { name: 'Findings', rows: findings },
    { name: 'Inventory', rows: inventory },
  ]
}

function writeWorkbook(sheets: WorkbookSheet[], filename: string) {
  const wb = XLSX.utils.book_new()
  sheets.forEach((sheet) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name))
  XLSX.writeFile(wb, filename)
}

export function exportDesign(design: PlatformDesign, vms: Vm[], filename = 'HyperV_Surveyor_Sizing.xlsx') {
  writeWorkbook(designWorkbookSheets(design, vms), filename)
}

export function exportExistingCapacity(
  design: PlatformDesign,
  vms: Vm[],
  filename = design.engagementMode === 'fit-gap' ? 'HyperV_Surveyor_Fit_Gap.xlsx' : 'HyperV_Surveyor_Existing_Capacity.xlsx',
) {
  writeWorkbook(existingWorkbookSheets(design, vms), filename)
}

export function summariseForClipboard(s: SizingResult, label: string): string {
  const lines = [
    `${label}: ${s.nodes} nodes (${s.workloadNodes} carrying workload after N+${s.nodes - s.workloadNodes})`,
    s.bindingExplanation,
    `Storage required ${r1(s.requiredStorageTiB)} TiB · ${s.totalCsvs} CSVs · ${s.totalLicensableCores} licensable cores`,
  ]
  return lines.join('\n')
}
