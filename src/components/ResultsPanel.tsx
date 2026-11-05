import React from 'react'
import type { ArchitectureOption } from '../engine/solve'
import type { PlatformDesign } from '../engine/platformDesign'
import { RESILIENCY, TIER_IDS } from '../engine/rules'
import { giBToTiB } from '../engine/compute'
import type { TierId, TierPolicy } from '../engine/types'
import { Card, FindingsList, fmt0, fmt1 } from './Shared'

interface Props {
  /** The resolved design. Every figure below comes from it. */
  design: PlatformDesign
  setChosenKey: (k: string) => void
  tiers: Record<TierId, TierPolicy>
  onExport: () => void
  /** Shown above the comparison: help choosing a storage type. */
  beforeComparison?: React.ReactNode
  /** Shown after the selected design: cluster layout and server size. */
  designChoices?: React.ReactNode
}

function nodesNeededText(result: ArchitectureOption['result']): string {
  if (result.nodesNeeded !== null) return `${result.nodesNeeded.toLocaleString()} needed`
  return result.computeNodesNeeded === null ? '—' : `${result.computeNodesNeeded.toLocaleString()} for compute`
}

const driverLabel: Record<string, string> = {
  capacity: 'volume-size requirement',
  'vm-count': 'VM recovery grouping',
  both: 'both requirements',
  'node-count': 'S2D node ownership',
  'operational-balance': 'operational balance',
  'custom-target': 'custom target',
}

