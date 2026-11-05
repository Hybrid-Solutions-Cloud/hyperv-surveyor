import { Plus, Trash2, Upload } from 'lucide-react'
import { RESILIENCY, TIER_IDS } from '../engine/rules'
import {
  blankCluster, blankHostGroup, clusterHostCount, hardwareEntered, SPARE_RULE, totalHostCount,
  type ExistingCluster, type ExistingHardware, type HostGroup,
} from '../engine/existingHardware'
import type { ClusterConfig, CpuVendor, HybridPlacement, Resiliency, SanSpec, SizingBasis, TierId, TierPolicy } from '../engine/types'
import type { HostRecord } from '../io/rvtools'
import { Field, NumberInput } from './Shared'

interface Props {
  hardware: ExistingHardware
  setHardware: (hardware: ExistingHardware) => void
  confirm: () => void
  importedHosts: HostRecord[]
  fillFromImport: () => boolean
  policy: ClusterConfig
  setPolicy: (cfg: ClusterConfig) => void
  tiers: Record<TierId, TierPolicy>
  setTiers: (tiers: Record<TierId, TierPolicy>) => void
  reset: () => void
  includedVms: number
}

const placementOf = (tier: TierPolicy): HybridPlacement => tier.hybridPlacement ?? (tier.storageTier === 'performance' ? 's2d' : 'san')

const VENDORS: Array<[CpuVendor, string]> = [['unknown', 'Not known'], ['intel', 'Intel'], ['amd', 'AMD']]

function SanFields({ san, onChange }: { san: SanSpec; onChange: (san: SanSpec) => void }) {
  const set = (patch: Partial<SanSpec>) => onChange({ ...san, ...patch })
  return (
    <>
      <Field label="Array usable capacity (TiB)" hint="Usable, not effective or provisioned.">
        <NumberInput value={san.usableTiB} min={0} step={0.1} onChange={(n) => set({ usableTiB: Math.max(0, n) })} />
      </Field>
      <Field label="Measured data reduction ratio" hint="Use 1.0 when you have no measured figure.">
        <NumberInput value={san.drr} min={1} step={0.1} onChange={(n) => set({ drr: Math.max(1, n) })} />
      </Field>
      <Field label="Sustainable array IOPS" hint="0 means not entered; performance is then not checked.">
        <NumberInput value={san.maxIops ?? 0} min={0} step={1000} onChange={(n) => set({ maxIops: Math.max(0, n) })} />
      </Field>
      <Field label="Sustainable array throughput (MB/s)" hint="0 means not entered.">
        <NumberInput value={san.maxThroughputMBps ?? 0} min={0} step={100} onChange={(n) => set({ maxThroughputMBps: Math.max(0, n) })} />
      </Field>
    </>
  )
}

