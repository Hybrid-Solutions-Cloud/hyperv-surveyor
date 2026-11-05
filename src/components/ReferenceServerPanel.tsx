import { useMemo } from 'react'
import { compareReferenceServers, type ArchitectureOption } from '../engine/solve'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'
import { fmt0 } from './Shared'

interface Props {
  option: ArchitectureOption
  vms: Vm[]
  tiers: Record<TierId, TierPolicy>
  cfg: ClusterConfig
  setCfg: (cfg: ClusterConfig) => void
}

/** Compares server sizes for the selected storage option. Only the user's click changes the design. */
export function ReferenceServerPanel({ option, vms, tiers, cfg, setCfg }: Props) {
  const servers = useMemo(() => compareReferenceServers(option.cfg, vms, tiers), [option.cfg, vms, tiers])
  return (
    <div className="panel">
      <h2>Reference server comparison: {option.label}</h2>
      <p className="small muted" style={{ marginTop: -6 }}>
        You do not need to know your hardware yet. These are example sizes showing how server size changes the node count.
        Surveyor will not switch servers for you, so pick one or enter your own under Hardware and assumptions.
      </p>
      <div className="scroll" style={{ maxHeight: 'none' }}>
        <table>
          <thead>
            <tr><th>Server</th><th className="num">Cores</th><th className="num">RAM GiB</th><th className="num">Nodes needed</th><th>One cluster</th><th className="num">Licensable cores</th><th /></tr>
          </thead>
          <tbody>
            {servers.map((server) => {
              const r = server.result
              const licensable = r.nodesNeeded === null ? null : r.licensableCoresPerNode * r.nodesNeeded
              return (
                <tr key={server.key} className={server.selected ? 'chosen' : ''}>
                  <td><strong>{server.label}</strong><div className="small muted">{server.sockets} × {server.coresPerSocket} cores</div></td>
                  <td className="num">{fmt0(server.sockets * server.coresPerSocket)}</td>
                  <td className="num">{fmt0(server.ramGiB)}</td>
                  <td className="num"><strong>{r.nodesNeeded === null ? '—' : fmt0(r.nodesNeeded)}</strong></td>
                  <td>{r.feasible ? <span className="pill ok">fits</span> : <span className="pill err">{r.nodesNeeded !== null && r.nodesNeeded > r.clusterNodeLimit ? `over ${r.clusterNodeLimit}-node limit` : 'blocked'}</span>}</td>
                  <td className="num">{licensable === null ? '—' : fmt0(licensable)}</td>
                  <td>
                    {server.selected
                      ? <span className="small muted">In use</span>
                      : <button className="btn ghost compact" type="button" onClick={() => setCfg({ ...cfg, node: { ...cfg.node, sockets: server.sockets, coresPerSocket: server.coresPerSocket, ramGiB: server.ramGiB } })}>Use this size</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>Drive settings stay the same across sizes, so S2D results also depend on the drive counts you entered.</p>
    </div>
  )
}
