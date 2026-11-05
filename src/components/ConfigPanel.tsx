import React from 'react'
import { RESILIENCY, TIER_IDS } from '../engine/rules'
import { cacheRatio } from '../engine/capacity'
import { licensableCores, totalCores, usableCoresPerHost, usableRamPerHost } from '../engine/compute'
import { hardwareInputProblems } from '../engine/validate'
import { resolveGrowthPlan } from '../engine/growth'
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
  const growth = resolveGrowthPlan(cfg)
  const problems = hardwareInputProblems(cfg)
  const usableCores = usableCoresPerHost(cfg.node, cfg)
  const usableRam = usableRamPerHost(cfg.node, cfg)
  const sanCalculated = cfg.sanSizingMode === 'calculated'

  return (
    <div className="stack">
      {problems.length > 0 && (
        <div className="note err">
          <strong>Fix these values before using the results</strong>
          {problems.map((problem) => <div key={problem}>{problem}</div>)}
        </div>
      )}
      <div className="panel">
        <h2>Resiliency and growth</h2>
        <Field label="Spare nodes (N+n)" hint="The service-provider default is N+2 — you must survive losing a node while another is draining for patches.">
          <select value={cfg.spareNodes} onChange={e => set({ spareNodes: parseInt(e.target.value) })}>
            <option value={0}>N+0 — no spare (not recommended)</option>
            <option value={1}>N+1 — survive one failure</option>
            <option value={2}>N+2 — survive a failure during patching</option>
            <option value={3}>N+3</option>
          </select>
        </Field>
        <h3>Capacity growth plan</h3>
        <div className="row">
          <Field label="Immediate headroom %" hint="One-time reserve above today's imported CPU, memory, and consumed storage demand.">
            <NumberInput value={growth.immediateHeadroomPct} step={5} min={0} max={200} onChange={n => set({ growthFactor: 1 + Math.max(0, n) / 100 })} />
          </Field>
          <Field label="Annual workload growth %" hint="Compounded once per forecast year across CPU, memory, and consumed storage.">
            <NumberInput value={growth.annualGrowthPct * 100} step={1} min={0} max={100} onChange={n => set({ annualGrowthPct: Math.max(0, n) / 100 })} />
          </Field>
        </div>
        <div className="row">
          <Field label="Planning horizon (years)">
            <NumberInput value={growth.horizonYears} step={1} min={1} max={10} onChange={n => set({ growthHorizonYears: Math.max(1, Math.min(10, Math.round(n))) })} />
          </Field>
          <Field label="Growth deployment strategy">
            <select value={growth.strategy} onChange={e => set({ growthStrategy: e.target.value as ClusterConfig['growthStrategy'] })}>
              <option value="phased">Add nodes as growth requires them</option>
              <option value="build-now">Build forecast capacity into today's design</option>
            </select>
          </Field>
        </div>
        <div className="note">
          <strong>{growth.strategy === 'build-now' ? 'Build-now sizing' : 'Phased growth sizing'}</strong>
          {growth.strategy === 'build-now'
            ? `Today's node recommendation includes the full Year ${growth.horizonYears} demand forecast (${growth.terminalGrowthFactor.toFixed(2)}× imported demand).`
            : `Today's node recommendation includes ${growth.baseGrowthFactor.toFixed(2)}× demand; the results page shows node additions through Year ${growth.horizonYears}.`}
        </div>
        <h3>Sizing evidence</h3>
        <Field label="CPU and memory sizing basis">
          <select value={cfg.sizingBasis ?? 'allocation'} onChange={e => set({ sizingBasis: e.target.value as ClusterConfig['sizingBasis'] })}>
            <option value="allocation">Allocated vCPU and memory</option>
            <option value="measured-p95">Measured P95 where available</option>
          </select>
        </Field>
        {(cfg.sizingBasis ?? 'allocation') === 'measured-p95' && (
          <>
            <Field label={`Measured-data comfort factor (${(cfg.performanceComfortFactor ?? 1.25).toFixed(2)}x)`} hint="Applied to each VM's CPU and memory P95 measurement. A measured CPU is actual use, so the tier vCPU ratio is not applied to it. VMs without a matching metric remain sized on allocation.">
              <NumberInput value={cfg.performanceComfortFactor ?? 1.25} min={1} max={2} step={0.05} onChange={n => set({ performanceComfortFactor: Math.max(1, n) })} />
            </Field>
            <Field label="Target/source per-core benchmark" hint="1.0 means equal per-core performance; 1.20 means the target benchmark is 20% faster. Use measured benchmark evidence, not clock speed alone.">
              <NumberInput value={cfg.cpuPerformanceFactor ?? 1} min={0.5} max={3} step={0.05} onChange={n => set({ cpuPerformanceFactor: Math.max(0.1, n) })} />
            </Field>
          </>
        )}
        <Field label="Backup method" hint="VSS/volsnap caps CSVs at 10 TiB [MS]. RCT and ReFS block-clone are fine to 32 TiB and beyond.">
          <select value={cfg.backupMethod} onChange={e => set({ backupMethod: e.target.value as any })}>
            <option value="rct">Hyper-V RCT / ReFS block clone / SQL native</option>
            <option value="vss-volsnap">VSS / volsnap based</option>
          </select>
        </Field>
        <Field label="Cluster quorum witness" hint="A witness is required for a complete 2-node design and recommended for small clusters.">
          <select value={cfg.witnessType ?? 'none'} onChange={e => set({ witnessType: e.target.value as ClusterConfig['witnessType'] })}>
            <option value="cloud">Cloud witness</option>
            <option value="file-share">File share witness</option>
            {cfg.architecture === 'san' && <option value="disk">Disk witness</option>}
            <option value="none">Not selected yet</option>
          </select>
        </Field>
      </div>

      <div className="panel">
        <h2>Reference server</h2>
        <div className="note">
          <strong>This is a starting assumption, not a purchase decision</strong>
          Surveyor needs a server size to work out how many nodes your workload takes. You do not need to know your final
          hardware: keep this example, enter your own, or compare other sizes on the results page.
        </div>
        <div className="row">
          <Field label="Sockets"><NumberInput value={cfg.node.sockets} min={1} max={8} onChange={n => setNode({ sockets: n })} /></Field>
          <Field label="Cores / socket"><NumberInput value={cfg.node.coresPerSocket} min={1} onChange={n => setNode({ coresPerSocket: n })} /></Field>
        </div>
        <Field label="RAM per server (GiB)"><NumberInput value={cfg.node.ramGiB} min={16} step={64} onChange={n => setNode({ ramGiB: n })} /></Field>
        <Field label="Target processor vendor" hint="Live migration cannot cross Intel and AMD processor vendors. This also drives migration-readiness checks.">
          <select value={cfg.node.cpuVendor ?? 'unknown'} onChange={e => setNode({ cpuVendor: e.target.value as ClusterConfig['node']['cpuVendor'] })}>
            <option value="amd">AMD</option>
            <option value="intel">Intel</option>
            <option value="unknown">Not decided</option>
          </select>
        </Field>
        <div className={`note ${lic > cores ? 'warn' : ''}`} style={{ marginTop: 4 }}>
          <strong>{cores} physical cores · {lic} licensable</strong>
          {lic > cores
            ? `Windows Server bills a 16-core-per-server / 8-core-per-socket minimum, so you pay for ${lic - cores} unused cores per node.`
            : 'No licensing waste at this core count.'}
        </div>
      </div>

      <div className="panel">
        <h2>SAN</h2>
        <p className="small muted" style={{ marginTop: -6 }}>Used by the SAN and hybrid results.</p>
        <Field label="Array size">
          <select value={sanCalculated ? 'calculated' : 'fixed'} onChange={e => set({ sanSizingMode: e.target.value as ClusterConfig['sanSizingMode'], sanFreeSpaceTargetPct: cfg.sanFreeSpaceTargetPct ?? 0.2 })}>
            <option value="calculated">Calculate the array I need from the workload</option>
            <option value="fixed">I already know the array size</option>
          </select>
        </Field>
        {sanCalculated ? (
          <div className="row">
            <Field label="Data reduction ratio" hint="Dedupe and compression only, not thin provisioning. Use a vendor guarantee or measured figure if you have one. 2.5:1 is a conservative planning default.">
              <NumberInput value={cfg.san.drr} min={1} max={10} step={0.1} onChange={n => setSan({ drr: n })} />
            </Field>
            <Field label="Free space to keep %" hint="Tool assumption. 20% plans the array to be no more than 80% full.">
              <NumberInput value={(cfg.sanFreeSpaceTargetPct ?? 0.2) * 100} min={0} max={90} step={5} onChange={n => set({ sanFreeSpaceTargetPct: n / 100 })} />
            </Field>
          </div>
        ) : (
          <div className="row">
            <Field label="Array usable capacity (TiB)" hint="Usable, not effective. Effective already includes data reduction, so multiplying it again double-counts. Designs above this size show as blocked.">
              <NumberInput value={cfg.san.usableTiB} min={1} onChange={n => setSan({ usableTiB: n })} />
            </Field>
            <Field label="Data reduction ratio" hint="Dedupe and compression only, not thin provisioning.">
              <NumberInput value={cfg.san.drr} min={1} max={10} step={0.1} onChange={n => setSan({ drr: n })} />
            </Field>
            <Field label="Free space to keep %" hint="Tool assumption. Going above it gives a warning, not a failure; only above 100% full is the design blocked.">
              <NumberInput value={(cfg.sanFreeSpaceTargetPct ?? 0.2) * 100} min={0} max={90} step={5} onChange={n => set({ sanFreeSpaceTargetPct: n / 100 })} />
            </Field>
          </div>
        )}
        {cfg.san.drr > 5 && (
          <div className="note warn">
            <strong>Data reduction above 5:1</strong>
            Check that this figure excludes thin provisioning. Thin provisioning counts allocated but unwritten space, which
            disappears as guests fill their volumes, so it is not data reduction.
          </div>
        )}
        <Field label="SAN CSV / LUN layout" hint="One presented SAN LUN maps 1:1 to one CSV. Microsoft recommends at least one CSV per node and imposes no VM-per-CSV maximum.">
          <select value={cfg.sanCsvLayoutMode ?? 'balanced'} onChange={e => set({ sanCsvLayoutMode: e.target.value as ClusterConfig['sanCsvLayoutMode'] })}>
            <option value="balanced">Balanced operations — recommended</option>
            <option value="granular">Granular recovery — enforce tier targets</option>
            <option value="custom">Custom SAN CSV / LUN total</option>
          </select>
        </Field>
        {(cfg.sanCsvLayoutMode ?? 'balanced') === 'custom' && (
          <Field label="Requested SAN CSV / LUN total" hint="The engine honors this cluster-wide target unless the 64 TiB platform recommendation or 10 TiB VSS/volsnap limit requires more.">
            <NumberInput value={cfg.sanCustomCsvCount ?? 1} min={1} max={128} step={1} onChange={n => set({ sanCustomCsvCount: Math.max(1, Math.round(n)) })} />
          </Field>
        )}
        <div className="note">
          <strong>{(cfg.sanCsvLayoutMode ?? 'balanced') === 'balanced' ? 'Balanced operations is the default' : (cfg.sanCsvLayoutMode ?? 'balanced') === 'granular' ? 'Tier recovery targets are enforced' : 'Your requested total controls the layout'}</strong>
          {(cfg.sanCsvLayoutMode ?? 'balanced') === 'balanced'
            ? 'The design starts at one SAN CSV/LUN per node, distributes capacity across workload tiers, and adds LUNs only when a size or backup limit requires them. Tier recovery targets remain visible as an optional granular alternative.'
            : (cfg.sanCsvLayoutMode ?? 'balanced') === 'granular'
              ? 'Every tier’s editable recovery-unit size and target VM count can add SAN CSV/LUNs. This intentionally creates more, smaller recovery units.'
              : 'The requested total is distributed by tier capacity. A hard size or backup limit can raise the final count, and a below-node target generates a design warning.'}
        </div>
        <div className="row">
          <Field label="Validated array IOPS" hint="Optional sustainable workload figure; 0 means not validated."><NumberInput value={cfg.san.maxIops ?? 0} min={0} step={1000} onChange={n => setSan({ maxIops: n })} /></Field>
          <Field label="Validated array throughput MB/s"><NumberInput value={cfg.san.maxThroughputMBps ?? 0} min={0} step={100} onChange={n => setSan({ maxThroughputMBps: n })} /></Field>
        </div>
      </div>

      <div className="panel">
        <h2>Storage Spaces Direct</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          Used by the S2D and hybrid results. Each result uses its own resiliency: three-way mirror, mirror-accelerated parity, or dual parity. Hybrid uses three-way mirror.
        </p>
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
        <Field label="Mirror share for mirror-accelerated parity">
          <select value={cfg.nestedMapMirrorPct} onChange={e => set({ nestedMapMirrorPct: parseFloat(e.target.value) as any })}>
            <option value={0.1}>10% mirror — best capacity</option>
            <option value={0.2}>20% mirror</option>
            <option value={0.3}>30% mirror — best write performance</option>
          </select>
        </Field>
        <h3>Validated S2D performance</h3>
        <p className="small muted">Optional sustainable figures from a vendor design, proof of concept, or DiskSpd test. Leave at 0 when unknown; Surveyor will report storage performance as unvalidated.</p>
        <div className="row">
          <Field label="IOPS / node"><NumberInput value={cfg.node.s2dIopsPerNode ?? 0} min={0} step={1000} onChange={n => setNode({ s2dIopsPerNode: n })} /></Field>
          <Field label="Throughput MB/s / node"><NumberInput value={cfg.node.s2dThroughputMBpsPerNode ?? 0} min={0} step={100} onChange={n => setNode({ s2dThroughputMBpsPerNode: n })} /></Field>
        </div>
      </div>

      <div className="panel">
        <h2>Hybrid S2D + SAN</h2>
        <p className="small muted" style={{ marginTop: -6 }}>Used by the hybrid result. Choose each tier's placement in the Workload tiers table below.</p>
        <Field label={`Split tiers use ${(cfg.hybridS2dShare * 100).toFixed(0)}% S2D and ${((1 - cfg.hybridS2dShare) * 100).toFixed(0)}% SAN`} hint="This percentage applies only to tiers explicitly set to Split.">
          <input type="range" min={0.1} max={0.9} step={0.05} value={cfg.hybridS2dShare}
            onChange={e => set({ hybridS2dShare: parseFloat(e.target.value) })} />
        </Field>
        <div className="note">
          <strong>Supported since Windows Server 2022</strong>
          "Hyperconverged with SAN storage" — S2D CSVs on ReFS and SAN CSVs on NTFS coexist in one
          cluster but remain separate. SAN LUNs must never enter the S2D pool. The node ceiling stays
          at 16 because S2D is present.
        </div>
      </div>

      <div className="panel">
        <h2>Host reserves</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          The CPU and memory held back for each Hyper-V host itself, so VMs cannot be sized onto it.
          Microsoft publishes no reserve figure because Hyper-V calculates it dynamically, so these are tool assumptions.
        </p>
        <div className="note">
          <strong>{usableCores.toFixed(0)} of {cores} cores and {usableRam.toFixed(0)} of {cfg.node.ramGiB} GiB of RAM are available to VMs on each server</strong>
          CPU keeps the larger of 1 core or the CPU reserve %. RAM keeps the larger of the GiB or % reserve. S2D designs also hold back RAM for storage metadata.
        </div>
        <div className="row">
          <Field label="CPU reserve %"><NumberInput value={cfg.hostCoreReservePct * 100} step={1} min={0} max={90} onChange={n => set({ hostCoreReservePct: n / 100 })} /></Field>
          <Field label="SMT factor" hint="1.0 = no hyperthreading credit">
            <NumberInput value={cfg.smtFactor} step={0.1} min={1} max={2} onChange={n => set({ smtFactor: n })} />
          </Field>
        </div>
        <div className="row">
          <Field label="RAM reserve (GiB)"><NumberInput value={cfg.hostRamReserveGiB} min={0} step={4} onChange={n => set({ hostRamReserveGiB: n })} /></Field>
          <Field label="RAM reserve %"><NumberInput value={cfg.hostRamReservePct * 100} step={1} min={0} max={90} onChange={n => set({ hostRamReservePct: n / 100 })} /></Field>
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
          imposes no VMs-per-CSV limit. The recovery-unit settings below are design targets: they
          control operational grouping and volume size, not a Hyper-V platform maximum. For SAN,
          they are advisory in Balanced or Custom mode and enforced only in Granular recovery mode.
        </div>
        <div className="scroll" style={{ maxHeight: 380 }}>
          <table>
            <thead>
              <tr>
                <th>Tier</th>
                <th className="num">vCPU:pCore</th>
                <th className="num">Right-size</th>
                <th className="num">Target max VMs / recovery unit</th>
                <th className="num">Max recovery-unit size (TiB)</th>
                <th>Storage</th>
                <th>Hybrid placement</th>
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
                  <td>
                    <select value={tiers[id].hybridPlacement ?? (tiers[id].storageTier === 'performance' ? 's2d' : 'san')} onChange={e => setTier(id, { hybridPlacement: e.target.value as TierPolicy['hybridPlacement'] })}>
                      <option value="s2d">S2D</option>
                      <option value="san">SAN</option>
                      <option value="split">Split</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Right-sizing factor multiplies allocated vCPU and RAM. Leave it at 1.0 when sizing from an
          RVTools import unless you have measured utilisation — RVTools carries none. Dynamic Memory is a deployment policy shown in the report; it does not reduce the sizing demand unless measured P95 data is selected above.
        </p>
      </div>
    </div>
  )
}
