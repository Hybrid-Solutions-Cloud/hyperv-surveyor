import React from 'react'
import { RESILIENCY, TIER_IDS } from '../engine/rules'
import { cacheRatio } from '../engine/capacity'
import { licensableCores, totalCores } from '../engine/compute'
import type { ClusterConfig, Resiliency, TierId, TierPolicy } from '../engine/types'
import { Field, NumberInput } from './Shared'

interface Props {
  cfg: ClusterConfig
  setCfg: (c: ClusterConfig) => void
  tiers: Record<TierId, TierPolicy>
  setTiers: (t: Record<TierId, TierPolicy>) => void
}

export function ConfigPanel({ cfg, setCfg, tiers, setTiers }: Props) {
  const set = (p: Partial<ClusterConfig>) => setCfg({ ...cfg, ...p })
  const setNode = (p: Partial<ClusterConfig['node']>) => setCfg({ ...cfg, node: { ...cfg.node, ...p } })
  const setSan = (p: Partial<ClusterConfig['san']>) => setCfg({ ...cfg, san: { ...cfg.san, ...p } })
  const setTier = (id: TierId, p: Partial<TierPolicy>) =>
    setTiers({ ...tiers, [id]: { ...tiers[id], ...p } })

  const cores = totalCores(cfg.node)
  const lic = licensableCores(cfg.node)
  const ratio = cacheRatio(cfg.node)
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'
  const usesSan = cfg.architecture === 'san' || cfg.architecture === 'hybrid'

  return (
    <div className="stack">
      <div className="panel">
        <h2>Resiliency</h2>
        <Field label="Spare nodes (N+n)" hint="The service-provider default is N+2 — you must survive losing a node while another is draining for patches.">
          <select value={cfg.spareNodes} onChange={e => set({ spareNodes: parseInt(e.target.value) })}>
            <option value={0}>N+0 — no spare (not recommended)</option>
            <option value={1}>N+1 — survive one failure</option>
            <option value={2}>N+2 — survive a failure during patching</option>
            <option value={3}>N+3</option>
          </select>
        </Field>
        <Field label="Growth factor" hint="Multiplier on all demand. 1.25 = 25% headroom for growth.">
          <NumberInput value={cfg.growthFactor} step={0.05} min={1} onChange={n => set({ growthFactor: n })} />
        </Field>
        <Field label="Backup method" hint="VSS/volsnap caps CSVs at 10 TiB [MS]. RCT and ReFS block-clone are fine to 32 TiB and beyond.">
          <select value={cfg.backupMethod} onChange={e => set({ backupMethod: e.target.value as any })}>
            <option value="rct">Hyper-V RCT / ReFS block clone / SQL native</option>
            <option value="vss-volsnap">VSS / volsnap based</option>
          </select>
        </Field>
      </div>

      <div className="panel">
        <h2>Node specification</h2>
        <div className="row">
          <Field label="Sockets"><NumberInput value={cfg.node.sockets} min={1} max={8} onChange={n => setNode({ sockets: n })} /></Field>
          <Field label="Cores / socket"><NumberInput value={cfg.node.coresPerSocket} min={1} onChange={n => setNode({ coresPerSocket: n })} /></Field>
        </div>
        <Field label="RAM per node (GiB)"><NumberInput value={cfg.node.ramGiB} min={16} step={64} onChange={n => setNode({ ramGiB: n })} /></Field>
        <div className={`note ${lic > cores ? 'warn' : ''}`} style={{ marginTop: 4 }}>
          <strong>{cores} physical cores · {lic} licensable</strong>
          {lic > cores
            ? `Windows Server bills a 16-core-per-server / 8-core-per-socket minimum, so you pay for ${lic - cores} unused cores per node.`
            : 'No licensing waste at this core count.'}
        </div>

        {usesS2d && (
          <>
            <h3>Storage Spaces Direct drives</h3>
            <Field label="Media">
              <select value={cfg.node.media} onChange={e => setNode({ media: e.target.value as any })}>
                <option value="all-flash">All-flash (SSD/NVMe capacity)</option>
                <option value="hybrid">Hybrid (HDD capacity — cache mandatory)</option>
              </select>
            </Field>
            <div className="row">
              <Field label="Capacity drives / node" hint="Minimum 4 [MS]">
                <NumberInput value={cfg.node.capacityDrivesPerNode} min={0} onChange={n => setNode({ capacityDrivesPerNode: n })} />
              </Field>
              <Field label="Capacity drive TB">
                <NumberInput value={cfg.node.capacityDriveTB} min={0} step={0.01} onChange={n => setNode({ capacityDriveTB: n })} />
              </Field>
            </div>
            <div className="row">
              <Field label="Cache drives / node" hint="Minimum 2 when used [MS]">
                <NumberInput value={cfg.node.cacheDrivesPerNode} min={0} onChange={n => setNode({ cacheDrivesPerNode: n })} />
              </Field>
              <Field label="Cache drive TB">
                <NumberInput value={cfg.node.cacheDriveTB} min={0} step={0.01} onChange={n => setNode({ cacheDriveTB: n })} />
              </Field>
            </div>
            <div className="small muted">
              Cache is {(ratio * 100).toFixed(1)}% of capacity. Starting recommendation is{' '}
              {cfg.node.media === 'hybrid' ? '10%' : '5%'} for Windows Server; Azure Local imposes a hard 15% floor for hybrid.
              Cache contributes <strong>zero</strong> usable capacity.
            </div>

            <h3>Resiliency</h3>
            <Field label="Volume resiliency">
              <select value={cfg.resiliency} onChange={e => set({ resiliency: e.target.value as Resiliency })}>
                {Object.values(RESILIENCY).map(r => (
                  <option key={r.id} value={r.id}>
                    {r.label} — min {r.minNodes} node{r.minNodes > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <div className="small muted">{RESILIENCY[cfg.resiliency].note}</div>
            {(cfg.resiliency === 'nested-map' || cfg.resiliency === 'mirror-accelerated-parity') && (
              <Field label="Mirror share of the volume">
                <select value={cfg.nestedMapMirrorPct} onChange={e => set({ nestedMapMirrorPct: parseFloat(e.target.value) as any })}>
                  <option value={0.1}>10% mirror — best capacity</option>
                  <option value={0.2}>20% mirror</option>
                  <option value={0.3}>30% mirror — best write performance</option>
                </select>
              </Field>
            )}
          </>
        )}

        {usesSan && (
          <>
            <h3>SAN — Pure / Everpure FlashArray</h3>
            <Field label="Array USABLE capacity (TiB)" hint="Usable, never 'effective'. Effective already has DRR baked in — multiplying it again double-counts.">
              <NumberInput value={cfg.san.usableTiB} min={1} onChange={n => setSan({ usableTiB: n })} />
            </Field>
            <Field label="Data reduction ratio" hint="Dedupe + compression + pattern removal ONLY. Pure's blended marketing average is 5:1; 2.5:1 is a conservative planning floor.">
              <NumberInput value={cfg.san.drr} min={1} max={10} step={0.1} onChange={n => setSan({ drr: n })} />
            </Field>
            {cfg.san.drr > 5 && (
              <div className="note warn">
                <strong>DRR above 5:1</strong>
                Pure's headline claim is "5-to-1 average data reduction". The "up to 10:1" figure includes
                thin provisioning, which is not data reduction — it counts allocated-but-unwritten space
                that vanishes as guests fill their volumes. Everpure's own blog criticises this conflation.
              </div>
            )}
          </>
        )}

        {cfg.architecture === 'hybrid' && (
          <>
            <h3>Hybrid split</h3>
            <Field label={`S2D carries ${(cfg.hybridS2dShare * 100).toFixed(0)}% of storage, SAN ${((1 - cfg.hybridS2dShare) * 100).toFixed(0)}%`}>
              <input type="range" min={0.1} max={0.9} step={0.05} value={cfg.hybridS2dShare}
                onChange={e => set({ hybridS2dShare: parseFloat(e.target.value) })} />
            </Field>
            <div className="note">
              <strong>Supported since Windows Server 2022</strong>
              "Hyperconverged with SAN storage" — S2D CSVs on ReFS and SAN CSVs on NTFS coexist in one
              cluster but remain separate. SAN LUNs must never enter the S2D pool. The node ceiling stays
              at 16 because S2D is present.
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Host reserves</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          Microsoft publishes no CPU or memory reserve figure for the root partition — Hyper-V calculates
          it dynamically. These are tool assumptions.
        </p>
        <div className="row">
          <Field label="CPU reserve %"><NumberInput value={cfg.hostCoreReservePct * 100} step={1} min={0} onChange={n => set({ hostCoreReservePct: n / 100 })} /></Field>
          <Field label="SMT factor" hint="1.0 = no hyperthreading credit">
            <NumberInput value={cfg.smtFactor} step={0.1} min={1} max={2} onChange={n => set({ smtFactor: n })} />
          </Field>
        </div>
        <div className="row">
          <Field label="RAM reserve (GiB)"><NumberInput value={cfg.hostRamReserveGiB} min={0} step={4} onChange={n => set({ hostRamReserveGiB: n })} /></Field>
          <Field label="RAM reserve %"><NumberInput value={cfg.hostRamReservePct * 100} step={1} min={0} onChange={n => set({ hostRamReservePct: n / 100 })} /></Field>
        </div>
        {cfg.smtFactor > 1 && (
          <div className="note warn">
            <strong>SMT credit is being taken</strong>
            The core scheduler has been the default since Windows Server 2019 and pairs virtual processors
            onto SMT sibling pairs so a physical core is never shared between two VMs. Taking hyperthreading
            credit on top of an oversubscription ratio double-counts the same headroom.
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Workload tiers</h2>
        <div className="note warn">
          <strong>Every number on this panel is a TOOL assumption</strong>
          Microsoft publishes no vCPU:pCore ratio. The WS2025 maximums table says outright:
          "Virtual processors per logical processor — No ratio imposed by Hyper-V." Microsoft also
          imposes no VMs-per-CSV limit.
        </div>
        <div className="scroll" style={{ maxHeight: 380 }}>
          <table>
            <thead>
              <tr>
                <th>Tier</th>
                <th className="num">vCPU:pCore</th>
                <th className="num">Right-size</th>
                <th className="num">Max VMs/CSV</th>
                <th className="num">Blast radius TiB</th>
                <th>Storage</th>
              </tr>
            </thead>
            <tbody>
              {TIER_IDS.map(id => (
                <tr key={id}>
                  <td><strong>{tiers[id].label}</strong></td>
                  <td><NumberInput value={tiers[id].oversubscription} min={0.5} step={0.5} onChange={n => setTier(id, { oversubscription: Math.max(0.1, n) })} /></td>
                  <td><NumberInput value={tiers[id].rightSizingFactor} min={0.1} max={2} step={0.05} onChange={n => setTier(id, { rightSizingFactor: n })} /></td>
                  <td><NumberInput value={tiers[id].maxVmsPerCsv} min={1} onChange={n => setTier(id, { maxVmsPerCsv: n })} /></td>
                  <td><NumberInput value={tiers[id].blastRadiusTiB} min={1} onChange={n => setTier(id, { blastRadiusTiB: n })} /></td>
                  <td>
                    <select value={tiers[id].storageTier} onChange={e => setTier(id, { storageTier: e.target.value as any })}>
                      <option value="performance">performance</option>
                      <option value="capacity">capacity</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Right-sizing factor multiplies allocated vCPU and RAM. Leave it at 1.0 when sizing from an
          RVTools import unless you have measured utilisation — RVTools carries none.
        </p>
      </div>
    </div>
  )
}
