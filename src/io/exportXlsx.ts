/** Export the full design to a multi-tab workbook. */
import * as XLSX from 'xlsx'
import { forecastGrowth, type ArchitectureOption } from '../engine/solve'
import { giBToTiB } from '../engine/compute'
import { RESILIENCY, TIER_IDS } from '../engine/rules'
import type { ClusterConfig, SizingResult, TierId, TierPolicy, Vm } from '../engine/types'
import { assessFitGap } from '../engine/fitGap'
import type { EngagementMode } from '../state/journey'

const r1 = (n: number) => Math.round(n * 10) / 10
const r0 = (n: number) => Math.round(n)

export function exportDesign(
  options: ArchitectureOption[],
  chosen: ArchitectureOption,
  cfg: ClusterConfig,
  tiers: Record<TierId, TierPolicy>,
  vms: Vm[],
  filename = 'HyperV_Surveyor_Sizing.xlsx',
) {
  const wb = XLSX.utils.book_new()
  const growth = forecastGrowth(cfg, vms, tiers)

  // ---- Summary -------------------------------------------------------------
  const summary: any[][] = [
    ['Hyper-V Surveyor — Sizing Result'],
    ['Generated', new Date().toISOString().slice(0, 16).replace('T', ' ')],
    [],
    ['ARCHITECTURE COMPARISON'],
    ['Architecture', 'Nodes', 'Workload nodes', 'Feasible', 'Binding constraint', 'Usable storage (TiB)',
      'Required (TiB)', 'CSVs', 'Licensable cores', 'N+n overhead %'],
  ]
  for (const o of options) {
    const s = o.result
    summary.push([
      o.label, s.nodes, s.workloadNodes, s.feasible ? 'YES' : 'NO', s.binding,
      s.capacity ? r1(s.capacity.usableTiB) : s.sanCapacityTiB ? r1(s.sanCapacityTiB) : '—',
      r1(s.requiredStorageTiB), s.totalCsvs, s.totalLicensableCores, r1(s.resiliencyOverheadPct),
    ])
  }
  summary.push([], ['SELECTED DESIGN'], ['Architecture', chosen.label],
    ['Resiliency', RESILIENCY[chosen.result.resiliency].label],
    ['Nodes', chosen.result.nodes], ['Workload nodes (after N+n)', chosen.result.workloadNodes],
    ['Binding constraint', chosen.result.binding], ['Explanation', chosen.result.bindingExplanation],
    ['Nodes if CPU alone', chosen.result.nodesIfCpuOnly],
    ['Nodes if memory alone', chosen.result.nodesIfMemoryOnly],
    ['Nodes if storage alone', Number.isFinite(chosen.result.nodesIfStorageOnly) ? chosen.result.nodesIfStorageOnly : 'n/a'],
    [], ['NODE SPEC'],
    ['Sockets', cfg.node.sockets], ['Cores per socket', cfg.node.coresPerSocket],
    ['Total physical cores', cfg.node.sockets * cfg.node.coresPerSocket],
    ['Licensable cores (16/server, 8/socket minimum)', chosen.result.licensableCoresPerNode],
    ['RAM (GiB)', cfg.node.ramGiB],
    ['Capacity drives per node', cfg.node.capacityDrivesPerNode],
    ['Capacity drive size (TB)', cfg.node.capacityDriveTB],
    ['Cache drives per node', cfg.node.cacheDrivesPerNode],
    ['Cache drive size (TB)', cfg.node.cacheDriveTB],
    ['Media', cfg.node.media],
    [], ['WORKLOAD DEMAND'],
    ['VMs included', chosen.result.demand.vmCount],
    ['Total vCPU allocated', chosen.result.demand.totalVCpu],
    ['Physical cores required (after oversubscription)', r1(chosen.result.demand.requiredPCores)],
    ['RAM required (GiB)', r0(chosen.result.demand.requiredRamGiB)],
    ['Storage required (TiB)', r1(chosen.result.requiredStorageTiB)],
    ['Immediate headroom', `${r1(growth.plan.immediateHeadroomPct)}%`],
    ['Annual workload growth', `${r1(growth.plan.annualGrowthPct * 100)}%`],
    ['Growth horizon', `${growth.plan.horizonYears} years`],
    ['Growth deployment strategy', growth.plan.strategy === 'build-now' ? 'Build terminal forecast now' : 'Add nodes as thresholds are crossed'],
  )
  if (chosen.result.capacity) {
    const c = chosen.result.capacity
    summary.push([], ['S2D CAPACITY CHAIN'],
      ['Raw pool (TiB)', r1(c.rawTiB)],
      ['Reserve — 1 drive/server, capped at 4 (TiB)', r1(c.reserveTiB)],
      ['Available (TiB)', r1(c.availableTiB)],
      ['Resiliency', c.efficiencyLabel],
      ['Efficiency', `${(c.efficiency * 100).toFixed(1)}%`],
      ['Usable (TiB)', r1(c.usableTiB)])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary')

  // ---- Growth plan ---------------------------------------------------------
  const growthRows: any[][] = [
    ['CAPACITY GROWTH PLAN'],
    ['Annual growth compounds across CPU, memory, and consumed storage while preserving N+n at each forecast point.'],
    ['Strategy', growth.plan.strategy === 'build-now' ? 'Build terminal forecast capacity now' : 'Phase nodes as demand crosses thresholds'],
    ['Immediate headroom', `${r1(growth.plan.immediateHeadroomPct)}%`],
    ['Annual growth', `${r1(growth.plan.annualGrowthPct * 100)}%`],
    ['Horizon', `${growth.plan.horizonYears} years`],
    [],
    ['Timeline', 'Demand multiplier', 'Nodes required', 'Binding constraint', 'Deployment action'],
  ]
  growth.points.forEach((point, index) => {
    const action = !point.result.feasible
      ? 'Review node density or split into multiple clusters'
      : growth.plan.strategy === 'build-now'
        ? index === 0
          ? `Build ${growth.plannedNodesToday ?? 'N/A'} nodes now`
          : `Covered by initial ${growth.plannedNodesToday ?? 'N/A'}-node build`
        : index === 0
          ? `Initial build: ${point.result.nodes} nodes`
          : point.additionalNodes && point.additionalNodes > 0
            ? `Add ${point.additionalNodes} node${point.additionalNodes === 1 ? '' : 's'}`
            : 'No node addition'
    growthRows.push([
      point.year === 0 ? 'Today' : `Year ${point.year}`,
      r1(point.demandFactor),
      point.result.feasible ? point.result.nodes : 'Review required',
      point.result.binding,
      action,
    ])
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(growthRows), 'Growth Plan')

  // ---- CSV plan ------------------------------------------------------------
  const storagePlanTitle = cfg.architecture === 'san'
    ? 'SAN CSV / LUN LAYOUT PLAN'
    : cfg.architecture === 's2d' ? 'S2D VOLUME / CSV LAYOUT PLAN' : 'HYBRID STORAGE VOLUME LAYOUT PLAN'
  const csv: any[][] = [
    [storagePlanTitle],
    ['This is a logical workload-volume plan, not a physical disk or RAID layout. A SAN LUN maps 1:1 to a CSV; an S2D volume/CSV has no SAN LUN.'],
    ['Each row takes the larger of its volume-size count and VM recovery-grouping count. S2D totals are then balanced across the node count.'],
    [],
    ['Tier', 'Storage tier', 'Storage object', 'Filesystem', 'Planned storage (TiB)', 'Planned VMs',
      'Max recovery-unit size (TiB)', 'Count by size', 'Target max VMs / recovery unit',
      'Count by VM grouping', 'Base count', 'Final count', 'Size each (TiB)', 'VMs each', 'Controlling rule'],
  ]
  for (const p of chosen.result.csvPlans) {
    csv.push([p.tier, p.storageTier, p.domain === 'san' ? 'SAN CSV / LUN' : 'S2D volume / CSV', p.filesystem,
      r1(p.totalTiB), p.plannedVms, r1(p.maxSizeTiB), p.countByCapacity, p.maxVmsPerCsv,
      p.countByVmLimit, p.roundedUpFrom, p.count, r1(p.sizeTiB), p.vmsPerCsv, p.driver])
  }
  csv.push([], ['Total logical storage objects', chosen.result.totalCsvs], ['Count above 64', 'Generates a design warning'],
    [], ['NOTE: Microsoft imposes NO limit on VMs per CSV. Recovery-unit size and target VMs per recovery unit are editable TOOL assumptions.'],
    ['Workload growth increases logical capacity and equivalent planned VM count. The imported inventory count remains unchanged.'])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(csv), 'CSV Plan')

  // ---- Findings ------------------------------------------------------------
  const find: any[][] = [
    ['VALIDATION FINDINGS'],
    ['Basis: MS = Microsoft hard rule · MS-REC = Microsoft recommendation · TOOL = our assumption'],
    [],
    ['Severity', 'Basis', 'Code', 'Message', 'Source'],
  ]
  for (const f of chosen.result.findings) {
    find.push([f.severity.toUpperCase(), f.basis, f.code, f.message, f.source ?? ''])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(find), 'Findings')

  // ---- Tier policy ---------------------------------------------------------
  const tp: any[][] = [
    ['WORKLOAD TIER POLICY'],
    ['Every numeric value on this tab is a TOOL assumption. Microsoft publishes NO vCPU:pCore ratio —'],
    ['the WS2025 maximums table states "Virtual processors per logical processor: No ratio imposed by Hyper-V."'],
    [],
    ['Tier', 'vCPU:pCore', 'Right-sizing factor', 'Dynamic Memory policy', 'Storage tier', 'Hybrid placement',
      'Target max VMs / recovery unit', 'Max recovery-unit size (TiB)', 'VMs', 'pCores', 'RAM (GiB)', 'Storage (TiB)'],
  ]
  for (const id of TIER_IDS) {
    const t = tiers[id]
    const d = chosen.result.demand.byTier[id]
    tp.push([t.label, `${t.oversubscription}:1`, t.rightSizingFactor,
      t.allowDynamicMemory ? 'Allowed' : 'Blocked', t.storageTier, t.hybridPlacement ?? (t.storageTier === 'performance' ? 's2d' : 'san'), t.maxVmsPerCsv,
      t.blastRadiusTiB, d.vms, r1(d.pCores), r0(d.ramGiB), r1(giBToTiB(d.storageGiB))])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tp), 'Tier Policy')

  // ---- Inventory -----------------------------------------------------------
  const inv: any[][] = [[
    'VM', 'Tier', 'Included', 'Power state', 'vCPU', 'RAM (GiB)',
    'Consumed (GiB)', 'Provisioned (GiB)', 'Thin gap (GiB)', 'Guest OS',
    'Source cluster', 'Source host', 'Source CPU vendor', 'Firmware', 'Disks', 'NICs', 'Snapshots', 'RDM', 'Encrypted', 'vTPM',
    'CPU P95 %', 'Memory P95 %', 'IOPS P95', 'Throughput MBps P95', 'Latency ms P95', 'Network Mbps P95', 'Observation days', 'Performance source', 'Auto-classified',
  ]]
  for (const v of vms) {
    inv.push([v.name, v.tier, v.include ? 'YES' : 'no', v.powerState, v.vCpu, r1(v.ramGiB),
      r1(v.storageGiB), r1(v.provisionedGiB), r1(Math.max(0, v.provisionedGiB - v.storageGiB)),
      v.guestOs ?? '', v.sourceCluster ?? '', v.sourceHost ?? '', v.sourceCpuVendor ?? '', v.firmware ?? '', v.diskCount ?? '', v.nicCount ?? '', v.snapshotCount ?? '', v.hasRdm ? 'YES' : '', v.encrypted ? 'YES' : '', v.hasVtpm ? 'YES' : '',
      v.performance?.cpuP95Pct ?? '', v.performance?.memoryP95Pct ?? '', v.performance?.storageIopsP95 ?? '', v.performance?.storageThroughputMBpsP95 ?? '', v.performance?.storageLatencyMsP95 ?? '', v.performance?.networkMbpsP95 ?? '', v.performance?.observationDays ?? '', v.performance?.source ?? '', v.autoClassified ? 'YES' : ''])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inv), 'Inventory')

  const quality = chosen.result.performanceAssessment
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
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
  ]), 'Data Quality')

  XLSX.writeFile(wb, filename)
}

