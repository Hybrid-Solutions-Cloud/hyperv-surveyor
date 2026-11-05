import { Link } from 'react-router-dom'
import { exportDesign } from '../io/exportXlsx'
import { usePlatformDesign } from '../state/usePlatformDesign'
import { ResultsPanel } from '../components/ResultsPanel'
import { ManagementCheckpoint } from '../components/ManagementCheckpoint'
import { NewPlatformHeader, NewPlatformNav } from '../components/NewPlatformStep'
import { useSurveyorStore } from '../state/store'

export default function WhatToBuyPage() {
  const { vms, tiers, sharedInventoryOmitted } = useSurveyorStore()
  const design = usePlatformDesign({ engagementMode: 'new-platform' })
  const bom = design.bom
  const blocked = sharedInventoryOmitted !== null && vms.length === 0
  const hasWorkloads = vms.some((vm) => vm.include)

  return (
    <>
      <NewPlatformHeader
        route="/what-to-buy"
        description="A class-level bill of materials for the option you selected: servers, drives, network adapters, switch ports and SAN capacity. It names component classes, not products."
      />
      {!blocked && hasWorkloads && (
        <div className="stack">
          <div className="panel">
            <h2>{bom.title}</h2>
            {!bom.available ? (
              <div className="note warn">
                <strong>No bill of materials yet</strong>
                {bom.reason}
                <div style={{ marginTop: 8 }}><Link className="btn link-btn" to="/shortlist">Open the shortlist</Link></div>
              </div>
            ) : (
              <>
                <div className="note warn"><strong>Recommended starting points: validate with your vendor and the Windows Server Catalog</strong>{bom.caveats.join(' ')}</div>
                <div className="scroll" style={{ maxHeight: 'none' }}>
                  <table>
                    <thead><tr><th>Category</th><th>Item</th><th>Quantity</th><th>Detail</th><th>Basis</th></tr></thead>
                    <tbody>
                      {bom.lines.map((line) => (
                        <tr key={`${line.category}-${line.item}`}>
                          <td>{line.category}</td>
                          <td><strong>{line.item}</strong></td>
                          <td className="nowrap">{line.quantity}</td>
                          <td className="small">{line.detail}{line.source && <> <a href={line.source} target="_blank" rel="noreferrer">Source</a></>}</td>
                          <td><span className={`pill ${line.basis === 'TOOL' ? 'warn' : 'info'}`}>{line.basis}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {bom.sanConnectivity.required && (
                  <div className={`note ${bom.sanConnectivity.status === 'planned' ? '' : 'warn'}`}><strong>SAN connectivity{bom.sanConnectivity.status === 'planned' ? ' from your Implementation plan' : ': not chosen'}</strong>{bom.sanConnectivity.note} Change it on the Implementation plan page.</div>
                )}
              </>
            )}
          </div>
          <ResultsPanel design={design} tiers={tiers} onExport={() => exportDesign(design, vms, useSurveyorStore.getState().costModel)} />
          <ManagementCheckpoint context="new-platform" />
        </div>
      )}
      {!blocked && !hasWorkloads && <div className="panel"><p className="muted">Add workloads first. <Link to="/workloads">Import an inventory</Link>.</p></div>}
      {blocked && <div className="note err"><strong>This shared link omitted its workload records</strong>Open the sender&apos;s project file from Project &amp; scenarios.</div>}
      <NewPlatformNav route="/what-to-buy" nextDescription="Advanced settings: host reserves, vCPU ratios, CSV layout, your own server and drives. Changes re-run the options." />
    </>
  )
}
