import React, { useMemo, useState } from 'react'
import { solveReverse } from '../engine/solve'
import { TIER_IDS } from '../engine/rules'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'
import { Card, Field, FindingsList, Meter, NumberInput, fmt0, fmt1 } from './Shared'

interface Props {
  cfg: ClusterConfig
  tiers: Record<TierId, TierPolicy>
  vms: Vm[]
}

export function ReversePanel({ cfg, tiers, vms }: Props) {
  const [nodes, setNodes] = useState(8)
  const r = useMemo(() => solveReverse(cfg, nodes, vms, tiers), [cfg, nodes, vms, tiers])

  const pctCpu = r.availablePCores > 0 ? r.usedPCores / r.availablePCores : 0
  const pctRam = r.availableRamGiB > 0 ? r.usedRamGiB / r.availableRamGiB : 0
  const pctSto = r.availableStorageTiB > 0 ? r.usedStorageTiB / r.availableStorageTiB : 0
  const over = pctCpu >= 1 || pctRam >= 1 || pctSto >= 1

  return (
    <div className="stack">
      <div className="panel">
        <h2>Hardware you already have</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          The customer is not refreshing. Fix the node count and the node spec on the Configuration tab,
          and this answers what fits — and, more usefully, <strong>which constraint runs out first</strong>.
        </p>
        <div style={{ maxWidth: 240 }}>
          <Field label="Nodes in the existing cluster">
            <NumberInput value={nodes} min={1} max={64} onChange={setNodes} />
          </Field>
        </div>
      </div>

      <div className="panel">
        <h2>Headroom</h2>
        <div className={`note ${over ? 'err' : 'ok'}`}>
          <strong>{r.binding === 'cpu' ? 'CPU' : r.binding === 'memory' ? 'Memory' : 'Storage'} binds first</strong>
          {r.bindingExplanation}
        </div>
        <Meter label={`CPU — ${fmt1(r.usedPCores)} of ${fmt1(r.availablePCores)} physical cores`} pct={pctCpu} />
        <Meter label={`Memory — ${fmt0(r.usedRamGiB)} of ${fmt0(r.availableRamGiB)} GiB`} pct={pctRam} />
        <Meter label={`Storage — ${fmt1(r.usedStorageTiB)} of ${fmt1(r.availableStorageTiB)} TiB`} pct={pctSto} />

        <div className="grid cards" style={{ marginTop: 16 }}>
          <Card k="Spare cores" v={fmt1(r.headroomPCores)} s={r.headroomPCores < 0 ? 'over-committed' : 'physical'} />
          <Card k="Spare memory" v={fmt1(r.headroomRamGiB / 1024)} s="TiB" />
          <Card k="Spare storage" v={fmt1(r.headroomStorageTiB)} s="TiB" />
          <Card k="Workload nodes" v={r.workloadNodes} s={`${nodes} total, N+${nodes - r.workloadNodes}`} />
        </div>
      </div>

      <div className="panel">
        <h2>How many more VMs fit</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          Sized against the average profile of each tier already in the inventory. Where a tier has no
          exemplar, a nominal 4 vCPU / 16 GiB / 200 GiB profile is used — that fallback is a tool assumption.
        </p>
        <table>
          <thead>
            <tr>
              <th>Tier</th>
              <th className="num">Currently</th>
              <th className="num">Room for</th>
              <th className="num">Ceiling</th>
            </tr>
          </thead>
          <tbody>
            {TIER_IDS.map(id => {
              const now = vms.filter(v => v.include && v.tier === id).length
              const more = r.additionalVmsByTier[id] ?? 0
              return (
                <tr key={id}>
                  <td><strong>{tiers[id].label}</strong></td>
                  <td className="num">{fmt0(now)}</td>
                  <td className="num"><strong>{fmt0(more)}</strong></td>
                  <td className="num">{fmt0(now + more)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="small muted" style={{ marginTop: 8 }}>
          These are mutually exclusive — filling one tier consumes the headroom the others would have used.
        </p>
      </div>

      <div className="panel">
        <h2>Findings</h2>
        <FindingsList findings={r.findings} />
      </div>
    </div>
  )
}
