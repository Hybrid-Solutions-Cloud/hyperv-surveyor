import { useMemo } from 'react'
import { Activity, Boxes, Network, ShieldCheck } from 'lucide-react'
import { Field, NumberInput, PageHeader } from '../components/Shared'
import { compareArchitectures } from '../engine/solve'
import { planMultipleClusters } from '../engine/deploymentPlanning'
import { assessMigrationReadiness } from '../engine/readiness'
import { designNetwork } from '../engine/networkDesign'
import { designDisasterRecovery } from '../engine/drDesign'
import { useSurveyorStore } from '../state/store'

export default function DeploymentPage() {
  const store = useSurveyorStore()
  const options = useMemo(() => compareArchitectures(store.cfg, store.vms, store.tiers), [store.cfg, store.vms, store.tiers])
  const chosen = options.find((option) => option.key === store.chosenKey) ?? options[0]
  const readiness = useMemo(() => assessMigrationReadiness(store.vms, chosen.cfg), [store.vms, chosen.cfg])
  const clusters = useMemo(() => planMultipleClusters(chosen.cfg, store.vms, store.tiers, store.placementInputs), [chosen.cfg, store.vms, store.tiers, store.placementInputs])
  const network = useMemo(() => designNetwork(chosen.cfg, clusters.totalNodes, store.networkDesignInputs), [chosen.cfg, clusters.totalNodes, store.networkDesignInputs])
  const dr = useMemo(() => designDisasterRecovery(store.vms, chosen.result, store.drDesignInputs), [store.vms, chosen.result, store.drDesignInputs])
  const setPlacement = (patch: Partial<typeof store.placementInputs>) => store.setPlacementInputs({ ...store.placementInputs, ...patch })
  const setNetwork = (patch: Partial<typeof store.networkDesignInputs>) => store.setNetworkDesignInputs({ ...store.networkDesignInputs, ...patch })
  const setDr = (patch: Partial<typeof store.drDesignInputs>) => store.setDrDesignInputs({ ...store.drDesignInputs, ...patch })

  return (
    <>
      <PageHeader
        eyebrow="Step 5"
        title="Implementation plan"
        description="Turn the selected sizing result into target clusters, migration readiness, host networking, and disaster-recovery requirements."
      />
      {store.vms.filter((vm) => vm.include).length === 0 ? <div className="panel"><h2>Add workloads first</h2><p className="muted">Import or enter workloads before building the implementation plan.</p></div> : <div className="stack">
        <section className="panel">
          <h2><Boxes size={18} /> Multi-cluster placement</h2>
          <div className="form-grid two-column">
            <Field label="Maximum nodes / target cluster"><NumberInput value={store.placementInputs.maxNodesPerCluster} min={2} max={64} onChange={(value) => setPlacement({ maxNodesPerCluster: Math.round(value) })} /></Field>
            <Field label="Target VMs / cluster"><NumberInput value={store.placementInputs.targetVmsPerCluster} min={1} max={8000} step={50} onChange={(value) => setPlacement({ targetVmsPerCluster: Math.round(value) })} /></Field>
            <Field label="Maximum target clusters"><NumberInput value={store.placementInputs.maxClusters} min={1} max={64} onChange={(value) => setPlacement({ maxClusters: Math.round(value) })} /></Field>
            {(chosen.cfg.architecture === 'san' || chosen.cfg.architecture === 'hybrid') && <Field label="SAN capacity scope"><select value={store.placementInputs.sanCapacityScope} onChange={(event) => setPlacement({ sanCapacityScope: event.target.value as typeof store.placementInputs.sanCapacityScope })}><option value="shared">One shared array capacity pool</option><option value="per-cluster">Dedicated array capacity per cluster</option></select></Field>}
          </div>
          <div className="meter-toggles">
            <label><input type="checkbox" checked={store.placementInputs.preserveSourceClusters} onChange={(event) => setPlacement({ preserveSourceClusters: event.target.checked })} /> Keep each source cluster together</label>
            <label><input type="checkbox" checked={store.placementInputs.separateDatabaseTier} onChange={(event) => setPlacement({ separateDatabaseTier: event.target.checked })} /> Place database tier on dedicated clusters</label>
          </div>
          <div className={`note ${clusters.feasible ? 'ok' : 'err'}`}>
            <strong>{clusters.feasible ? `${clusters.clusters.length} target cluster(s) · ${clusters.totalNodes} total nodes` : 'Placement needs revision'}</strong>
            {clusters.feasible ? `${clusters.totalWorkloadNodes} nodes carry workload after each cluster's failure reserve.` : clusters.warnings.join(' ')}
          </div>
          <div className="scroll" style={{ maxHeight: 'none' }}>
            <table><thead><tr><th>Target cluster</th><th>Purpose</th><th className="num">VMs</th><th className="num">Nodes</th><th>Constraint</th><th>Source clusters</th><th>Confidence</th></tr></thead>
              <tbody>{clusters.clusters.map((cluster) => <tr key={cluster.id}><td><strong>{cluster.name}</strong></td><td>{cluster.purpose}</td><td className="num">{cluster.vms.length.toLocaleString()}</td><td className="num">{cluster.result.feasible ? cluster.result.nodes : 'Review'}</td><td><span className={`pill ${cluster.result.feasible ? 'info' : 'err'}`}>{cluster.result.binding}</span></td><td>{cluster.sourceClusters.join(', ') || 'Mixed / not provided'}</td><td>{cluster.result.performanceAssessment.confidence.replace('-', ' ')} · {cluster.result.performanceAssessment.score}/100</td></tr>)}</tbody>
            </table>
          </div>
          {clusters.warnings.map((warning) => <div className="note warn" key={warning}>{warning}</div>)}
        </section>

        <section className="panel">
          <h2><Activity size={18} /> Migration readiness</h2>
          <div className="grid cards">
            <div className="card"><div className="k">Ready</div><div className="v">{readiness.ready.toLocaleString()}</div></div>
            <div className="card"><div className="k">Review</div><div className="v">{readiness.review.toLocaleString()}</div></div>
            <div className="card"><div className="k">Blocked</div><div className="v">{readiness.blocked.toLocaleString()}</div></div>
            <div className="card"><div className="k">Assessed</div><div className="v">{readiness.assessed.toLocaleString()}</div></div>
          </div>
          <div className="scroll" style={{ maxHeight: 480 }}>
            <table><thead><tr><th>VM</th><th>Status</th><th>Category</th><th>Finding</th><th>Required action</th></tr></thead>
              <tbody>{readiness.findings.map((finding, index) => <tr key={`${finding.vmId}-${finding.category}-${index}`}><td><strong>{finding.vmName}</strong></td><td><span className={`pill ${finding.status === 'blocked' ? 'err' : 'warn'}`}>{finding.status}</span></td><td>{finding.category}</td><td>{finding.finding}</td><td>{finding.action}</td></tr>)}</tbody>
            </table>
          </div>
          {readiness.findings.length === 0 && <div className="note ok"><strong>No readiness exceptions found from the available inventory fields</strong>This is not a substitute for application-owner validation or failover-cluster validation.</div>}
        </section>

        <section className="panel">
          <h2><Network size={18} /> Host network design</h2>
          <div className="form-grid two-column">
            <Field label="Physical adapters / node"><NumberInput value={store.networkDesignInputs.adaptersPerNode} min={1} max={16} onChange={(value) => setNetwork({ adaptersPerNode: Math.round(value) })} /></Field>
            <Field label="Adapter speed (Gbps)"><NumberInput value={store.networkDesignInputs.adapterSpeedGbps} min={1} max={400} onChange={(value) => setNetwork({ adapterSpeedGbps: value })} /></Field>
            <Field label="RDMA protocol"><select value={store.networkDesignInputs.rdmaProtocol} onChange={(event) => setNetwork({ rdmaProtocol: event.target.value as typeof store.networkDesignInputs.rdmaProtocol })}><option value="roce-v2">RoCE v2</option><option value="iwarp">iWARP</option><option value="none">None / TCP</option></select></Field>
            <Field label="Live migration networks"><NumberInput value={store.networkDesignInputs.liveMigrationNetworks} min={1} max={8} onChange={(value) => setNetwork({ liveMigrationNetworks: Math.round(value) })} /></Field>
            <Field label="Management VLAN"><input value={store.networkDesignInputs.managementVlan} onChange={(event) => setNetwork({ managementVlan: event.target.value })} /></Field>
            <Field label="Compute VLANs"><input value={store.networkDesignInputs.computeVlans} onChange={(event) => setNetwork({ computeVlans: event.target.value })} /></Field>
            <Field label="Live migration VLAN"><input value={store.networkDesignInputs.liveMigrationVlan} onChange={(event) => setNetwork({ liveMigrationVlan: event.target.value })} /></Field>
            <Field label="S2D storage VLANs"><input value={store.networkDesignInputs.storageVlans} onChange={(event) => setNetwork({ storageVlans: event.target.value })} /></Field>
          </div>
          <div className="meter-toggles">
            <label><input type="checkbox" checked={store.networkDesignInputs.dataCenterBridging} onChange={(event) => setNetwork({ dataCenterBridging: event.target.checked })} /> Data Center Bridging configured</label>
            <label><input type="checkbox" checked={store.networkDesignInputs.separateStorageFabric} onChange={(event) => setNetwork({ separateStorageFabric: event.target.checked })} /> Isolate S2D and SAN traffic</label>
            <label><input type="checkbox" checked={store.networkDesignInputs.switchRedundancy} onChange={(event) => setNetwork({ switchRedundancy: event.target.checked })} /> Redundant switches</label>
          </div>
          <div className="grid cards"><div className="card"><div className="k">Host switch ports</div><div className="v">{network.totalHostPorts}</div></div><div className="card"><div className="k">Aggregate / node</div><div className="v">{network.aggregateGbpsPerNode}<span style={{ fontSize: 15 }}> Gbps</span></div></div></div>
          <ul className="report-bullets">{network.intentSummary.map((intent) => <li key={intent}>{intent}</li>)}</ul>
          {network.findings.map((finding) => <div className={`note ${finding.severity === 'error' ? 'err' : finding.severity === 'warning' ? 'warn' : ''}`} key={finding.message}>{finding.message}</div>)}
        </section>

        <section className="panel">
          <h2><ShieldCheck size={18} /> Backup and disaster recovery</h2>
          <div className="form-grid two-column">
            <Field label="Recovery strategy"><select value={store.drDesignInputs.strategy} onChange={(event) => setDr({ strategy: event.target.value as typeof store.drDesignInputs.strategy })}><option value="hyper-v-replica">Hyper-V Replica</option><option value="azure-site-recovery">Azure Site Recovery</option><option value="storage-replication">Storage / array replication</option><option value="backup-only">Backup restore only</option><option value="none">Not selected</option></select></Field>
            <Field label="RPO (minutes)"><NumberInput value={store.drDesignInputs.rpoMinutes} min={0.5} max={1440} step={0.5} onChange={(value) => setDr({ rpoMinutes: value })} /></Field>
            <Field label="RTO (hours)"><NumberInput value={store.drDesignInputs.rtoHours} min={0.25} max={168} step={0.25} onChange={(value) => setDr({ rtoHours: value })} /></Field>
            <Field label="Protected workloads %"><NumberInput value={store.drDesignInputs.protectedWorkloadPct} min={0} max={100} onChange={(value) => setDr({ protectedWorkloadPct: value })} /></Field>
            <Field label="Daily changed data %"><NumberInput value={store.drDesignInputs.dailyChangeRatePct} min={0} max={100} step={0.1} onChange={(value) => setDr({ dailyChangeRatePct: value })} /></Field>
            <Field label="Replication burst factor"><NumberInput value={store.drDesignInputs.burstFactor} min={1} max={10} step={0.25} onChange={(value) => setDr({ burstFactor: value })} /></Field>
            <Field label="Available WAN Mbps"><NumberInput value={store.drDesignInputs.availableWanMbps} min={1} max={100000} onChange={(value) => setDr({ availableWanMbps: value })} /></Field>
            <Field label="Secondary capacity %"><NumberInput value={store.drDesignInputs.secondaryCapacityPct} min={0} max={300} onChange={(value) => setDr({ secondaryCapacityPct: value })} /></Field>
            <Field label="Recovery test every N months"><NumberInput value={store.drDesignInputs.testFrequencyMonths} min={1} max={36} onChange={(value) => setDr({ testFrequencyMonths: Math.round(value) })} /></Field>
          </div>
          <div className="meter-toggles"><label><input type="checkbox" checked={store.drDesignInputs.immutableCopy} onChange={(event) => setDr({ immutableCopy: event.target.checked })} /> Immutable/offline recovery copy</label><label><input type="checkbox" checked={store.drDesignInputs.applicationConsistent} onChange={(event) => setDr({ applicationConsistent: event.target.checked })} /> Application-consistent recovery</label></div>
          <div className="grid cards"><div className="card"><div className="k">Protected VMs</div><div className="v">{dr.protectedVms}</div></div><div className="card"><div className="k">Protected storage</div><div className="v">{dr.protectedStorageTiB.toFixed(1)}<span style={{ fontSize: 15 }}> TiB</span></div></div><div className="card"><div className="k">Secondary storage</div><div className="v">{dr.secondaryStorageTiB.toFixed(1)}<span style={{ fontSize: 15 }}> TiB</span></div></div><div className="card"><div className="k">Estimated burst WAN</div><div className="v">{dr.estimatedBurstMbps.toFixed(0)}<span style={{ fontSize: 15 }}> Mbps</span></div><div className="s">{dr.bandwidthPasses ? 'within entered capacity' : 'above entered capacity'}</div></div></div>
          {dr.findings.map((finding) => <div className={`note ${finding.severity === 'error' ? 'err' : finding.severity === 'warning' ? 'warn' : ''}`} key={finding.message}>{finding.message}</div>)}
        </section>
      </div>}
    </>
  )
}
