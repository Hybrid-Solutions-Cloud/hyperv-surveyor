import { Activity, Boxes, Network, ShieldCheck } from 'lucide-react'
import { Field, NumberInput, PageHeader } from '../components/Shared'
import { clusterNodeLimitFor } from '../engine/deploymentPlanning'
import { RDMA_RECOMMENDATION_NOTE, type IntentType, type NetworkIntent, type SanConnectivityInputs, type SanProtocol } from '../engine/networkDesign'
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
  // Readiness, network and recovery come from the resolved design, the same figures the report and workbook show.
  const { readiness, network, recovery: dr, networkInputs: netInputs, recoveryInputs: drInputs } = design.implementation
  const usesSan = platformCfg.architecture === 'san' || platformCfg.architecture === 'hybrid'
  const placementOk = design.feasible === true
  const setPlacement = (patch: Partial<typeof store.placementInputs>) => store.setPlacementInputs({ ...store.placementInputs, ...patch })
  const setNetwork = (patch: Partial<typeof store.networkDesignInputs>) => store.setNetworkDesignInputs({ ...netInputs, ...patch })
  const setIntent = (index: number, patch: Partial<NetworkIntent>) => setNetwork({ intents: netInputs.intents.map((intent, other) => other === index ? { ...intent, ...patch } : intent) })
  const setSan = (patch: Partial<SanConnectivityInputs>) => setNetwork({ san: { ...netInputs.san, ...patch } })
  const setDr = (patch: Partial<typeof store.drDesignInputs>) => store.setDrDesignInputs({ ...drInputs, ...patch })

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
          {usesExistingHardware && <p className="small muted">{design.status === 'no-hardware' ? 'Enter your hardware on the capacity page first.' : `Placement uses your ${design.totalNodes} entered hosts${design.clusters.length > 1 ? ` in ${design.clusters.length} clusters, as you entered them. ${design.existing?.placement.rule ?? ''}` : '. Adding or splitting clusters is not part of this path.'}`}</p>}
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
          {readiness && <>
            <div className="grid cards">
              <div className="card"><div className="k">Ready</div><div className="v">{readiness.ready.toLocaleString()}</div><div className="s">no exception in your data</div></div>
              <div className="card"><div className="k">Review</div><div className="v">{readiness.review.toLocaleString()}</div></div>
              <div className="card"><div className="k">Blocked</div><div className="v">{readiness.blocked.toLocaleString()}</div></div>
              <div className="card"><div className="k">Assessed</div><div className="v">{readiness.assessed.toLocaleString()}</div></div>
            </div>
            <div className={`note ${readiness.notChecked.length > 0 ? 'warn' : ''}`}><strong>What Ready means here</strong>{readiness.readyMeaning}</div>
            <div className="scroll" style={{ maxHeight: 480 }}>
              <table><thead><tr><th>VM</th><th>Status</th><th>Category</th><th>Finding</th><th>Required action</th></tr></thead>
                <tbody>{readiness.findings.map((finding, index) => <tr key={`${finding.vmId}-${finding.category}-${index}`}><td><strong>{finding.vmName}</strong></td><td><span className={`pill ${finding.status === 'blocked' ? 'err' : finding.status === 'review' ? 'warn' : 'info'}`}>{finding.status}</span></td><td>{finding.category}</td><td>{finding.finding}{finding.source && <> <a href={finding.source} target="_blank" rel="noreferrer">Source</a></>}</td><td>{finding.action}</td></tr>)}</tbody>
              </table>
            </div>
            {readiness.findings.length === 0 && <div className="note ok"><strong>No readiness exceptions found in your data</strong>This does not replace application-owner validation or failover-cluster validation.</div>}
          </>}
        </section>

        <section className="panel">
          <h2><Network size={18} /> Host network design</h2>
          <p className="small muted">Map your adapters to Network ATC intents. Each adapter belongs to one intent; one intent may carry management, one may carry storage, and compute can be on several.</p>
          <div className="scroll" style={{ maxHeight: 'none' }}>
            <table><thead><tr><th>Intent</th><th>Management</th><th>Compute</th><th>Storage</th><th className="num">Adapters / host</th><th className="num">Speed (Gbps)</th><th /></tr></thead>
              <tbody>{netInputs.intents.map((intent, index) => <tr key={intent.id}>
                <td><input aria-label="Intent name" value={intent.name} onChange={(event) => setIntent(index, { name: event.target.value })} /></td>
                {(['management', 'compute', 'storage'] as IntentType[]).map((type) => <td key={type}><input type="checkbox" aria-label={`${intent.name} carries ${type}`} checked={intent.types.includes(type)} onChange={(event) => setIntent(index, { types: event.target.checked ? [...intent.types, type] : intent.types.filter((item) => item !== type) })} /></td>)}
                <td className="num"><NumberInput value={intent.adapters} min={0} max={16} onChange={(value) => setIntent(index, { adapters: Math.round(value) })} /></td>
                <td className="num"><NumberInput value={intent.speedGbps} min={1} max={800} onChange={(value) => setIntent(index, { speedGbps: value })} /></td>
                <td><button className="btn" type="button" disabled={netInputs.intents.length <= 1} onClick={() => setNetwork({ intents: netInputs.intents.filter((_, other) => other !== index) })}>Remove</button></td>
              </tr>)}</tbody>
            </table>
          </div>
          <button className="btn" type="button" onClick={() => setNetwork({ intents: [...netInputs.intents, { id: `intent-${Date.now()}`, name: 'Compute', types: ['compute'], adapters: 2, speedGbps: 25 }] })}>Add an intent</button>
          <div className="form-grid two-column">
            <Field label="BMC ports / host" hint="Out-of-band management, on its own network."><NumberInput value={netInputs.bmcPortsPerNode} min={0} max={4} onChange={(value) => setNetwork({ bmcPortsPerNode: Math.round(value) })} /></Field>
            <Field label="RDMA protocol" hint="Microsoft lists iWARP as recommended for 4 or more S2D nodes; RoCE needs DCB."><select value={netInputs.rdmaProtocol} onChange={(event) => setNetwork({ rdmaProtocol: event.target.value as typeof netInputs.rdmaProtocol })}><option value="iwarp">iWARP</option><option value="roce-v2">RoCE v2</option><option value="none">None / TCP</option></select></Field>
            <p className="small muted" style={{ alignSelf: 'end' }}>{RDMA_RECOMMENDATION_NOTE.text} <a href={RDMA_RECOMMENDATION_NOTE.source} target="_blank" rel="noreferrer">Source</a></p>
            <Field label="Live migration networks"><NumberInput value={netInputs.liveMigrationNetworks} min={1} max={8} onChange={(value) => setNetwork({ liveMigrationNetworks: Math.round(value) })} /></Field>
            <Field label="Management VLAN" hint="1 to 4094."><input value={netInputs.managementVlan} onChange={(event) => setNetwork({ managementVlan: event.target.value })} /></Field>
            <Field label="Compute VLANs" hint="A list or range, such as 100-199."><input value={netInputs.computeVlans} onChange={(event) => setNetwork({ computeVlans: event.target.value })} /></Field>
            <Field label="Live migration VLAN"><input value={netInputs.liveMigrationVlan} onChange={(event) => setNetwork({ liveMigrationVlan: event.target.value })} /></Field>
            <Field label="Storage VLANs" hint="RoCE needs a nonzero VLAN. Network ATC defaults to 711, 712."><input value={netInputs.storageVlans} onChange={(event) => setNetwork({ storageVlans: event.target.value })} /></Field>
          </div>
          <div className="meter-toggles">
            <label><input type="checkbox" checked={netInputs.dataCenterBridging} onChange={(event) => setNetwork({ dataCenterBridging: event.target.checked })} /> Data Center Bridging configured</label>
            <label><input type="checkbox" checked={netInputs.separateStorageFabric} onChange={(event) => setNetwork({ separateStorageFabric: event.target.checked })} /> Isolate S2D and SAN traffic</label>
            <label><input type="checkbox" checked={netInputs.switchRedundancy} onChange={(event) => setNetwork({ switchRedundancy: event.target.checked })} /> Redundant switches</label>
          </div>
          {usesSan && <>
            <h3>SAN connectivity</h3>
            <div className="form-grid two-column">
              <Field label="Protocol"><select value={netInputs.san.protocol} onChange={(event) => setSan({ protocol: event.target.value as SanProtocol })}><option value="fc">Fibre Channel</option><option value="iscsi">iSCSI</option><option value="other">Other</option><option value="none">None</option></select></Field>
              <Field label={netInputs.san.protocol === 'iscsi' ? 'iSCSI adapters / host' : 'HBAs / host'}><NumberInput value={netInputs.san.adaptersPerHost} min={0} max={16} onChange={(value) => setSan({ adaptersPerHost: Math.round(value) })} /></Field>
              <Field label="Ports / adapter"><NumberInput value={netInputs.san.portsPerAdapter} min={1} max={8} onChange={(value) => setSan({ portsPerAdapter: Math.round(value) })} /></Field>
              <Field label="Adapter speed (Gbps)"><NumberInput value={netInputs.san.speedGbps} min={1} max={800} onChange={(value) => setSan({ speedGbps: value })} /></Field>
              <Field label="Paths / LUN"><NumberInput value={netInputs.san.pathsPerLun} min={1} max={64} onChange={(value) => setSan({ pathsPerLun: Math.round(value) })} /></Field>
              <Field label="Fabrics" hint="Two separate fabrics (A and B) avoid a single fabric failure."><NumberInput value={netInputs.san.fabrics} min={1} max={4} onChange={(value) => setSan({ fabrics: Math.round(value) })} /></Field>
              <Field label="Array ports / fabric"><NumberInput value={netInputs.san.arrayPortsPerFabric} min={1} max={64} onChange={(value) => setSan({ arrayPortsPerFabric: Math.round(value) })} /></Field>
              <Field label="Fabric ports you have" hint="All fabrics together. 0 means not entered."><NumberInput value={netInputs.san.fabricPortsAvailable} min={0} max={100000} onChange={(value) => setSan({ fabricPortsAvailable: Math.round(value) })} /></Field>
            </div>
            <div className="meter-toggles">
              <label><input type="checkbox" checked={netInputs.san.mpio} onChange={(event) => setSan({ mpio: event.target.checked })} /> MPIO on every node</label>
              {netInputs.san.protocol === 'iscsi' && <label><input type="checkbox" checked={netInputs.san.dedicatedIscsi} onChange={(event) => setSan({ dedicatedIscsi: event.target.checked })} /> iSCSI adapters carry no other traffic</label>}
            </div>
          </>}
          {!network && <div className="note warn"><strong>Host switch ports not calculated</strong>{design.network.reason}</div>}
          {network && <div className="grid cards">
            <div className="card"><div className="k">Host switch ports</div><div className="v">{network.totalHostPorts}</div><div className="s">{network.hostPortsPerNode} per host × {design.network.nodes} hosts</div></div>
            <div className="card"><div className="k">BMC ports</div><div className="v">{network.bmcPorts}</div></div>
            <div className="card"><div className="k">Aggregate / host</div><div className="v">{network.aggregateGbpsPerNode}<span style={{ fontSize: 15 }}> Gbps</span></div></div>
            {network.san && <div className="card"><div className="k">SAN fabric ports</div><div className="v">{network.san.fabricPortsNeeded}</div><div className="s">{network.san.totalHostPorts} host, {network.san.arrayPorts} array; up to {network.san.maxPathsPerLun} paths per LUN</div></div>}
            {network.traffic && <div className="card"><div className="k">Network P95, all VMs</div><div className="v">{Math.round(network.traffic.totalP95Mbps).toLocaleString()}<span style={{ fontSize: 15 }}> Mbps</span></div><div className="s">of {Math.round(network.traffic.computeMbps).toLocaleString()} Mbps compute; {network.traffic.measuredVms} VMs measured</div></div>}
          </div>}
          {network && <ul className="report-bullets">{network.intentSummary.map((intent) => <li key={intent}>{intent}</li>)}</ul>}
          {(network?.findings ?? []).map((finding) => <div className={`note ${finding.severity === 'error' ? 'err' : finding.severity === 'warning' ? 'warn' : ''}`} key={finding.message}>{finding.message}{finding.source && <> <a href={finding.source} target="_blank" rel="noreferrer">Source</a></>}</div>)}
        </section>

        <section className="panel">
          <h2><ShieldCheck size={18} /> Backup and disaster recovery</h2>
          <div className="form-grid two-column">
            <Field label="Recovery strategy"><select value={drInputs.strategy} onChange={(event) => setDr({ strategy: event.target.value as typeof drInputs.strategy })}><option value="hyper-v-replica">Hyper-V Replica</option><option value="azure-site-recovery">Azure Site Recovery</option><option value="storage-replication">Storage / array replication</option><option value="backup-only">Backup restore only</option><option value="none">Not selected</option></select></Field>
            <Field label="RPO (minutes)"><NumberInput value={drInputs.rpoMinutes} min={0} max={10080} step={0.5} onChange={(value) => setDr({ rpoMinutes: value })} /></Field>
            <Field label="RTO (hours)"><NumberInput value={drInputs.rtoHours} min={0} max={720} step={0.25} onChange={(value) => setDr({ rtoHours: value })} /></Field>
            {drInputs.strategy !== 'none' && <>
              <Field label="Protected workloads %"><NumberInput value={drInputs.protectedWorkloadPct} min={0} max={100} onChange={(value) => setDr({ protectedWorkloadPct: value })} /></Field>
              {drInputs.strategy === 'backup-only' ? <>
                <Field label="Hours between backups"><NumberInput value={drInputs.backupIntervalHours} min={0} max={720} onChange={(value) => setDr({ backupIntervalHours: value })} /></Field>
                <Field label="Restore throughput (MB/s)" hint="Measure your backup system's sustained restore rate."><NumberInput value={drInputs.restoreThroughputMBps} min={0} max={100000} onChange={(value) => setDr({ restoreThroughputMBps: value })} /></Field>
              </> : <>
                <Field label="Failover time (hours)" hint="Your estimate, from the decision to VMs running at the secondary."><NumberInput value={drInputs.failoverHours} min={0} max={168} step={0.25} onChange={(value) => setDr({ failoverHours: value })} /></Field>
                <Field label="Daily changed data %"><NumberInput value={drInputs.dailyChangeRatePct} min={0} max={100} step={0.1} onChange={(value) => setDr({ dailyChangeRatePct: value })} /></Field>
                <Field label="Replication burst factor"><NumberInput value={drInputs.burstFactor} min={1} max={10} step={0.25} onChange={(value) => setDr({ burstFactor: value })} /></Field>
                <Field label="Available WAN (Mbps)"><NumberInput value={drInputs.availableWanMbps} min={0} max={1000000} onChange={(value) => setDr({ availableWanMbps: value })} /></Field>
                <Field label="Initial copy"><select value={drInputs.seedingMethod} onChange={(event) => setDr({ seedingMethod: event.target.value as typeof drInputs.seedingMethod })}><option value="network">Over the network</option><option value="offline-media">External media or an existing copy</option></select></Field>
              </>}
              <Field label="Secondary capacity %"><NumberInput value={drInputs.secondaryCapacityPct} min={0} max={300} onChange={(value) => setDr({ secondaryCapacityPct: value })} /></Field>
              <Field label="Recovery test every N months"><NumberInput value={drInputs.testFrequencyMonths} min={1} max={36} onChange={(value) => setDr({ testFrequencyMonths: Math.round(value) })} /></Field>
            </>}
          </div>
          {drInputs.strategy !== 'none' && <div className="meter-toggles"><label><input type="checkbox" checked={drInputs.immutableCopy} onChange={(event) => setDr({ immutableCopy: event.target.checked })} /> Immutable/offline recovery copy</label><label><input type="checkbox" checked={drInputs.applicationConsistent} onChange={(event) => setDr({ applicationConsistent: event.target.checked })} /> Application-consistent recovery</label></div>}
          {dr && drInputs.strategy !== 'none' && <div className="grid cards">
            <div className="card"><div className="k">Protected VMs</div><div className="v">{dr.protectedVms}</div></div>
            <div className="card"><div className="k">Protected storage</div><div className="v">{dr.protectedStorageTiB.toFixed(1)}<span style={{ fontSize: 15 }}> TiB</span></div></div>
            <div className="card"><div className="k">Secondary storage</div><div className="v">{dr.secondaryStorageTiB.toFixed(1)}<span style={{ fontSize: 15 }}> TiB</span></div></div>
            {dr.estimatedBurstMbps !== null && <div className="card"><div className="k">Estimated burst WAN</div><div className="v">{dr.estimatedBurstMbps.toFixed(0)}<span style={{ fontSize: 15 }}> Mbps</span></div><div className="s">{dr.bandwidthPasses === false ? 'above your WAN' : 'within your WAN'}</div></div>}
            {dr.estimatedRecoveryHours !== null && <div className="card"><div className="k">Recovery estimate</div><div className="v">{dr.estimatedRecoveryHours.toFixed(1)}<span style={{ fontSize: 15 }}> h</span></div><div className="s">{dr.rtoPasses ? 'meets your RTO' : 'misses your RTO'}</div></div>}
            {dr.seedingDays !== null && <div className="card"><div className="k">Initial copy</div><div className="v">{dr.seedingDays.toFixed(1)}<span style={{ fontSize: 15 }}> days</span></div></div>}
            {dr.secondaryHosts !== null && <div className="card"><div className="k">Secondary hosts</div><div className="v">{dr.secondaryHosts}</div><div className="s">before a failure reserve</div></div>}
          </div>}
          {dr && dr.assumptions.length > 0 && <div className="note"><strong>Assumptions</strong><ul className="report-bullets">{dr.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {dr && dr.asrBlockers.length > 0 && <div className="scroll" style={{ maxHeight: 320 }}><table><thead><tr><th>VM</th><th>Azure Site Recovery blocker</th></tr></thead><tbody>{dr.asrBlockers.map((item, index) => <tr key={`${item.vmName}-${index}`}><td>{item.vmName}</td><td>{item.reason}</td></tr>)}</tbody></table></div>}
          {(dr?.findings ?? []).map((finding) => <div className={`note ${finding.severity === 'error' ? 'err' : finding.severity === 'warning' ? 'warn' : ''}`} key={finding.message}>{finding.message}{finding.source && <> <a href={finding.source} target="_blank" rel="noreferrer">Source</a></>}</div>)}
        </section>
      </div>}
      <WorkflowNav
        previous={{ to: '/management-plane', label: 'Management Plane Advisor' }}
        next={[{ to: '/report', label: 'Solution report', description: 'Review, select, and export the complete solution record.' }]}
      />
    </>
  )
}
