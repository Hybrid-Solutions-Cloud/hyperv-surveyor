import { useMemo } from 'react'
import { clusterNodeLimitFor, planMultipleClusters, type PlacementInputs } from '../engine/deploymentPlanning'
import type { ArchitectureOption } from '../engine/solve'
import type { TierId, TierPolicy, Vm } from '../engine/types'
import { Field, NumberInput, fmt0 } from './Shared'

interface Props {
  option: ArchitectureOption
  vms: Vm[]
  tiers: Record<TierId, TierPolicy>
  inputs: PlacementInputs
  setInputs: (inputs: PlacementInputs) => void
}

/** One cluster or split is the user's decision. This panel shows the trade and changes nothing itself. */
export function ClusterLayoutPanel({ option, vms, tiers, inputs, setInputs }: Props) {
  const result = option.result
  const limit = clusterNodeLimitFor(option.cfg)
  const spare = option.cfg.spareNodes
  const maxNodes = Math.min(inputs.maxNodesPerCluster, limit)
  const split = useMemo(
    () => planMultipleClusters(option.cfg, vms, tiers, { ...inputs, clusterLayout: 'split', maxNodesPerCluster: maxNodes }),
    [option.cfg, vms, tiers, inputs, maxNodes],
  )
  const set = (patch: Partial<PlacementInputs>) => setInputs({ ...inputs, ...patch })
  const needed = result.nodesNeeded
  const overLimit = needed !== null && needed > limit
  const extraNodes = split.feasible && needed !== null ? split.totalNodes - needed : null

  return (
    <div className="panel">
      <h2>Cluster layout: {option.label}</h2>
      <p className="small muted" style={{ marginTop: -6 }}>
        One {option.cfg.architecture === 'san' ? 'SAN' : 'S2D or hybrid'} cluster can have up to <strong>{limit} nodes</strong>.
        Surveyor keeps one cluster unless you choose to split.
      </p>
      {overLimit && inputs.clusterLayout === 'single' && (
        <div className="note warn">
          <strong>One cluster needs {needed} nodes, above the {limit}-node limit</strong>
          Nothing has been split. Your options are a larger reference server, another storage type, or Split into multiple clusters below.
        </div>
      )}
      <div className="row">
        <Field label="Layout">
          <select value={inputs.clusterLayout} onChange={(event) => set({ clusterLayout: event.target.value as PlacementInputs['clusterLayout'] })}>
            <option value="single">One cluster</option>
            <option value="split">Split into multiple clusters</option>
          </select>
        </Field>
        <Field label="Maximum nodes per cluster, if split" hint={`Up to ${limit} for this storage type.`}>
          <NumberInput value={maxNodes} min={Math.max(2, spare + 1)} max={limit} onChange={(value) => set({ maxNodesPerCluster: Math.round(value) })} />
        </Field>
        <Field label="Target VMs per cluster, if split" hint="8,000 is the Hyper-V maximum, so it adds no extra limit.">
          <NumberInput value={inputs.targetVmsPerCluster} min={1} max={8000} step={50} onChange={(value) => set({ targetVmsPerCluster: Math.round(value) })} />
        </Field>
      </div>
      <div className="scroll" style={{ maxHeight: 'none' }}>
        <table>
          <thead>
            <tr><th>Layout</th><th className="num">Clusters</th><th className="num">Total nodes</th><th className="num">Spare nodes</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr className={inputs.clusterLayout === 'single' ? 'chosen' : ''}>
              <td><strong>One cluster</strong></td>
              <td className="num">1</td>
              <td className="num">{needed === null ? '—' : fmt0(needed)}</td>
              <td className="num">{spare}</td>
              <td>{result.feasible ? <span className="pill ok">fits</span> : <span className="pill err">{overLimit ? `over ${limit}-node limit` : 'blocked'}</span>}</td>
            </tr>
            <tr className={inputs.clusterLayout === 'split' ? 'chosen' : ''}>
              <td><strong>Split, up to {maxNodes} nodes each</strong></td>
              <td className="num">{split.feasible ? split.clusters.length : '—'}</td>
              <td className="num">{split.feasible ? fmt0(split.totalNodes) : '—'}</td>
              <td className="num">{split.feasible ? fmt0(split.clusters.length * spare) : '—'}</td>
              <td>{split.feasible ? <span className="pill ok">fits</span> : <span className="pill err">does not fit</span>}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {extraNodes !== null && extraNodes > 0 && (
        <p className="small muted" style={{ marginTop: 8 }}>
          This split uses {extraNodes} more node{extraNodes === 1 ? '' : 's'} than one cluster because each cluster keeps its own N+{spare} spares.
        </p>
      )}
      {!split.feasible && split.warnings.map((warning) => <div className="note warn" key={warning} style={{ marginTop: 8 }}>{warning}</div>)}
      {inputs.clusterLayout === 'split' && (
        <p className="small muted" style={{ marginTop: 8 }}>
          The sizing details below describe one cluster. Per-cluster results and source-cluster and database grouping are on the Implementation plan.
        </p>
      )}
    </div>
  )
}
