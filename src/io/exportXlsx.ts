/** Export the full design to a multi-tab workbook. */
import * as XLSX from 'xlsx'
import { forecastGrowth, type ArchitectureOption } from '../engine/solve'
import { giBToTiB } from '../engine/compute'
import { RESILIENCY, TIER_IDS } from '../engine/rules'
import type { ClusterConfig, SizingResult, TierId, TierPolicy, Vm } from '../engine/types'

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
  const csv: any[][] = [
    ['CSV / LUN LAYOUT PLAN'],
    ['CSV count is driven by the LARGEST of: capacity, recovery blast radius, and node count —'],
    ['then rounded UP to a whole multiple of node count so coordinator ownership distributes evenly.'],
    [],
    ['Tier', 'Storage tier', 'Domain', 'Filesystem', 'CSV count', 'Size each (TiB)',
      'Total (TiB)', 'VMs per CSV', 'Driver', 'Count before rounding'],
  ]
  for (const p of chosen.result.csvPlans) {
    csv.push([p.tier, p.storageTier, p.domain.toUpperCase(), p.filesystem, p.count,
      r1(p.sizeTiB), r1(p.totalTiB), p.vmsPerCsv, p.driver, p.roundedUpFrom])
  }
  csv.push([], ['Total CSVs', chosen.result.totalCsvs], ['Recommended maximum', 64],
    [], ['NOTE: Microsoft imposes NO limit on VMs per CSV. The VMs-per-CSV figures come from the'],
    ['blast-radius settings, which are a TOOL assumption, not vendor guidance. On SAN the LUN is'],
    ['the restore unit — an array snapshot covers the whole volume — so blast radius is the real driver.'])
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
    ['Tier', 'vCPU:pCore', 'Right-sizing factor', 'Dynamic Memory', 'Storage tier',
      'Max VMs per CSV', 'Blast radius (TiB)', 'VMs', 'pCores', 'RAM (GiB)', 'Storage (TiB)'],
  ]
  for (const id of TIER_IDS) {
    const t = tiers[id]
    const d = chosen.result.demand.byTier[id]
    tp.push([t.label, `${t.oversubscription}:1`, t.rightSizingFactor,
      t.allowDynamicMemory ? 'Allowed' : 'Blocked', t.storageTier, t.maxVmsPerCsv,
      t.blastRadiusTiB, d.vms, r1(d.pCores), r0(d.ramGiB), r1(giBToTiB(d.storageGiB))])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tp), 'Tier Policy')

  // ---- Inventory -----------------------------------------------------------
  const inv: any[][] = [[
    'VM', 'Tier', 'Included', 'Power state', 'vCPU', 'RAM (GiB)',
    'Consumed (GiB)', 'Provisioned (GiB)', 'Thin gap (GiB)', 'Guest OS',
    'Source cluster', 'Source host', 'Auto-classified',
  ]]
  for (const v of vms) {
    inv.push([v.name, v.tier, v.include ? 'YES' : 'no', v.powerState, v.vCpu, r1(v.ramGiB),
      r1(v.storageGiB), r1(v.provisionedGiB), r1(Math.max(0, v.provisionedGiB - v.storageGiB)),
      v.guestOs ?? '', v.sourceCluster ?? '', v.sourceHost ?? '', v.autoClassified ? 'YES' : ''])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inv), 'Inventory')

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
