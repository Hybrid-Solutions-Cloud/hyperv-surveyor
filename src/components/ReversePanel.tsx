import React, { useMemo } from 'react'
import { solveReverse } from '../engine/solve'
import { RESILIENCY, TIER_IDS } from '../engine/rules'
import type { ClusterConfig, Resiliency, TierId, TierPolicy, Vm } from '../engine/types'
import { Card, Field, FindingsList, Meter, NumberInput, fmt0, fmt1 } from './Shared'

interface Props {
  cfg: ClusterConfig
  setCfg: (cfg: ClusterConfig) => void
  tiers: Record<TierId, TierPolicy>
  setTiers: (tiers: Record<TierId, TierPolicy>) => void
  nodes: number
  setNodes: (nodes: number) => void
  reset: () => void
  vms: Vm[]
}

export function ReversePanel({ cfg, setCfg, tiers, setTiers, nodes, setNodes, reset, vms }: Props) {
  const r = useMemo(() => solveReverse(cfg, nodes, vms, tiers), [cfg, nodes, vms, tiers])
  const set = (partial: Partial<ClusterConfig>) => setCfg({ ...cfg, ...partial })
  const setNode = (partial: Partial<ClusterConfig['node']>) => setCfg({ ...cfg, node: { ...cfg.node, ...partial } })
  const setSan = (partial: Partial<ClusterConfig['san']>) => setCfg({ ...cfg, san: { ...cfg.san, ...partial } })
  const setTier = (id: TierId, partial: Partial<TierPolicy>) => setTiers({ ...tiers, [id]: { ...tiers[id], ...partial } })
  const setExistingNodes = (value: number) => {
    const nextNodes = Math.min(64, Math.max(1, value))
    setNodes(nextNodes)
    if (cfg.spareNodes >= nextNodes) set({ spareNodes: Math.max(0, nextNodes - 1) })
  }
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'
  const usesSan = cfg.architecture === 'san' || cfg.architecture === 'hybrid'

  const pctCpu = r.availablePCores > 0 ? r.usedPCores / r.availablePCores : 0
  const pctRam = r.availableRamGiB > 0 ? r.usedRamGiB / r.availableRamGiB : 0
  const pctSto = r.storageDomains.length > 0 ? Math.max(...r.storageDomains.map((domain) => domain.utilisationPct / 100)) : 0
  const over = pctCpu >= 1 || pctRam >= 1 || r.storageDomains.some((domain) => domain.utilisationPct >= 100)

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-heading-row">
          <div>
            <h2>Enter the hardware you already own</h2>
            <p className="small muted">This is an independent capacity workspace. These values do not read from or change the proposed-design assumptions.</p>
          </div>
          <button className="btn ghost compact" type="button" onClick={reset}>Reset existing hardware</button>
        </div>

        <div className="capacity-input-section">
          <h3>Cluster foundation</h3>
          <div className="capacity-input-grid">
            <Field label="Existing hosts">
              <NumberInput value={nodes} min={1} max={64} onChange={setExistingNodes} />
            </Field>
            <Field label="Storage architecture">
              <select value={cfg.architecture} onChange={event => set({ architecture: event.target.value as ClusterConfig['architecture'] })}>
                <option value="san">SAN-backed cluster</option>
                <option value="s2d">Storage Spaces Direct</option>
                <option value="hybrid">S2D + SAN hybrid</option>
              </select>
            </Field>
            <Field label="Reserved / unavailable hosts" hint="Hosts kept out of normal workload placement for failure or maintenance capacity.">
              <NumberInput value={cfg.spareNodes} min={0} max={Math.max(0, nodes - 1)} onChange={n => set({ spareNodes: Math.min(Math.max(0, nodes - 1), n) })} />
            </Field>
            <Field label="Immediate demand multiplier" hint="Use 1.0 for current demand; 1.2 adds 20% immediate headroom. Build-now annual growth is applied in addition.">
              <NumberInput value={cfg.growthFactor} min={0.1} step={0.05} onChange={n => set({ growthFactor: Math.max(0.1, n) })} />
            </Field>
            <Field label="Backup method">
              <select value={cfg.backupMethod} onChange={event => set({ backupMethod: event.target.value as ClusterConfig['backupMethod'] })}>
                <option value="rct">Hyper-V RCT / ReFS block clone / SQL native</option>
                <option value="vss-volsnap">VSS / volsnap based</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="capacity-input-section">
          <h3>Per-host compute</h3>
          <div className="capacity-input-grid">
            <Field label="Sockets / host"><NumberInput value={cfg.node.sockets} min={1} max={8} onChange={n => setNode({ sockets: Math.max(1, n) })} /></Field>
            <Field label="Physical cores / socket"><NumberInput value={cfg.node.coresPerSocket} min={1} onChange={n => setNode({ coresPerSocket: Math.max(1, n) })} /></Field>
            <Field label="Installed RAM / host (GiB)"><NumberInput value={cfg.node.ramGiB} min={16} step={16} onChange={n => setNode({ ramGiB: Math.max(16, n) })} /></Field>
            <Field label="SMT capacity factor" hint="Leave at 1.0 unless you intentionally credit SMT capacity."><NumberInput value={cfg.smtFactor} min={1} max={2} step={0.1} onChange={n => set({ smtFactor: Math.min(2, Math.max(1, n)) })} /></Field>
            <Field label="Host CPU reserve %"><NumberInput value={cfg.hostCoreReservePct * 100} min={0} max={100} step={1} onChange={n => set({ hostCoreReservePct: Math.min(100, Math.max(0, n)) / 100 })} /></Field>
            <Field label="Host RAM reserve (GiB)"><NumberInput value={cfg.hostRamReserveGiB} min={0} step={4} onChange={n => set({ hostRamReserveGiB: n })} /></Field>
            <Field label="Host RAM reserve %"><NumberInput value={cfg.hostRamReservePct * 100} min={0} max={100} step={1} onChange={n => set({ hostRamReservePct: Math.min(100, Math.max(0, n)) / 100 })} /></Field>
          </div>
        </div>

        {usesSan && (
          <div className="capacity-input-section">
            <h3>Existing SAN capacity</h3>
            <div className="capacity-input-grid">
              <Field label="Array usable capacity (TiB)" hint="Enter usable—not effective or provisioned—capacity.">
                <NumberInput value={cfg.san.usableTiB} min={0} step={0.1} onChange={n => setSan({ usableTiB: Math.max(0, n) })} />
              </Field>
              <Field label="Measured data reduction ratio" hint="Use 1.0 when reduction is unavailable or uncertain.">
                <NumberInput value={cfg.san.drr} min={1} step={0.1} onChange={n => setSan({ drr: Math.max(1, n) })} />
              </Field>
            </div>
          </div>
        )}

        {usesS2d && (
          <div className="capacity-input-section">
            <h3>Existing Storage Spaces Direct media</h3>
            <div className="capacity-input-grid">
              <Field label="Media layout">
                <select value={cfg.node.media} onChange={event => setNode({ media: event.target.value as ClusterConfig['node']['media'] })}>
                  <option value="all-flash">All-flash</option>
                  <option value="hybrid">Hybrid HDD + cache</option>
                </select>
              </Field>
              <Field label="Capacity drives / host"><NumberInput value={cfg.node.capacityDrivesPerNode} min={0} onChange={n => setNode({ capacityDrivesPerNode: n })} /></Field>
              <Field label="Capacity drive size (TB)"><NumberInput value={cfg.node.capacityDriveTB} min={0} step={0.01} onChange={n => setNode({ capacityDriveTB: n })} /></Field>
              <Field label="Cache drives / host"><NumberInput value={cfg.node.cacheDrivesPerNode} min={0} onChange={n => setNode({ cacheDrivesPerNode: n })} /></Field>
              <Field label="Cache drive size (TB)"><NumberInput value={cfg.node.cacheDriveTB} min={0} step={0.01} onChange={n => setNode({ cacheDriveTB: n })} /></Field>
              <Field label="Current volume resiliency">
                <select value={cfg.resiliency} onChange={event => set({ resiliency: event.target.value as Resiliency })}>
                  {Object.values(RESILIENCY).map(option => <option value={option.id} key={option.id}>{option.label}</option>)}
                </select>
              </Field>
              {(cfg.resiliency === 'nested-map' || cfg.resiliency === 'mirror-accelerated-parity') && (
                <Field label="Mirror share">
                  <select value={cfg.nestedMapMirrorPct} onChange={event => set({ nestedMapMirrorPct: Number(event.target.value) as ClusterConfig['nestedMapMirrorPct'] })}>
                    <option value={0.1}>10%</option>
                    <option value={0.2}>20%</option>
                    <option value={0.3}>30%</option>
                  </select>
                </Field>
              )}
              {cfg.architecture === 'hybrid' && (
                <Field label={`Split tiers on S2D: ${(cfg.hybridS2dShare * 100).toFixed(0)}%`} hint="Applies only to workload tiers whose hybrid placement is Split.">
                  <input type="range" min={0.1} max={0.9} step={0.05} value={cfg.hybridS2dShare} onChange={event => set({ hybridS2dShare: Number(event.target.value) })} />
                </Field>
              )}
            </div>
          </div>
        )}

        <div className="note ok">
          <strong>This existing-hardware profile is saved separately</strong>
          Nothing entered here changes the workload-driven forward design.
        </div>
      </div>

      <div className="panel">
        <h2>Hardware capacity</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          Physical capacity after unavailable hosts and host reserves, followed by the current inventory fit.
        </p>
        <div className="grid cards" style={{ marginBottom: 18 }}>
          <Card k="Usable CPU" v={fmt1(r.availablePCores)} s="physical cores" />
          <Card k="Usable memory" v={fmt1(r.availableRamGiB / 1024)} s="TiB" />
          <Card k="Usable storage" v={fmt1(r.availableStorageTiB)} s="TiB" />
          <Card k="Workload hosts" v={r.workloadNodes} s={`${nodes} total, ${cfg.spareNodes} unavailable`} />
        </div>
        <h3>Current workload fit</h3>
        <p className="small muted">Testing {vms.filter(vm => vm.include).length.toLocaleString()} included VMs from the workload inventory.</p>
        <div className={`note ${over ? 'err' : 'ok'}`}>
          <strong>{r.binding === 'cpu' ? 'CPU' : r.binding === 'memory' ? 'Memory' : 'Storage'} binds first</strong>
          {r.bindingExplanation}
        </div>
        <Meter label={`CPU — ${fmt1(r.usedPCores)} of ${fmt1(r.availablePCores)} physical cores`} pct={pctCpu} />
        <Meter label={`Memory — ${fmt0(r.usedRamGiB)} of ${fmt0(r.availableRamGiB)} GiB`} pct={pctRam} />
        <Meter label={`Storage — ${fmt1(r.usedStorageTiB)} of ${fmt1(r.availableStorageTiB)} TiB`} pct={pctSto} />
        {r.storageDomains.map((domain) => <Meter key={domain.domain} label={`${domain.domain.toUpperCase()} domain — ${fmt1(domain.usedTiB)} of ${fmt1(domain.availableTiB)} TiB`} pct={domain.utilisationPct / 100} />)}

        <div className="grid cards" style={{ marginTop: 16 }}>
          <Card k="Spare cores" v={fmt1(r.headroomPCores)} s={r.headroomPCores < 0 ? 'over-committed' : 'physical'} />
          <Card k="Spare memory" v={fmt1(r.headroomRamGiB / 1024)} s="TiB" />
          <Card k="Spare storage" v={fmt1(r.headroomStorageTiB)} s="TiB" />
          <Card k="Included workloads" v={vms.filter(vm => vm.include).length.toLocaleString()} s="VMs assessed" />
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
        <details className="capacity-policy-details">
          <summary>
            <span>Advanced workload-fit assumptions</span>
            <b>Optional · affects fit calculations, not hardware inventory</b>
          </summary>
          <div className="capacity-policy-body">
            <p className="small muted">
              Use these only when the existing environment has measured consolidation or right-sizing policies.
              They are independent from the workload-driven forward-design assumptions.
            </p>
            <div className="scroll">
              <table className="capacity-policy-table">
                <thead><tr><th>Workload tier</th><th className="num">vCPU : physical core</th><th className="num">Demand factor</th></tr></thead>
                <tbody>
                  {TIER_IDS.map(id => (
                    <tr key={id}>
                      <td><strong>{tiers[id].label}</strong></td>
                      <td><NumberInput value={tiers[id].oversubscription} min={0.1} step={0.5} onChange={n => setTier(id, { oversubscription: Math.max(0.1, n) })} /></td>
                      <td><NumberInput value={tiers[id].rightSizingFactor} min={0.1} max={2} step={0.05} onChange={n => setTier(id, { rightSizingFactor: Math.min(2, Math.max(0.1, n)) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      </div>

      <div className="panel">
        <h2>Findings</h2>
        <FindingsList findings={r.findings} />
      </div>
    </div>
  )
}
