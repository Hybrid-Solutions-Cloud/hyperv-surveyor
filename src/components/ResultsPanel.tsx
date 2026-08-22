import React from 'react'
import { forecastGrowth, type ArchitectureOption, type GrowthForecastPoint } from '../engine/solve'
import { RESILIENCY, TIER_IDS } from '../engine/rules'
import { giBToTiB } from '../engine/compute'
import type { TierId, TierPolicy, Vm } from '../engine/types'
import { Card, FindingsList, fmt0, fmt1 } from './Shared'

interface Props {
  options: ArchitectureOption[]
  chosenKey: string
  setChosenKey: (k: string) => void
  tiers: Record<TierId, TierPolicy>
  vms: Vm[]
  onExport: () => void
}

const driverLabel: Record<string, string> = {
  capacity: 'capacity',
  'blast-radius': 'blast radius',
  'node-count': 'node count',
}

export function ResultsPanel({ options, chosenKey, setChosenKey, tiers, vms, onExport }: Props) {
  const chosen = options.find(o => o.key === chosenKey) ?? options[0]
  const r = chosen.result
  const availableStorageTiB = (r.capacity?.usableTiB ?? 0) + (r.sanCapacityTiB ?? 0)

  if (r.demand.vmCount === 0) {
    return (
      <div className="panel">
        <h2>Results</h2>
        <p className="muted">Add workloads first — import an RVTools export, add rows by hand, or load the demo fleet.</p>
      </div>
    )
  }

  const spare = r.nodes - r.workloadNodes
  const growth = forecastGrowth(chosen.cfg, vms, tiers)
  const actionFor = (point: GrowthForecastPoint, index: number) => {
    if (!point.result.feasible) {
      if (point.result.sanCapacityTiB !== null && point.result.requiredSanTiB > point.result.sanCapacityTiB) {
        return `Expand SAN effective capacity by ${fmt1(point.result.requiredSanTiB - point.result.sanCapacityTiB)} TiB`
      }
      return 'Review node density or split into multiple clusters'
    }
    if (growth.plan.strategy === 'build-now') {
      return index === 0
        ? `Build ${growth.plannedNodesToday ?? '—'} nodes now`
        : `Covered by initial ${growth.plannedNodesToday ?? '—'}-node build`
    }
    if (index === 0) return `Initial build: ${point.result.nodes} nodes`
    return point.additionalNodes && point.additionalNodes > 0
      ? `Add ${point.additionalNodes} node${point.additionalNodes === 1 ? '' : 's'}`
      : 'No node addition'
  }

  return (
    <div className="stack">
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
                <th className="num">Usable TiB</th>
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
                    <td className="num"><strong>{s.feasible ? s.nodes : '—'}</strong></td>
                    <td className="num">{s.feasible ? s.workloadNodes : '—'}</td>
                    <td>
                      <span className={`pill ${s.binding === 'storage' ? 'warn' : 'info'}`}>{s.binding}</span>
                    </td>
                    <td className="num">
                      {(s.capacity || s.sanCapacityTiB !== null) ? fmt1((s.capacity?.usableTiB ?? 0) + (s.sanCapacityTiB ?? 0)) : '—'}
                    </td>
                    <td className="num">{fmt1(s.requiredStorageTiB)}</td>
                    <td className="num">{s.totalCsvs}</td>
                    <td className="num">{fmt0(s.totalLicensableCores)}</td>
                    <td className="num">{fmt1(s.resiliencyOverheadPct)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>{chosen.label}</h2>
        <div className={`note ${r.feasible ? 'ok' : 'err'}`}>
          <strong>
            {r.feasible
              ? `${r.nodes} nodes — ${r.workloadNodes} carrying workload after N+${spare}`
              : 'Not feasible in a single cluster'}
          </strong>
          {r.bindingExplanation}
        </div>
        <div className={`note ${r.performanceAssessment.confidence === 'high' ? 'ok' : r.performanceAssessment.measuredVms > 0 ? 'warn' : ''}`}>
          <strong>Sizing evidence: {r.performanceAssessment.basis === 'measured-p95' ? 'measured P95 with allocation fallback' : 'allocation'} · {r.performanceAssessment.confidence.replace('-', ' ')} ({r.performanceAssessment.score}/100)</strong>
          CPU coverage {r.performanceAssessment.cpuCoveragePct.toFixed(0)}% · memory {r.performanceAssessment.memoryCoveragePct.toFixed(0)}% · storage performance {r.performanceAssessment.storagePerformanceCoveragePct.toFixed(0)}%.
        </div>

        <div className="grid cards">
          <Card k="Nodes" v={r.feasible ? r.nodes : '—'} s={`${r.workloadNodes} workload + ${spare} spare`} />
          <Card k="If CPU alone" v={Number.isFinite(r.nodesIfCpuOnly) ? r.nodesIfCpuOnly : '—'} s="nodes" />
          <Card k="If memory alone" v={Number.isFinite(r.nodesIfMemoryOnly) ? r.nodesIfMemoryOnly : '—'} s="nodes" />
          <Card k="If storage alone"
            v={Number.isFinite(r.nodesIfStorageOnly) ? (r.capacity ? r.nodesIfStorageOnly : 'passes') : 'fails'}
            s={r.capacity ? 'nodes / domain validation' : `${fmt1(r.sanCapacityTiB ?? 0)} TiB SAN effective`} />
          <Card k="Cores required" v={fmt0(r.demand.requiredPCores)} s={`from ${fmt0(r.demand.totalVCpu)} allocated vCPU`} />
          <Card k="RAM required" v={fmt1(r.demand.requiredRamGiB / 1024)} s="TiB" />
          <Card k="Storage required" v={fmt1(r.requiredStorageTiB)} s="TiB consumed" />
          <Card k="Storage available" v={fmt1(availableStorageTiB)} s={chosen.cfg.architecture === 'hybrid' ? `${fmt1(r.capacity?.usableTiB ?? 0)} S2D + ${fmt1(r.sanCapacityTiB ?? 0)} SAN` : 'TiB effective / usable'} />
          <Card k="Licensable cores" v={fmt0(r.totalLicensableCores)} s={`${r.licensableCoresPerNode} per node × ${r.nodes}`} />
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

        {r.capacity && (
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

      <div className="panel">
        <h2>Capacity growth plan</h2>
        <div className={`note ${growth.points.every((point) => point.result.feasible) ? 'ok' : 'warn'}`}>
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
                <th>Deployment action</th>
              </tr>
            </thead>
            <tbody>
              {growth.points.map((point, index) => (
                <tr key={point.year}>
                  <td><strong>{point.year === 0 ? 'Today' : `Year ${point.year}`}</strong></td>
                  <td className="num mono">{point.demandFactor.toFixed(2)}×</td>
                  <td className="num"><strong>{point.result.feasible ? point.result.nodes : 'Review'}</strong></td>
                  <td><span className={`pill ${point.result.binding === 'storage' ? 'warn' : 'info'}`}>{point.result.binding}</span></td>
                  <td>{actionFor(point, index)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          This is a planning forecast, not measured trend analysis. It compounds the entered growth percentage across the current workload mix and preserves the selected N+n reserve at every point.
        </p>
      </div>

      <div className="panel">
        <h2>CSV / LUN layout</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          Each tier is driven by capacity and recovery blast radius. Across S2D, the total is then raised to at least one volume per node and a
          whole node-count multiple so coordinator ownership distributes evenly. On SAN the LUN <em>is</em> the
          restore unit, because an array snapshot covers the whole volume; that is why blast radius often binds
          before capacity does.
        </p>
        <table>
          <thead>
            <tr>
              <th>Tier</th>
              <th>Domain</th>
              <th>FS</th>
              <th className="num">CSVs</th>
              <th className="num">Size each</th>
              <th className="num">Total</th>
              <th className="num">VMs / CSV</th>
              <th>Driver</th>
            </tr>
          </thead>
          <tbody>
            {r.csvPlans.map((p, i) => (
              <tr key={i}>
                <td><strong>{tiers[p.tier].label}</strong></td>
                <td><span className={`pill ${p.domain === 's2d' ? 'ok' : 'info'}`}>{p.domain.toUpperCase()}</span></td>
                <td className="mono">{p.filesystem}</td>
                <td className="num"><strong>{p.count}</strong>
                  {p.count !== p.roundedUpFrom && (
                    <div className="small muted nowrap">up from {p.roundedUpFrom}</div>
                  )}
                </td>
                <td className="num mono">{fmt1(p.sizeTiB)} TiB</td>
                <td className="num mono">{fmt1(p.totalTiB)} TiB</td>
                <td className="num">{p.vmsPerCsv}</td>
                <td><span className={`pill ${p.driver === 'blast-radius' ? 'warn' : 'info'}`}>{driverLabel[p.driver]}</span></td>
              </tr>
            ))}
            <tr>
              <td colSpan={3}><strong>Total</strong></td>
              <td className="num"><strong>{r.totalCsvs}</strong></td>
              <td colSpan={4} className="small muted">Recommended maximum is 64 per cluster</td>
            </tr>
          </tbody>
        </table>
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
