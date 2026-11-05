import { Fragment, useMemo, useState } from 'react'
import { compareOptions, isSelectedOption, type MatrixOption, type OptionsMatrix } from '../engine/optionsMatrix'
import { planMultipleClusters, type PlacementInputs } from '../engine/deploymentPlanning'
import { STORAGE_FAMILY_LABELS } from '../engine/storageDecision'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'
import { fmt0, fmt1 } from './Shared'

interface Props {
  matrix: OptionsMatrix
  cfg: ClusterConfig
  chosenKey: string
  onSelect: (option: MatrixOption) => void
}

interface Group {
  key: string
  storageLabel: string
  serverLabel: string
  options: MatrixOption[]
  best: MatrixOption
  viableCount: number
}

function groupRows(rows: MatrixOption[]): Group[] {
  const groups = new Map<string, MatrixOption[]>()
  for (const row of rows) {
    const key = `${row.storageKey}|${row.server.key}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.entries()].map(([key, options]) => {
    const viable = options.filter((option) => !option.rejected).sort(compareOptions)
    const best = viable[0] ?? [...options].sort((a, b) => (a.nodes ?? Infinity) - (b.nodes ?? Infinity))[0]
    return { key, storageLabel: options[0].storageLabel, serverLabel: options[0].server.label, options, best, viableCount: viable.length }
  })
}

function OptionCells({ option }: { option: MatrixOption }) {
  return (
    <>
      <td>{option.drives ? option.drives.label : <span className="muted">No local drives (SAN)</span>}</td>
      <td>{option.fitsOneCluster ? <span className="pill ok">yes</span> : <span className="pill err">no</span>}</td>
      <td className="num"><strong>{option.nodes === null ? '—' : fmt0(option.nodes)}</strong>{!option.fitsOneCluster && option.nodes !== null && <div className="small muted">needed (limit {option.result.clusterNodeLimit})</div>}</td>
      <td><span className={`pill ${option.binding === 'storage' ? 'warn' : 'info'}`}>{option.binding}</span></td>
      <td className="num">{option.s2dUsableTiB === null ? '—' : fmt1(option.s2dUsableTiB)}</td>
      <td className="num">{option.licensableCores === null ? '—' : fmt0(option.licensableCores)}</td>
      <td className="num">{option.sanToBuyUsableTiB === null ? '—' : fmt1(option.sanToBuyUsableTiB)}</td>
    </>
  )
}

function SelectCell({ option, selected, onSelect }: { option: MatrixOption; selected: boolean; onSelect: (option: MatrixOption) => void }) {
  if (selected) return <td><span className="pill ok">Selected</span></td>
  if (option.rejected) {
    return (
      <td>
        <button className="btn ghost compact" type="button" disabled aria-disabled="true" title="Ruled out: cannot be selected">Ruled out</button>
        <div className="small muted" style={{ maxWidth: 360 }}>{option.rejectionReasons.join(' ')}</div>
      </td>
    )
  }
  return <td><button className="btn compact" type="button" onClick={() => onSelect(option)}>Select</button></td>
}

/** Every storage option × server size × drive layout. Ruled-out rows say why and cannot be selected (C15). */
export function OptionsMatrixPanel({ matrix, cfg, chosenKey, onSelect }: Props) {
  const [storageFilter, setStorageFilter] = useState('all')
  const [showRuledOut, setShowRuledOut] = useState(true)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const groups = useMemo(() => groupRows(matrix.rows), [matrix.rows])
  const storageKeys = [...new Set(matrix.rows.map((row) => row.storageKey))]
  const visible = groups.filter((group) => (storageFilter === 'all' || group.best.storageKey === storageFilter) && (showRuledOut || group.viableCount > 0))

  return (
    <div className="panel">
      <h2>Options matrix</h2>
      <p className="small muted" style={{ marginTop: -6 }}>
        {matrix.rows.length.toLocaleString()} combinations sized: {storageKeys.length} storage options × {matrix.servers.length} server sizes
        {' '}× {matrix.driveLayouts.length} S2D drive layouts. {matrix.viable.length.toLocaleString()} fit one cluster.
        Each row shows the best drive layout for that storage option and server; open a row to see every layout.
        Drive catalog (a tool assumption): all-flash NVMe, {[3.84, 7.68, 15.36].join(', ')} TB, 4 to 24 drives per node, under
        Microsoft&apos;s 400 TB per server; designs above the 4 PB pool limit fail validation.
      </p>
      {matrix.guide.excluded.length > 0 && (
        <div className="note warn"><strong>Your Goals answers rule out {matrix.guide.excluded.map((family) => STORAGE_FAMILY_LABELS[family]).join(' and ')}</strong>Those rows are shown as ruled out and cannot be selected. Change the answer on the Goals page to bring them back.</div>
      )}
      <div className="row" style={{ alignItems: 'center', gap: 12 }}>
        <label className="small">Storage option{' '}
          <select value={storageFilter} onChange={(event) => setStorageFilter(event.target.value)}>
            <option value="all">All</option>
            {storageKeys.map((key) => <option key={key} value={key}>{matrix.rows.find((row) => row.storageKey === key)!.storageLabel}</option>)}
          </select>
        </label>
        <label className="small"><input type="checkbox" checked={showRuledOut} onChange={(event) => setShowRuledOut(event.target.checked)} /> Show combinations with nothing viable</label>
      </div>
      <div className="scroll" style={{ maxHeight: 'none' }}>
        <table>
          <thead>
            <tr>
              <th>Storage</th><th>Server</th><th>Drives per node</th><th>Fits one cluster</th><th className="num">Nodes</th><th>Binding</th>
              <th className="num">S2D usable TiB</th><th className="num">Licensable cores</th><th className="num">SAN to buy TiB</th><th />
            </tr>
          </thead>
          <tbody>
            {visible.map((group) => {
              const isOpen = !!open[group.key]
              const expandable = group.options.length > 1
              return (
                <Fragment key={group.key}>
                  <tr className={`${group.options.some((option) => isSelectedOption(option, cfg, chosenKey)) ? 'chosen' : ''} ${group.best.rejected ? 'infeasible' : ''}`}>
                    <td><strong>{group.storageLabel}</strong>
                      {expandable && <div><button className="btn ghost compact" type="button" onClick={() => setOpen({ ...open, [group.key]: !isOpen })}>{isOpen ? 'Hide' : 'Show'} {group.options.length} layouts ({group.viableCount} viable)</button></div>}
                    </td>
                    <td>{group.serverLabel}<div className="small muted">{group.best.server.sockets} × {group.best.server.coresPerSocket} cores, {fmt0(group.best.server.ramGiB)} GiB</div></td>
                    <OptionCells option={group.best} />
                    <SelectCell option={group.best} selected={isSelectedOption(group.best, cfg, chosenKey)} onSelect={onSelect} />
                  </tr>
                  {isOpen && group.options.filter((option) => option !== group.best).map((option) => (
                    <tr key={option.id} className={`${isSelectedOption(option, cfg, chosenKey) ? 'chosen' : ''} ${option.rejected ? 'infeasible' : ''}`}>
                      <td className="small muted">↳ same storage</td>
                      <td className="small muted">same server</td>
                      <OptionCells option={option} />
                      <SelectCell option={option} selected={isSelectedOption(option, cfg, chosenKey)} onSelect={onSelect} />
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface SplitProps {
  candidates: MatrixOption[]
  vms: Vm[]
  tiers: Record<TierId, TierPolicy>
  managementVms: Vm[]
  placementInputs: PlacementInputs
  onChooseSplit: (option: MatrixOption) => void
}

/** Split previews are computed only when this view is opened, and applied only by "Choose this split". */
function SplitPreviews({ candidates, vms, tiers, managementVms, placementInputs, onChooseSplit }: SplitProps) {
  const previews = useMemo(() => candidates.map((option) => ({
    option,
    plan: planMultipleClusters(option.cfg, vms, tiers, { ...placementInputs, clusterLayout: 'split', maxNodesPerCluster: Math.min(placementInputs.maxNodesPerCluster, option.result.clusterNodeLimit) }, managementVms),
  })), [candidates, vms, tiers, managementVms, placementInputs])
  return (
    <table>
      <thead><tr><th>Storage</th><th>Server</th><th>Drives per node</th><th className="num">One cluster needs</th><th className="num">Clusters</th><th className="num">Total nodes</th><th>Split result</th><th /></tr></thead>
      <tbody>
        {previews.map(({ option, plan }) => (
          <tr key={option.id}>
            <td><strong>{option.storageLabel}</strong></td>
            <td>{option.server.label}</td>
            <td>{option.drives?.label ?? '—'}</td>
            <td className="num">{option.nodes === null ? '—' : fmt0(option.nodes)} (limit {option.result.clusterNodeLimit})</td>
            <td className="num">{plan.feasible ? plan.clusters.length : '—'}</td>
            <td className="num">{plan.feasible ? fmt0(plan.totalNodes) : '—'}</td>
            <td>{plan.feasible ? <span className="pill ok">places the workload</span> : <span className="pill err">{plan.warnings[0] ?? 'does not place the workload'}</span>}</td>
            <td>{plan.feasible && <button className="btn ghost compact" type="button" onClick={() => onChooseSplit(option)}>Choose this split</button>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The separate, clearly labelled split view. Nothing here is applied without a click. */
export function SplitOptionsPanel(props: SplitProps) {
  const [opened, setOpened] = useState(false)
  return (
    <div className="panel">
      <details onToggle={(event) => setOpened((event.target as HTMLDetailsElement).open)}>
        <summary><strong>If you choose to split</strong> · {props.candidates.length} option{props.candidates.length === 1 ? '' : 's'} that need more nodes than one cluster allows</summary>
        <p className="small muted">
          One cluster is the default and Surveyor never splits on its own. These options only fail the one-cluster node limit.
          Splitting adds spare nodes in every cluster and more to operate. Nothing changes unless you click Choose this split.
          Cluster ceiling and grouping use your settings under Cluster layout below.
        </p>
        {opened && (props.candidates.length
          ? <SplitPreviews {...props} />
          : <div className="note">No option is held back only by the node limit.</div>)}
      </details>
    </div>
  )
}