export function summariseForClipboard(s: SizingResult, label: string): string {
  const lines = [
    `${label}: ${s.nodes} nodes (${s.workloadNodes} carrying workload after N+${s.nodes - s.workloadNodes})`,
    s.bindingExplanation,
    `Storage required ${r1(s.requiredStorageTiB)} TiB · ${s.totalCsvs} CSVs · ${s.totalLicensableCores} licensable cores`,
  ]
  return lines.join('\n')
}

export function exportExistingCapacity(
  cfg: ClusterConfig,
  nodes: number,
  tiers: Record<TierId, TierPolicy>,
  vms: Vm[],
  mode: EngagementMode | null,
  filename = mode === 'fit-gap' ? 'HyperV_Surveyor_Fit_Gap.xlsx' : 'HyperV_Surveyor_Existing_Capacity.xlsx',
) {
  const wb = XLSX.utils.book_new()
  const assessment = assessFitGap(cfg, nodes, vms, tiers)
  const r = assessment.reverse
  const status = assessment.fits === null ? 'NOT ASSESSED' : assessment.fits ? 'FITS' : 'DOES NOT FIT'
  const summary: any[][] = [
    ['Hyper-V Surveyor — Existing Capacity and Fit'],
    ['Generated', new Date().toISOString().slice(0, 16).replace('T', ' ')],
    ['Engagement', mode === 'fit-gap' ? 'Fit workloads to existing hardware' : 'Assess existing capacity'],
    [],
    ['HARDWARE CAPACITY'],
    ['Existing nodes', assessment.existingNodes],
    ['Reserved / unavailable nodes', cfg.spareNodes],
    ['Workload-bearing nodes', r.workloadNodes],
    ['Architecture', cfg.architecture],
    ['Usable physical cores', r1(r.availablePCores)],
    ['Usable memory (GiB)', r0(r.availableRamGiB)],
    ['Usable storage (TiB)', r1(r.availableStorageTiB)],
    [],
    ['WORKLOAD FIT'],
    ['Included VMs', assessment.assessedVms],
    ['Decision', status],
    ['Binding resource', r.binding],
    ['Explanation', r.bindingExplanation],
    ['Same-spec nodes required', assessment.requiredNodesAtSameSpec ?? 'Not resolved'],
    ['Additional same-spec nodes', assessment.additionalNodes ?? 'Cannot resolve with nodes alone'],
    ['CPU deficit (physical cores)', r1(assessment.deficits.physicalCores)],
    ['Memory deficit (GiB)', r1(assessment.deficits.ramGiB)],
    ['S2D capacity deficit (TiB)', r1(assessment.deficits.s2dTiB)],
    ['SAN capacity deficit (TiB)', r1(assessment.deficits.sanTiB)],
    [],
    ['RECOMMENDATIONS'],
    ...assessment.recommendations.map((recommendation) => [recommendation]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Capacity and Fit')

  const tierCapacity: any[][] = [
    ['ADDITIONAL VM CAPACITY'],
    ['Values are mutually exclusive. Filling one tier consumes headroom available to the others. Empty tiers use the documented nominal fallback profile.'],
    [],
    ['Tier', 'Current VMs', 'Additional VMs', 'Ceiling', 'vCPU:pCore', 'Demand factor'],
    ...TIER_IDS.map((id) => {
      const current = vms.filter((vm) => vm.include && vm.tier === id).length
      const more = r.additionalVmsByTier[id]
      return [tiers[id].label, current, more, current + more, tiers[id].oversubscription, tiers[id].rightSizingFactor]
    }),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tierCapacity), 'VM Capacity')

  const findings: any[][] = [
    ['VALIDATION FINDINGS'],
    ['Severity', 'Basis', 'Code', 'Message', 'Source'],
    ...r.findings.map((finding) => [finding.severity.toUpperCase(), finding.basis, finding.code, finding.message, finding.source ?? '']),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(findings), 'Findings')

  const inventory: any[][] = [[
    'VM', 'Tier', 'Included', 'Power state', 'vCPU', 'RAM (GiB)', 'Consumed (GiB)', 'Provisioned (GiB)', 'Guest OS', 'Source cluster', 'Source host',
  ], ...vms.map((vm) => [
    vm.name, tiers[vm.tier].label, vm.include ? 'YES' : 'no', vm.powerState, vm.vCpu, r1(vm.ramGiB), r1(vm.storageGiB), r1(vm.provisionedGiB), vm.guestOs ?? '', vm.sourceCluster ?? '', vm.sourceHost ?? '',
  ])]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inventory), 'Inventory')
  XLSX.writeFile(wb, filename)
}