export function ExistingHardwarePanel({ hardware, setHardware, confirm, importedHosts, fillFromImport, policy, setPolicy, tiers, setTiers, reset, includedVms }: Props) {
  const entered = hardwareEntered(hardware)
  const multi = hardware.clusters.length > 1
  const anySan = hardware.clusters.some((cluster) => cluster.architecture !== 's2d')
  const anyHybrid = hardware.clusters.some((cluster) => cluster.architecture === 'hybrid')
  const importedClusters = new Set(importedHosts.map((host) => host.cluster || 'Standalone hosts')).size
  const setCluster = (id: string, patch: Partial<ExistingCluster>) => setHardware({ ...hardware, clusters: hardware.clusters.map((cluster) => cluster.id === id ? { ...cluster, ...patch } : cluster) })
  const setGroup = (cluster: ExistingCluster, groupId: string, patch: Partial<HostGroup>) => setCluster(cluster.id, { hostGroups: cluster.hostGroups.map((group) => group.id === groupId ? { ...group, ...patch } : group) })
  const setPolicyField = (patch: Partial<ClusterConfig>) => setPolicy({ ...policy, ...patch })
  const setTier = (id: TierId, patch: Partial<TierPolicy>) => setTiers({ ...tiers, [id]: { ...tiers[id], ...patch } })
  const useImport = () => {
    if (entered && !window.confirm('Replace your host groups with the imported hosts? Storage and spare settings you entered are kept.')) return
    fillFromImport()
  }
  const splitTierUsed = TIER_IDS.some((id) => (placementOf(tiers[id])) === 'split')

  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-heading-row">
          <div>
            <h2>Your hardware</h2>
            <p className="small muted">Enter the hosts you already own. Nothing is filled in for you. These values are saved separately and do not change the new-platform assumptions.</p>
          </div>
          <button className="btn ghost compact" type="button" onClick={reset}>Clear hardware and assumptions</button>
        </div>

        {hardware.looksLikeOldDefaults && !hardware.confirmed && (
          <div className="note warn">
            <strong>These look like the old built-in defaults</strong>
            This project was saved when the form came pre-filled with 8 hosts of 2 × 48 cores, 1,536 GiB and a 500 TiB array. Your values equal those exactly. Confirm they are your hardware, or change them.
            <div style={{ marginTop: 8 }}><button className="btn compact" type="button" onClick={confirm}>These are my hosts</button></div>
          </div>
        )}

        {importedHosts.length > 0 && (
          <div className="note">
            <strong>Use my imported hosts</strong>
            Your import has {importedHosts.length.toLocaleString()} hosts in {importedClusters.toLocaleString()} cluster{importedClusters === 1 ? '' : 's'}. Surveyor groups hosts with the same sockets, cores, memory and CPU vendor (read from the CPU model) inside each cluster. You can edit every value afterwards.
            <div style={{ marginTop: 8 }}><button className="btn compact" type="button" onClick={useImport}><Upload size={14} /> Use my imported hosts</button></div>
          </div>
        )}

        <div className="capacity-input-section">
          <h3>Estate</h3>
          <div className="capacity-input-grid">
            <Field label="Target CPU vendor" hint="The vendor of the hosts your workloads move to. Live migration cannot cross Intel and AMD; this drives the migration-readiness check.">
              <select value={hardware.targetCpuVendor} onChange={(event) => setHardware({ ...hardware, targetCpuVendor: event.target.value as CpuVendor })}>
                {VENDORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            {anySan && multi && (
              <Field label="SAN" hint="Each cluster with its own array, or one array that every SAN-backed cluster shares.">
                <select value={hardware.sanScope} onChange={(event) => setHardware({ ...hardware, sanScope: event.target.value as ExistingHardware['sanScope'] })}>
                  <option value="per-cluster">Each cluster has its own array</option>
                  <option value="shared">One shared array</option>
                </select>
              </Field>
            )}
            <Field label="Hosts entered"><input readOnly value={`${totalHostCount(hardware).toLocaleString()} in ${hardware.clusters.length} cluster${hardware.clusters.length === 1 ? '' : 's'}`} /></Field>
          </div>
          {anySan && multi && hardware.sanScope === 'shared' && (
            <div className="capacity-input-grid" style={{ marginTop: 10 }}>
              <SanFields san={hardware.sharedSan} onChange={(sharedSan) => setHardware({ ...hardware, sharedSan })} />
            </div>
          )}
        </div>

        {hardware.clusters.map((cluster, clusterIndex) => {
          const usesS2d = cluster.architecture !== 'san'
          const usesSan = cluster.architecture !== 's2d'
          const hosts = clusterHostCount(cluster)
          return (
            <div className="capacity-input-section" key={cluster.id}>
              <div className="panel-heading-row">
                <h3>{multi ? `Cluster ${clusterIndex + 1}` : 'Cluster'}</h3>
                {multi && <button className="btn ghost compact" type="button" onClick={() => setHardware({ ...hardware, clusters: hardware.clusters.filter((item) => item.id !== cluster.id) })}><Trash2 size={14} /> Remove cluster</button>}
              </div>
              <div className="capacity-input-grid">
                <Field label="Cluster name" hint={multi ? 'VMs whose source cluster has this name are placed here.' : undefined}>
                  <input value={cluster.name} onChange={(event) => setCluster(cluster.id, { name: event.target.value })} />
                </Field>
                <Field label="Spare hosts" hint={SPARE_RULE}>
                  <NumberInput value={cluster.spareNodes} min={0} max={Math.max(0, hosts)} onChange={(n) => setCluster(cluster.id, { spareNodes: Math.max(0, Math.round(n)) })} />
                </Field>
                <Field label="Storage">
                  <select value={cluster.architecture} onChange={(event) => setCluster(cluster.id, { architecture: event.target.value as ExistingCluster['architecture'] })}>
                    <option value="san">SAN-backed cluster</option>
                    <option value="s2d">Storage Spaces Direct</option>
                    <option value="hybrid">S2D + SAN hybrid</option>
                  </select>
                </Field>
              </div>

              <div className="scroll" style={{ marginTop: 10 }}>
                <table>
                  <thead><tr><th className="num">Hosts</th><th className="num">Sockets</th><th className="num">Cores / socket</th><th className="num">RAM / host (GiB)</th><th>CPU vendor</th><th>CPU model</th><th /></tr></thead>
                  <tbody>
                    {cluster.hostGroups.map((group) => (
                      <tr key={group.id}>
                        <td><NumberInput value={group.count} min={0} onChange={(n) => setGroup(cluster, group.id, { count: Math.max(0, Math.round(n)) })} /></td>
                        <td><NumberInput value={group.sockets} min={0} max={8} onChange={(n) => setGroup(cluster, group.id, { sockets: Math.max(0, Math.round(n)) })} /></td>
                        <td><NumberInput value={group.coresPerSocket} min={0} onChange={(n) => setGroup(cluster, group.id, { coresPerSocket: Math.max(0, Math.round(n)) })} /></td>
                        <td><NumberInput value={group.ramGiB} min={0} step={16} onChange={(n) => setGroup(cluster, group.id, { ramGiB: Math.max(0, n) })} /></td>
                        <td>
                          <select value={group.cpuVendor} onChange={(event) => setGroup(cluster, group.id, { cpuVendor: event.target.value as CpuVendor })}>
                            {VENDORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </td>
                        <td className="small muted">{group.cpuModel ?? ''}</td>
                        <td>{cluster.hostGroups.length > 1 && <button className="btn ghost compact" type="button" aria-label="Remove host group" onClick={() => setCluster(cluster.id, { hostGroups: cluster.hostGroups.filter((item) => item.id !== group.id) })}><Trash2 size={14} /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn ghost compact" type="button" style={{ marginTop: 6 }} onClick={() => setCluster(cluster.id, { hostGroups: [...cluster.hostGroups, blankHostGroup()] })}><Plus size={14} /> Add a host group</button>
              <p className="small muted">A host group is a set of identical hosts. Add another group when some hosts differ.</p>

              {usesS2d && (
                <div className="capacity-input-grid" style={{ marginTop: 10 }}>
                  <Field label="S2D media">
                    <select value={cluster.s2d.media} onChange={(event) => setCluster(cluster.id, { s2d: { ...cluster.s2d, media: event.target.value as ExistingCluster['s2d']['media'] } })}>
                      <option value="all-flash">All-flash</option>
                      <option value="hybrid">Hybrid HDD + cache</option>
                    </select>
                  </Field>
                  <Field label="Capacity drives / host"><NumberInput value={cluster.s2d.capacityDrivesPerNode} min={0} onChange={(n) => setCluster(cluster.id, { s2d: { ...cluster.s2d, capacityDrivesPerNode: Math.max(0, Math.round(n)) } })} /></Field>
                  <Field label="Capacity drive size (TB)"><NumberInput value={cluster.s2d.capacityDriveTB} min={0} step={0.01} onChange={(n) => setCluster(cluster.id, { s2d: { ...cluster.s2d, capacityDriveTB: Math.max(0, n) } })} /></Field>
                  <Field label="Cache drives / host"><NumberInput value={cluster.s2d.cacheDrivesPerNode} min={0} onChange={(n) => setCluster(cluster.id, { s2d: { ...cluster.s2d, cacheDrivesPerNode: Math.max(0, Math.round(n)) } })} /></Field>
                  <Field label="Cache drive size (TB)"><NumberInput value={cluster.s2d.cacheDriveTB} min={0} step={0.01} onChange={(n) => setCluster(cluster.id, { s2d: { ...cluster.s2d, cacheDriveTB: Math.max(0, n) } })} /></Field>
                  <Field label="Volume resiliency">
                    <select value={cluster.resiliency} onChange={(event) => setCluster(cluster.id, { resiliency: event.target.value as Resiliency })}>
                      {Object.values(RESILIENCY).map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
                    </select>
                  </Field>
                  {(cluster.resiliency === 'nested-map' || cluster.resiliency === 'mirror-accelerated-parity') && (
                    <Field label="Mirror share">
                      <select value={cluster.nestedMapMirrorPct} onChange={(event) => setCluster(cluster.id, { nestedMapMirrorPct: Number(event.target.value) as ExistingCluster['nestedMapMirrorPct'] })}>
                        <option value={0.1}>10%</option><option value={0.2}>20%</option><option value={0.3}>30%</option>
                      </select>
                    </Field>
                  )}
                  <Field label="Sustainable S2D IOPS / host" hint="0 means not entered."><NumberInput value={cluster.s2d.iopsPerNode} min={0} step={1000} onChange={(n) => setCluster(cluster.id, { s2d: { ...cluster.s2d, iopsPerNode: Math.max(0, n) } })} /></Field>
                  <Field label="Sustainable S2D throughput / host (MB/s)" hint="0 means not entered."><NumberInput value={cluster.s2d.throughputMBpsPerNode} min={0} step={100} onChange={(n) => setCluster(cluster.id, { s2d: { ...cluster.s2d, throughputMBpsPerNode: Math.max(0, n) } })} /></Field>
                </div>
              )}
              {usesSan && !(multi && hardware.sanScope === 'shared') && (
                <div className="capacity-input-grid" style={{ marginTop: 10 }}>
                  <SanFields san={cluster.san} onChange={(san) => setCluster(cluster.id, { san })} />
                </div>
              )}
            </div>
          )
        })}
        <button className="btn ghost" type="button" onClick={() => setHardware({ ...hardware, clusters: [...hardware.clusters, blankCluster(`Cluster ${hardware.clusters.length + 1}`, { architecture: hardware.clusters[0]?.architecture ?? 'san' })] })}><Plus size={15} /> Add a cluster</button>
      </div>

      <div className="panel">
        <h2>Planning assumptions</h2>
        <p className="small muted">How demand is counted on your hardware. They apply to every cluster.</p>
        <div className="capacity-input-grid">
          <Field label="Sizing basis" hint="Measured P95 sizes a VM on its measured use, with no vCPU ratio; VMs without a measurement stay on allocation.">
            <select value={policy.sizingBasis ?? 'allocation'} onChange={(event) => setPolicyField({ sizingBasis: event.target.value as SizingBasis })}>
              <option value="allocation">Allocation</option>
              <option value="measured-p95">Measured P95</option>
            </select>
          </Field>
          {policy.sizingBasis === 'measured-p95' && (
            <Field label="Comfort factor on measured P95"><NumberInput value={policy.performanceComfortFactor ?? 1.25} min={1} max={3} step={0.05} onChange={(n) => setPolicyField({ performanceComfortFactor: Math.min(3, Math.max(1, n)) })} /></Field>
          )}
          <Field label="Immediate demand multiplier" hint={includedVms === 0 ? 'Applies once workloads are added; with no inventory it has nothing to multiply.' : 'Use 1.0 for current demand; 1.2 adds 20% immediate headroom.'}>
            {includedVms === 0
              ? <input readOnly value="Add workloads first" aria-disabled="true" />
              : <NumberInput value={policy.growthFactor} min={0.1} step={0.05} onChange={(n) => setPolicyField({ growthFactor: Math.max(0.1, n) })} />}
          </Field>
          <Field label="Annual workload growth %" hint="Used to show the year each resource runs out.">
            <NumberInput value={(policy.annualGrowthPct ?? 0) * 100} min={0} max={100} step={1} onChange={(n) => setPolicyField({ annualGrowthPct: Math.min(100, Math.max(0, n)) / 100 })} />
          </Field>
          <Field label="Forecast years"><NumberInput value={policy.growthHorizonYears ?? 3} min={1} max={10} onChange={(n) => setPolicyField({ growthHorizonYears: Math.min(10, Math.max(1, Math.round(n))) })} /></Field>
          {anySan && (
            <Field label="SAN free space to keep %" hint="Tool assumption. Above it is a warning; only above 100% full does it not fit. Room for more VMs stops at this target.">
              <NumberInput value={(policy.sanFreeSpaceTargetPct ?? 0.2) * 100} min={0} max={90} step={5} onChange={(n) => setPolicyField({ sanFreeSpaceTargetPct: Math.min(90, Math.max(0, n)) / 100 })} />
            </Field>
          )}
          <Field label="Host CPU reserve %"><NumberInput value={policy.hostCoreReservePct * 100} min={0} max={100} step={1} onChange={(n) => setPolicyField({ hostCoreReservePct: Math.min(100, Math.max(0, n)) / 100 })} /></Field>
          <Field label="Host RAM reserve (GiB)"><NumberInput value={policy.hostRamReserveGiB} min={0} step={4} onChange={(n) => setPolicyField({ hostRamReserveGiB: Math.max(0, n) })} /></Field>
          <Field label="Host RAM reserve %"><NumberInput value={policy.hostRamReservePct * 100} min={0} max={100} step={1} onChange={(n) => setPolicyField({ hostRamReservePct: Math.min(100, Math.max(0, n)) / 100 })} /></Field>
          <Field label="SMT capacity factor" hint="Leave at 1.0 unless you intentionally credit SMT."><NumberInput value={policy.smtFactor} min={1} max={2} step={0.1} onChange={(n) => setPolicyField({ smtFactor: Math.min(2, Math.max(1, n)) })} /></Field>
          <Field label="Backup method">
            <select value={policy.backupMethod} onChange={(event) => setPolicyField({ backupMethod: event.target.value as ClusterConfig['backupMethod'] })}>
              <option value="rct">Hyper-V RCT / ReFS block clone / SQL native</option>
              <option value="vss-volsnap">VSS / volsnap based</option>
            </select>
          </Field>
        </div>
        <details className="capacity-policy-details">
          <summary><span>Workload tiers</span><b>vCPU ratio, demand factor{anyHybrid ? ' and hybrid placement' : ''}</b></summary>
          <div className="capacity-policy-body scroll">
            <table className="capacity-policy-table">
              <thead><tr><th>Tier</th><th className="num">vCPU : physical core</th><th className="num">Demand factor</th>{anyHybrid && <th>Hybrid placement</th>}</tr></thead>
              <tbody>
                {TIER_IDS.map((id) => (
                  <tr key={id}>
                    <td><strong>{tiers[id].label}</strong></td>
                    <td><NumberInput value={tiers[id].oversubscription} min={0.1} step={0.5} onChange={(n) => setTier(id, { oversubscription: Math.max(0.1, n) })} /></td>
                    <td><NumberInput value={tiers[id].rightSizingFactor} min={0.1} max={2} step={0.05} onChange={(n) => setTier(id, { rightSizingFactor: Math.min(2, Math.max(0.1, n)) })} /></td>
                    {anyHybrid && <td>
                      <select value={placementOf(tiers[id])} onChange={(event) => setTier(id, { hybridPlacement: event.target.value as HybridPlacement })}>
                        <option value="s2d">S2D</option>
                        <option value="san">SAN</option>
                        <option value="split">Split</option>
                      </select>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {anyHybrid && splitTierUsed && (
              <Field label={`Split tiers on S2D: ${(policy.hybridS2dShare * 100).toFixed(0)}%`} hint="Applies only to tiers set to Split.">
                <input type="range" min={0.1} max={0.9} step={0.05} value={policy.hybridS2dShare} onChange={(event) => setPolicyField({ hybridS2dShare: Number(event.target.value) })} />
              </Field>
            )}
          </div>
        </details>
      </div>
    </div>
  )
}