export function ResultsPanel({ design, setChosenKey, tiers, onExport, beforeComparison, designChoices }: Props) {
  const options = design.options
  const chosen = design.chosen ?? options[0]
  const r = chosen.result
  const storage = design.storage
  const split = design.status === 'split'
  const designOk = design.feasible === true
  const availableStorageTiB = (storage?.s2dUsableTiB ?? 0) + (storage?.sanEffectiveTiB ?? 0)

  if (design.status === 'no-workload' || r.demand.vmCount === 0) {
    return (
      <div className="panel">
        <h2>Results</h2>
        <p className="muted">Add workloads first — import an RVTools export, add rows by hand, or load the demo fleet.</p>
      </div>
    )
  }

  const spare = chosen.cfg.spareNodes
  const growth = design.growth
  const csvPlans = storage?.csvPlans ?? []
  const sanPlans = csvPlans.filter(plan => plan.domain === 'san')
  const sanCsvCount = sanPlans.reduce((sum, plan) => sum + plan.count, 0)
  const granularSanAlternative = sanPlans.reduce((sum, plan) => sum + plan.granularAdvisoryCount, 0)
  const management = design.management

  return (
    <div className="stack">
      {beforeComparison}
      <div className="panel">
        <h2>Architecture comparison</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          Same workload, every architecture. The node counts differ because <strong>on SAN the node count is
          driven by compute alone</strong>, while <strong>on S2D every node is also storage</strong> — and parity
          efficiency itself improves as nodes are added. Click a row to select it.
        </p>
        <div className="scroll" style={{ maxHeight: 'none' }}>
          <table>
            <thead>
              <tr>
                <th>Architecture</th>
                <th className="num">Nodes</th>
                <th className="num">Workload</th>
                <th>Binding constraint</th>
                <th className="num">Available TiB</th>
                <th className="num">Required TiB</th>
                <th className="num">CSVs</th>
                <th className="num">Lic. cores</th>
                <th className="num">N+{spare} overhead</th>
              </tr>
            </thead>
            <tbody>
              {options.map(o => {
                const s = o.result
                return (
                  <tr key={o.key}
                    className={`${o.key === chosen.key ? 'chosen' : ''} ${s.feasible ? '' : 'infeasible'}`}
                    style={{ cursor: 'pointer' }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Select ${o.label}`}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setChosenKey(o.key) } }}
                    onClick={() => setChosenKey(o.key)}>
                    <td>
                      <strong>{o.label}</strong>
                      {!s.feasible && <span className="pill err" style={{ marginLeft: 6 }}>not feasible</span>}
                    </td>
                    <td className="num">
                      <strong>{s.feasible ? s.nodes : nodesNeededText(s)}</strong>
                      {!s.feasible && s.nodesNeeded !== null && s.nodesNeeded > s.clusterNodeLimit && <div className="small muted">limit {s.clusterNodeLimit}</div>}
                    </td>
                    <td className="num">{s.feasible ? s.workloadNodes : '—'}</td>
                    <td>
                      <span className={`pill ${s.binding === 'storage' ? 'warn' : 'info'}`}>{s.binding}</span>
                    </td>
                    <td className="num">
                      {s.feasible && (s.capacity || s.sanCapacityTiB !== null) ? fmt1((s.capacity?.usableTiB ?? 0) + (s.sanCapacityTiB ?? 0)) : '—'}
                    </td>
                    <td className="num">{fmt1(s.requiredStorageTiB)}</td>
                    <td className="num">{s.feasible ? s.totalCsvs : '—'}</td>
                    <td className="num">{s.feasible ? fmt0(s.totalLicensableCores) : '—'}</td>
                    <td className="num">{s.feasible ? `${fmt1(s.resiliencyOverheadPct)}%` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>{chosen.label}</h2>
        <div className={`note ${designOk ? 'ok' : 'err'}`}>
          <strong>{design.headline}</strong>
          {design.explanation}
        </div>
        {management.counted && <div className="note"><strong>Includes {management.countedVms.length} management VMs</strong>They share the workload cluster and are counted in this result: {management.impactLabel.toLowerCase()}.</div>}
        {design.splitRequested && <div className="note"><strong>{split ? 'The comparison above is one cluster per option' : 'Split selected'}</strong>{split ? 'The selected design below is your split. The table above still compares each storage type in one cluster.' : 'The split cannot place the workload yet. Change the split limits below or choose one cluster.'}</div>}
        <div className={`note ${r.performanceAssessment.confidence === 'high' ? 'ok' : r.performanceAssessment.measuredVms > 0 ? 'warn' : ''}`}>
          <strong>Sizing evidence: {r.performanceAssessment.basis === 'measured-p95' ? 'measured P95 with allocation fallback' : 'allocation'} · {r.performanceAssessment.confidence.replace('-', ' ')} ({r.performanceAssessment.score}/100)</strong>
          CPU coverage {r.performanceAssessment.cpuCoveragePct.toFixed(0)}% · memory {r.performanceAssessment.memoryCoveragePct.toFixed(0)}% · storage performance {r.performanceAssessment.storagePerformanceCoveragePct.toFixed(0)}%.
        </div>

        <div className="grid cards">
          <Card k="Nodes" v={design.totalNodes ?? (r.nodesNeeded ?? r.computeNodesNeeded ?? '—')} s={split ? `across ${design.clusters.length} clusters, ${design.workloadNodes} carrying workload` : designOk ? `${r.workloadNodes} workload + ${spare} spare` : design.status === 'split-failed' ? 'the split cannot place the workload' : r.nodesNeeded !== null ? `needed in one cluster, limit ${r.clusterNodeLimit}` : r.computeNodesNeeded !== null ? 'for compute; more hosts will not fix the storage' : 'fix the inputs above'} />
          <Card k="If CPU alone" v={Number.isFinite(r.nodesIfCpuOnly) ? r.nodesIfCpuOnly : '—'} s="nodes" />
          <Card k="If memory alone" v={Number.isFinite(r.nodesIfMemoryOnly) ? r.nodesIfMemoryOnly : '—'} s="nodes" />
          <Card k="If storage alone"
            v={Number.isFinite(r.nodesIfStorageOnly) ? (r.capacity ? r.nodesIfStorageOnly : 'passes') : 'fails'}
            s={r.capacity ? 'nodes / domain validation' : `${fmt1(r.sanCapacityTiB ?? 0)} TiB SAN effective`} />
          <Card k="Cores required" v={fmt0(r.demand.requiredPCores)} s={`from ${fmt0(r.demand.totalVCpu)} allocated vCPU`} />
          <Card k="RAM required" v={fmt1(r.demand.requiredRamGiB / 1024)} s="TiB" />
          <Card k="Storage required" v={fmt1(storage?.requiredTiB ?? r.requiredStorageTiB)} s="TiB consumed" />
          {designOk && <Card k="Storage available" v={fmt1(availableStorageTiB)} s={chosen.cfg.architecture === 'hybrid' ? `${fmt1(storage?.s2dUsableTiB ?? 0)} S2D usable + ${fmt1(storage?.sanEffectiveTiB ?? 0)} SAN effective` : chosen.cfg.architecture === 'san' ? 'TiB SAN effective (usable × data reduction)' : 'TiB S2D usable'} />}
          {storage?.sanToBuyUsableTiB != null && <Card k="SAN to buy" v={fmt1(storage.sanToBuyUsableTiB)} s={`TiB usable (${fmt1(storage.sanToBuyEffectiveTiB ?? 0)} TiB effective at ${storage.sanDrr}:1), keeping ${((storage.sanFreeSpaceTargetPct ?? 0) * 100).toFixed(0)}% free`} />}
          <Card k="Licensable cores" v={design.licensableCores === null ? '—' : fmt0(design.licensableCores)} s={design.licensableCoresDetail} />
        </div>

        <h3 style={{ marginTop: 18 }}>Storage performance validation</h3>
        <div className={`note ${r.storagePerformance.validated ? 'ok' : 'warn'}`}>
          <strong>{r.storagePerformance.validated ? 'Validated against entered sustainable capabilities' : 'Not fully validated'}</strong>
          {r.storagePerformance.validated
            ? `${r.storagePerformance.measuredVmCoveragePct.toFixed(0)}% of included VMs have matched IOPS or throughput evidence.`
            : `Measured IOPS/throughput coverage is ${r.storagePerformance.measuredVmCoveragePct.toFixed(0)}%. Enter sustainable capability for every active storage domain and validate peak concurrency before approval.`}
        </div>
        <div className="scroll" style={{ maxHeight: 'none' }}>
          <table>
            <thead><tr><th>Domain</th><th className="num">Required IOPS</th><th className="num">Available IOPS</th><th className="num">Required MB/s</th><th className="num">Available MB/s</th></tr></thead>
            <tbody>
              {(chosen.cfg.architecture === 's2d' || chosen.cfg.architecture === 'hybrid') && (
                <tr><td>S2D</td><td className="num">{fmt0(r.storagePerformance.requiredS2dIops)}</td><td className="num">{r.storagePerformance.availableS2dIops === null ? 'not entered' : fmt0(r.storagePerformance.availableS2dIops)}</td><td className="num">{fmt0(r.storagePerformance.requiredS2dThroughputMBps)}</td><td className="num">{r.storagePerformance.availableS2dThroughputMBps === null ? 'not entered' : fmt0(r.storagePerformance.availableS2dThroughputMBps)}</td></tr>
              )}
              {(chosen.cfg.architecture === 'san' || chosen.cfg.architecture === 'hybrid') && (
                <tr><td>SAN</td><td className="num">{fmt0(r.storagePerformance.requiredSanIops)}</td><td className="num">{r.storagePerformance.availableSanIops === null ? 'not entered' : fmt0(r.storagePerformance.availableSanIops)}</td><td className="num">{fmt0(r.storagePerformance.requiredSanThroughputMBps)}</td><td className="num">{r.storagePerformance.availableSanThroughputMBps === null ? 'not entered' : fmt0(r.storagePerformance.availableSanThroughputMBps)}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {split && (
          <>
            <h3 style={{ marginTop: 18 }}>Target clusters</h3>
            <div className="scroll" style={{ maxHeight: 'none' }}>
              <table>
                <thead><tr><th>Cluster</th><th>Purpose</th><th className="num">Workload VMs</th><th className="num">Management VMs</th><th className="num">Nodes</th><th>Binding</th><th className="num">Required TiB</th>{chosen.cfg.architecture !== 'san' && <th className="num">S2D usable TiB</th>}{storage?.sanToBuyUsableTiB != null && <th className="num">SAN to buy TiB</th>}</tr></thead>
                <tbody>{design.clusters.map((cluster) => <tr key={cluster.id}><td><strong>{cluster.name}</strong></td><td>{cluster.purpose}</td><td className="num">{fmt0(cluster.workloadVms)}</td><td className="num">{cluster.managementVms || '—'}</td><td className="num">{cluster.nodesLabel}</td><td><span className="pill info">{cluster.binding}</span></td><td className="num">{fmt1(cluster.requiredStorageTiB)}</td>{chosen.cfg.architecture !== 'san' && <td className="num">{cluster.s2dUsableTiB === null ? '—' : fmt1(cluster.s2dUsableTiB)}</td>}{storage?.sanToBuyUsableTiB != null && <td className="num">{cluster.sanToBuyUsableTiB === null ? '—' : fmt1(cluster.sanToBuyUsableTiB)}</td>}</tr>)}</tbody>
              </table>
            </div>
          </>
        )}

        {r.capacity && design.status === 'feasible' && (
          <>
            <h3 style={{ marginTop: 18 }}>S2D capacity chain</h3>
            <table>
              <tbody>
                <tr><td>Raw pool ({r.nodes} nodes)</td><td className="num mono">{fmt1(r.capacity.rawTiB)} TiB</td></tr>
                <tr><td>Less reserve — 1 drive per server, capped at 4 drives total</td><td className="num mono">−{fmt1(r.capacity.reserveTiB)} TiB</td></tr>
                <tr><td>Available for volumes</td><td className="num mono">{fmt1(r.capacity.availableTiB)} TiB</td></tr>
                <tr><td>Resiliency — {r.capacity.efficiencyLabel}</td><td className="num mono">× {(r.capacity.efficiency * 100).toFixed(1)}%</td></tr>
                <tr><td><strong>Usable</strong></td><td className="num mono"><strong>{fmt1(r.capacity.usableTiB)} TiB</strong></td></tr>
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 6 }}>
              Cache drives are excluded from raw capacity entirely. Microsoft publishes no filesystem-overhead
              percentage beyond this chain, so none is applied.
            </p>
          </>
        )}
      </div>

      {designChoices}

      {growth && <div className="panel">
        <h2>Capacity growth plan</h2>
        <p className="small muted" style={{ marginTop: -6 }}>Forecast scope: {growth.scopeLabel}.</p>
        <div className={`note ${growth.allFeasible ? 'ok' : 'warn'}`}>
          <strong>{growth.plan.strategy === 'build-now' ? 'Forecast capacity is included now' : 'Nodes are phased with demand'}</strong>
          {growth.plan.annualGrowthPct > 0
            ? `${(growth.plan.annualGrowthPct * 100).toFixed(1)}% annual growth compounds through Year ${growth.plan.horizonYears}. Immediate headroom is ${growth.plan.immediateHeadroomPct.toFixed(1)}%.`
            : `No annual growth is currently entered. Immediate headroom is ${growth.plan.immediateHeadroomPct.toFixed(1)}%; set an annual percentage under Hardware and assumptions to create a changing forecast.`}
        </div>
        <div className="grid cards">
          <Card k="Nodes required today" v={growth.currentRequiredNodes ?? 'Review'} s={`${growth.plan.baseGrowthFactor.toFixed(2)}× imported demand`} />
          <Card k="Nodes planned today" v={growth.plannedNodesToday ?? 'Review'} s={growth.plan.strategy === 'build-now' ? `includes Year ${growth.plan.horizonYears}` : 'phased starting point'} />
          <Card k={`Year ${growth.plan.horizonYears} demand`} v={`${growth.plan.terminalGrowthFactor.toFixed(2)}×`} s="of imported demand" />
        </div>
        <div className="scroll" style={{ maxHeight: 'none', marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Timeline</th>
                <th className="num">Demand multiplier</th>
                <th className="num">Nodes required</th>
                <th>Binding constraint</th>
                {growth.points.some((point) => point.sanToBuyUsableTiB !== null) && <th className="num">SAN usable to buy (TiB)</th>}
                <th>Deployment action</th>
              </tr>
            </thead>
            <tbody>
              {growth.points.map((point) => (
                <tr key={point.year}>
                  <td><strong>{point.year === 0 ? 'Today' : `Year ${point.year}`}</strong></td>
                  <td className="num mono">{point.demandFactor.toFixed(2)}×</td>
                  <td className="num"><strong>{point.nodesLabel}</strong></td>
                  <td><span className={`pill ${point.binding === 'storage' ? 'warn' : 'info'}`}>{point.binding}</span></td>
                  {growth.points.some((item) => item.sanToBuyUsableTiB !== null) && <td className="num mono">{point.sanToBuyUsableTiB === null ? '—' : fmt1(point.sanToBuyUsableTiB)}</td>}
                  <td>{point.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          This is a planning forecast, not measured trend analysis. It compounds the entered growth percentage across the current workload mix and preserves the selected N+n reserve at every point.
        </p>
      </div>}

      <div className="panel">
        <h2>{chosen.cfg.architecture === 'san'
          ? 'SAN CSV / LUN layout'
          : chosen.cfg.architecture === 's2d'
            ? 'S2D volume / CSV layout'
            : 'Hybrid storage volume layout'}</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          This is a logical workload-volume plan, not a physical disk or RAID layout. For SAN, one presented LUN becomes one CSV.
          For S2D, the object is an S2D volume/CSV and no SAN LUN exists. S2D enforces the tier recovery targets and
          a cluster-wide minimum of one volume per node. SAN behavior follows the selected layout mode.
        </p>
        {sanPlans.length > 0 && !sanPlans[0].recoveryGroupingApplied && (
          <div className="note">
            <strong>{sanPlans[0].layoutMode === 'custom' ? 'Custom SAN layout' : 'Recommended operational SAN layout'}: {sanCsvCount} CSV/LUNs</strong>
            The editable per-tier recovery targets would produce <strong>{granularSanAlternative}</strong> CSV/LUNs.
            They are shown as an optional granular-recovery alternative and are not silently enforced in this mode.
          </div>
        )}
        {!storage?.csvPlans && <div className="note warn"><strong>Layout not calculated</strong>{storage?.csvNotCalculatedReason ?? 'Resolve the node count first.'}</div>}
        {storage?.csvPlans && <div className="scroll">
          <table>
            <thead>
              <tr>
                {storage?.perCluster && <th>Cluster</th>}
                <th>Tier</th>
                <th>Storage object</th>
                <th>Planned demand</th>
                <th>Count calculation</th>
                <th>Recommended layout</th>
                <th>Controlling rule</th>
              </tr>
            </thead>
            <tbody>
              {csvPlans.map((p, i) => (
                <tr key={i}>
                  {storage?.perCluster && <td>{p.cluster}</td>}
                  <td><strong>{tiers[p.tier].label}</strong></td>
                  <td>
                    <span className={`pill ${p.domain === 's2d' ? 'ok' : 'info'}`}>
                      {p.domain === 'san' ? 'SAN CSV / LUN' : 'S2D volume / CSV'}
                    </span>
                    <div className="small muted mono" style={{ marginTop: 4 }}>{p.filesystem}</div>
                  </td>
                  <td className="nowrap">
                    <strong className="mono">{fmt1(p.totalTiB)} TiB</strong>
                    <div className="small muted">{p.plannedVms.toLocaleString()} planned VMs</div>
                  </td>
                  <td className="nowrap">
                    <div>By {p.recoveryGroupingApplied ? 'recovery size' : 'hard size cap'}: <span className="mono">ceil({fmt1(p.totalTiB)} / {fmt1(p.maxSizeTiB)}) = {p.countByCapacity}</span></div>
                    <div className="small muted">By VM grouping{p.recoveryGroupingApplied ? '' : ' (advisory)'}: <span className="mono">ceil({p.plannedVms} / {p.maxVmsPerCsv}) = {p.countByVmLimit}</span></div>
                    {!p.recoveryGroupingApplied && <div className="small muted">Granular tier alternative: {p.granularAdvisoryCount}</div>}
                  </td>
                  <td className="nowrap">
                    <strong>{p.count} × <span className="mono">{fmt1(p.sizeTiB)} TiB</span></strong>
                    {(p.freeSpaceTargetPct ?? 0) > 0 && <div className="small muted">Size keeps {((p.freeSpaceTargetPct ?? 0) * 100).toFixed(0)}% free</div>}
                    <div className="small muted">Up to {p.vmsPerCsv} planned VMs each</div>
                    {p.count !== p.roundedUpFrom && (
                      <div className="small muted">{p.layoutMode === 's2d' ? 'Node-balanced' : p.layoutMode === 'custom' ? 'Custom target' : 'Operationally balanced'} from {p.roundedUpFrom} to {p.count}</div>
                    )}
                  </td>
                  <td><span className={`pill ${p.driver === 'vm-count' || p.driver === 'both' ? 'warn' : 'info'}`}>{driverLabel[p.driver]}</span></td>
                </tr>
              ))}
              <tr>
                <td colSpan={storage?.perCluster ? 5 : 4}><strong>Total logical storage objects</strong></td>
                <td><strong>{storage?.totalCsvs}</strong></td>
                <td className="small muted">A result above 64 generates a design warning.</td>
              </tr>
            </tbody>
          </table>
        </div>}
        <p className="small muted" style={{ marginTop: 8 }}>
          Recovery-unit size and target VMs per recovery unit are editable TOOL assumptions. Workload growth increases
          both logical capacity and the equivalent planned VM count; imported inventory counts remain unchanged elsewhere.
          In SAN Balanced and Custom modes those assumptions are advisory; select Granular recovery to enforce them.
        </p>
      </div>

      <div className="panel">
        <h2>Demand by tier</h2>
        <table>
          <thead>
            <tr>
              <th>Tier</th>
              <th className="num">VMs</th>
              <th className="num">vCPU:pCore</th>
              <th className="num">Cores</th>
              <th className="num">RAM TiB</th>
              <th className="num">Storage TiB</th>
            </tr>
          </thead>
          <tbody>
            {TIER_IDS.filter(id => r.demand.byTier[id].vms > 0).map(id => {
              const d = r.demand.byTier[id]
              return (
                <tr key={id}>
                  <td><strong>{tiers[id].label}</strong></td>
                  <td className="num">{fmt0(d.vms)}</td>
                  <td className="num mono">{tiers[id].oversubscription}:1</td>
                  <td className="num">{fmt1(d.pCores)}</td>
                  <td className="num">{fmt1(d.ramGiB / 1024)}</td>
                  <td className="num">{fmt1(giBToTiB(d.storageGiB))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Findings — {r.findings.filter(f => f.severity === 'error').length} errors,{' '}
          {r.findings.filter(f => f.severity === 'warning').length} warnings</h2>
        <FindingsList findings={r.findings} />
      </div>

      <div className="panel">
        <h2>Export</h2>
        <button className="btn" onClick={onExport}>Download workbook (.xlsx)</button>
        <p className="small muted" style={{ marginTop: 8 }}>
          Seven tabs: architecture comparison, growth plan, CSV plan, validation findings, tier policy, data quality, and the full inventory.
        </p>
      </div>
    </div>
  )
}
