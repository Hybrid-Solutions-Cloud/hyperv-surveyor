import { useMemo } from 'react'
import { Activity, Boxes, Network, ShieldCheck } from 'lucide-react'
import { Field, NumberInput, PageHeader } from '../components/Shared'
import { clusterNodeLimitFor } from '../engine/deploymentPlanning'
import { assessMigrationReadiness } from '../engine/readiness'
import { designNetwork } from '../engine/networkDesign'
import { designDisasterRecovery } from '../engine/drDesign'
import { useSurveyorStore } from '../state/store'
import { JourneyBar } from '../components/JourneyBar'
import { usePlatformDesign } from '../state/usePlatformDesign'
import { ENGAGEMENT_LABELS } from '../state/journey'
import { WorkflowNav } from '../components/WorkflowNav'
import { advisorMatchSentence } from '../engine/managementAdvisor'

export default function DeploymentPage() {
  const store = useSurveyorStore()
  // One design for every page: placement, management, network and recovery all read it.
  const design = usePlatformDesign()
  const usesExistingHardware = design.path === 'existing'
  const managementOnly = design.path === 'management-only'
  const platformCfg = design.cfg
  const splitLayout = !usesExistingHardware && store.placementInputs.clusterLayout === 'split'
  const nodeLimit = clusterNodeLimitFor(platformCfg)
  const management = design.management
  const managementPlan = management.plan
  const embeddedManagementVms = management.countedVms
  const dedicatedManagement = management.dedicated
  const readiness = useMemo(() => assessMigrationReadiness(store.vms, platformCfg), [store.vms, platformCfg])
  const network = useMemo(() => design.network.nodes === null ? null : designNetwork(platformCfg, design.network.nodes, store.networkDesignInputs), [platformCfg, design.network.nodes, store.networkDesignInputs])
  const dr = useMemo(() => design.sizing ? designDisasterRecovery(store.vms, design.sizing, store.drDesignInputs) : null, [store.vms, design.sizing, store.drDesignInputs])
  const placementOk = design.feasible === true
  const setPlacement = (patch: Partial<typeof store.placementInputs>) => store.setPlacementInputs({ ...store.placementInputs, ...patch })
  const setNetwork = (patch: Partial<typeof store.networkDesignInputs>) => store.setNetworkDesignInputs({ ...store.networkDesignInputs, ...patch })
  const setDr = (patch: Partial<typeof store.drDesignInputs>) => store.setDrDesignInputs({ ...store.drDesignInputs, ...patch })

  return (
    <>
      <PageHeader
        eyebrow={`Implementation planning${store.engagementMode ? ` · ${ENGAGEMENT_LABELS[store.engagementMode]}` : ''}`}
        title="Implementation plan"
        description="Turn the selected sizing result into target clusters, migration readiness, host networking, and disaster-recovery requirements."
      />
      <JourneyBar detail="The implementation plan uses the hardware and workload model selected by the current planning path." />
      {managementOnly ? <div className="stack">
        <section className="panel">
          <h2>Management-only implementation</h2>
          <p className="muted">The management bill of materials is available without a workload design. Add a platform path later if host placement, network ports, workload fit, or disaster recovery must also be calculated.</p>
          {management.designed && <div className={`note ${management.source === 'starting-point' || management.advisor.matches === false ? 'warn' : ''}`}><strong>Management stack</strong>{advisorMatchSentence(management.source, management.advisor)}</div>}
          {management.warnings.map((warning) => <div className="note warn" key={warning}><strong>Missing input</strong>{warning}</div>)}
          {management.errors.map((error) => <div className="note err" key={error}><strong>Above a published limit</strong>{error}</div>)}
          {dedicatedManagement && <div className={`note ${dedicatedManagement.nodes !== null ? 'ok' : 'warn'}`}><strong>Dedicated management cluster</strong>{dedicatedManagement.nodes !== null ? `${dedicatedManagement.nodes} hosts are required for ${management.vms.length} management instances, including the failure reserve. ${dedicatedManagement.basis ?? ''}` : dedicatedManagement.reason}</div>}
          <div className="grid cards"><div className="card"><div className="k">Management instances</div><div className="v">{managementPlan.totalInstances}</div></div><div className="card"><div className="k">Management vCPU</div><div className="v">{managementPlan.totalVCpu}</div></div><div className="card"><div className="k">Management memory</div><div className="v">{managementPlan.totalRamGiB}<span style={{ fontSize: 15 }}> GiB</span></div></div><div className="card"><div className="k">Management disk</div><div className="v">{managementPlan.totalDiskGiB}<span style={{ fontSize: 15 }}> GiB</span></div></div>{dedicatedManagement && <div className="card"><div className="k">Dedicated management hosts</div><div className="v">{dedicatedManagement.nodes ?? '—'}</div></div>}</div>
        </section>
      </div> : store.vms.filter((vm) => vm.include).length === 0 ? <div className="panel"><h2>Add workloads first</h2><p className="muted">Import or enter workloads before building the implementation plan.</p></div> : <div className="stack">
        <section className="panel">
          <h2><Boxes size={18} /> Cluster placement</h2>
          {usesExistingHardware && <p className="small muted">Placement uses the {design.totalNodes} entered nodes of the existing estate. Adding or splitting clusters is not part of this path.</p>}
          {!usesExistingHardware && <div className="form-grid two-column">
            <Field label="Cluster layout" hint="Surveyor keeps one cluster unless you choose to split."><select value={store.placementInputs.clusterLayout} onChange={(event) => setPlacement({ clusterLayout: event.target.value as typeof store.placementInputs.clusterLayout })}><option value="single">One cluster</option><option value="split">Split into multiple clusters</option></select></Field>
            {splitLayout && <Field label="Maximum nodes / target cluster" hint={`Up to ${nodeLimit} for this storage type.`}><NumberInput value={Math.min(store.placementInputs.maxNodesPerCluster, nodeLimit)} min={2} max={nodeLimit} onChange={(value) => setPlacement({ maxNodesPerCluster: Math.round(value) })} /></Field>}
            {splitLayout && <Field label="Target VMs / cluster" hint="8,000 is the Hyper-V maximum, so it adds no extra limit."><NumberInput value={store.placementInputs.targetVmsPerCluster} min={1} max={8000} step={50} onChange={(value) => setPlacement({ targetVmsPerCluster: Math.round(value) })} /></Field>}
            {splitLayout && <Field label="Maximum target clusters"><NumberInput value={store.placementInputs.maxClusters} min={1} max={64} onChange={(value) => setPlacement({ maxClusters: Math.round(value) })} /></Field>}
            {splitLayout && platformCfg.sanSizingMode !== 'calculated' && (platformCfg.architecture === 'san' || platformCfg.architecture === 'hybrid') && <Field label="SAN capacity scope"><select value={store.placementInputs.sanCapacityScope} onChange={(event) => setPlacement({ sanCapacityScope: event.target.value as typeof store.placementInputs.sanCapacityScope })}><option value="shared">One shared array capacity pool</option><option value="per-cluster">Dedicated array capacity per cluster</option></select></Field>}
          </div>}
          {splitLayout && <div className="meter-toggles">
            <label><input type="checkbox" checked={store.placementInputs.preserveSourceClusters} onChange={(event) => setPlacement({ preserveSourceClusters: event.target.checked })} /> Keep each source cluster together</label>
            <label><input type="checkbox" checked={store.placementInputs.separateDatabaseTier} onChange={(event) => setPlacement({ separateDatabaseTier: event.target.checked })} /> Place database tier on dedicated clusters</label>
          </div>}
          <div className={`note ${placementOk ? 'ok' : 'err'}`}>
            <strong>{placementOk && !usesExistingHardware ? `${design.clusters.length} target cluster${design.clusters.length === 1 ? '' : 's'} · ${design.totalNodes} total nodes` : design.headline}</strong>
            {placementOk ? `${design.workloadNodes} nodes carry workload after ${usesExistingHardware ? 'the' : "each cluster's"} failure reserve.` : design.explanation}
          </div>
          <div className="scroll" style={{ maxHeight: 'none' }}>
            <table><thead><tr><th>Target cluster</th><th>Purpose</th><th className="num">Workload VMs</th><th className="num">Management VMs</th><th className="num">Nodes</th><th>Constraint</th><th>Source clusters</th><th>Confidence</th></tr></thead>
              <tbody>{design.clusters.map((cluster) => <tr key={cluster.id}><td><strong>{cluster.name}</strong></td><td>{cluster.purpose}</td><td className="num">{cluster.workloadVms.toLocaleString()}</td><td className="num">{cluster.managementVms || '—'}</td><td className="num">{cluster.feasible && cluster.nodes !== null ? cluster.nodes : cluster.nodesLabel}</td><td><span className={`pill ${cluster.feasible ? 'info' : 'err'}`}>{cluster.binding}</span></td><td>{cluster.sourceClusters.join(', ') || 'Mixed / not provided'}</td><td>{cluster.confidence}</td></tr>)}</tbody>
            </table>
          </div>
          {embeddedManagementVms.length > 0 && <div className="note ok"><strong>Management VMs placed with workloads</strong>{embeddedManagementVms.length} management instances are {usesExistingHardware ? 'counted on the entered hosts' : "kept together on the first non-database workload cluster and included in that cluster's node calculation"}. Host impact: {management.impactLabel.toLowerCase()}.</div>}
          {dedicatedManagement && <div className={`note ${dedicatedManagement.nodes !== null ? 'ok' : 'err'}`}><strong>Dedicated management cluster</strong>{dedicatedManagement.nodes !== null ? `${dedicatedManagement.nodes} nodes of the selected specification are required for ${management.vms.length} management instances, including the configured failure reserve.` : dedicatedManagement.reason}</div>}
          {management.designed && management.inputs.managementPlacement === 'external-fabric' && <div className="note"><strong>External management fabric</strong>The management BOM is retained, but its VMs and nodes are excluded from this platform placement plan.</div>}
          {(design.placement?.warnings ?? []).filter((warning) => !design.explanation.includes(warning)).map((warning) => <div className="note warn" key={warning}>{warning}</div>)}
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
          {!network && <div className="note warn"><strong>Host switch ports not calculated</strong>{design.network.reason}</div>}
          {network && <div className="grid cards"><div className="card"><div className="k">Host switch ports</div><div className="v">{network.totalHostPorts}</div><div className="s">for {design.network.nodes} nodes</div></div><div className="card"><div className="k">Aggregate / node</div><div className="v">{network.aggregateGbpsPerNode}<span style={{ fontSize: 15 }}> Gbps</span></div></div></div>}
          {network && <ul className="report-bullets">{network.intentSummary.map((intent) => <li key={intent}>{intent}</li>)}</ul>}
          {(network?.findings ?? []).map((finding) => <div className={`note ${finding.severity === 'error' ? 'err' : finding.severity === 'warning' ? 'warn' : ''}`} key={finding.message}>{finding.message}</div>)}
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
          {dr && <div className="grid cards"><div className="card"><div className="k">Protected VMs</div><div className="v">{dr.protectedVms}</div></div><div className="card"><div className="k">Protected storage</div><div className="v">{dr.protectedStorageTiB.toFixed(1)}<span style={{ fontSize: 15 }}> TiB</span></div></div><div className="card"><div className="k">Secondary storage</div><div className="v">{dr.secondaryStorageTiB.toFixed(1)}<span style={{ fontSize: 15 }}> TiB</span></div></div><div className="card"><div className="k">Estimated burst WAN</div><div className="v">{dr.estimatedBurstMbps.toFixed(0)}<span style={{ fontSize: 15 }}> Mbps</span></div><div className="s">{dr.bandwidthPasses ? 'within entered capacity' : 'above entered capacity'}</div></div></div>}
          {(dr?.findings ?? []).map((finding) => <div className={`note ${finding.severity === 'error' ? 'err' : finding.severity === 'warning' ? 'warn' : ''}`} key={finding.message}>{finding.message}</div>)}
        </section>
      </div>}
      <WorkflowNav
        previous={{ to: '/management-plane', label: 'Management Plane Advisor' }}
        next={[{ to: '/report', label: 'Solution report', description: 'Review, select, and export the complete solution record.' }]}
      />
    </>
  )
}
