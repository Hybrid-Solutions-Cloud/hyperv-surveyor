import React, { useEffect, useMemo, useState } from 'react'
import { compareArchitectures } from './engine/solve'
import { exportDesign } from './io/exportXlsx'
import { DEFAULT_CONFIG, defaultTiers } from './state/defaults'
import { fromUrl, toUrl } from './state/urlState'
import { WorkloadPanel } from './components/WorkloadPanel'
import { ConfigPanel } from './components/ConfigPanel'
import { ResultsPanel } from './components/ResultsPanel'
import { ReversePanel } from './components/ReversePanel'
import type { ClusterConfig, TierId, TierPolicy, Vm } from './engine/types'

type Tab = 'workload' | 'config' | 'forward' | 'reverse' | 'about'

export default function App() {
  const restored = useMemo(() => fromUrl(), [])
  const [tab, setTab] = useState<Tab>('workload')
  const [vms, setVms] = useState<Vm[]>(restored?.vms ?? [])
  const [cfg, setCfg] = useState<ClusterConfig>(restored?.cfg ?? DEFAULT_CONFIG)
  const [tiers, setTiers] = useState<Record<TierId, TierPolicy>>(restored?.tiers ?? defaultTiers())
  const [chosenKey, setChosenKey] = useState('san')
  const [copied, setCopied] = useState(false)

  const options = useMemo(() => compareArchitectures(cfg, vms, tiers), [cfg, vms, tiers])
  const chosen = options.find(o => o.key === chosenKey) ?? options[0]

  useEffect(() => {
    if (restored) setTab(vms.length > 0 ? 'forward' : 'config')
  }, [])

  /**
   * Copy the scenario URL. The Clipboard API is unavailable or permission-denied in several
   * real situations — opened from file://, non-secure origins, some corporate policies — so
   * this degrades to a prompt() the user can copy from rather than failing silently.
   */
  async function share() {
    const url = toUrl({ cfg, tiers, vms })
    try {
      window.history.replaceState(null, '', url)
    } catch {
      /* file:// can reject replaceState; the URL is still valid to copy */
    }
    try {
      if (!navigator.clipboard) throw new Error('no clipboard api')
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      window.prompt('Copy this scenario link:', url)
    }
  }

  return (
    <div className="app">
      <header className="masthead">
        <h1>Hyper-V Surveyor</h1>
        <p>
          Plan your Hyper-V cluster before you rack it. Bidirectional sizing for Windows Server 2025 —
          SAN, Storage Spaces Direct, or both in one cluster. Everything runs in this browser;
          no workload data is uploaded anywhere.
        </p>
      </header>

      <div className="tabs">
        <button className={tab === 'workload' ? 'active' : ''} onClick={() => setTab('workload')}>
          1 · Workloads {vms.length > 0 && `(${vms.filter(v => v.include).length})`}
        </button>
        <button className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}>2 · Configuration</button>
        <button className={tab === 'forward' ? 'active' : ''} onClick={() => setTab('forward')}>3 · Workload → Hardware</button>
        <button className={tab === 'reverse' ? 'active' : ''} onClick={() => setTab('reverse')}>4 · Hardware → Workload</button>
        <button className={tab === 'about' ? 'active' : ''} onClick={() => setTab('about')}>Method &amp; sources</button>
        <div style={{ flex: 1 }} />
        <button className="btn ghost" onClick={share} style={{ alignSelf: 'center' }}>
          {copied ? 'Link copied' : 'Share scenario'}
        </button>
      </div>

      {tab === 'workload' && <WorkloadPanel vms={vms} setVms={setVms} tiers={tiers} />}
      {tab === 'config' && <ConfigPanel cfg={cfg} setCfg={setCfg} tiers={tiers} setTiers={setTiers} />}
      {tab === 'forward' && (
        <ResultsPanel
          options={options}
          chosenKey={chosen.key}
          setChosenKey={setChosenKey}
          tiers={tiers}
          onExport={() => exportDesign(options, chosen, chosen.cfg, tiers, vms)}
        />
      )}
      {tab === 'reverse' && <ReversePanel cfg={cfg} tiers={tiers} vms={vms} />}
      {tab === 'about' && <About />}

      <footer className="foot">
        Hyper-V Surveyor · rules verified against Microsoft Learn, August 2026 ·
        every figure is tagged MS (hard rule), MS-REC (recommendation) or TOOL (our assumption)
      </footer>
    </div>
  )
}

function About() {
  return (
    <div className="stack">
      <div className="panel">
        <h2>How this tool decides</h2>
        <p>
          One constraint model, two solve targets. <strong>Forward</strong> takes a workload inventory and finds
          the minimum node count. <strong>Reverse</strong> fixes the hardware and finds what fits. They share the
          same engine deliberately — two separate code paths would eventually disagree, and a sizing tool that
          contradicts itself is worse than no tool at all.
        </p>
        <h3>Why SAN and S2D give different answers for the same workload</h3>
        <p>
          On SAN, node count is driven by <strong>compute alone</strong> — the array's capacity is independent of
          how many hosts you attach to it. On S2D, node count is driven by <strong>compute and capacity
          together</strong>, because every node you add is also storage. Parity efficiency itself improves as
          nodes are added, so capacity has to be re-evaluated at every candidate node count rather than divided
          once. That is the whole reason this tool exists rather than a spreadsheet.
        </p>
        <h3>The binding constraint is the answer</h3>
        <p>
          Every result names which constraint bound and what the other two would have needed on their own.
          "10 nodes — storage-bound; compute alone would need 7" is more useful than the number 10.
        </p>
      </div>

      <div className="panel">
        <h2>Rules enforced from Microsoft documentation</h2>
        <ul>
          <li><strong>S2D clusters are 2–16 nodes.</strong> Not 64 — that is the general failover-clustering
            maximum and stops applying the moment S2D is enabled. Hybrid inherits the 16-node ceiling.</li>
          <li><strong>Dual-parity efficiency diverges by media above 8 nodes.</strong> Hybrid caps at 72.7%;
            all-flash reaches 75% at 9 nodes and 80% at 16. A single table gives wrong answers.</li>
          <li><strong>Reserve capacity is one drive per server, capped at four drives total</strong> — a 16-node
            cluster still reserves only four.</li>
          <li><strong>Minimum four capacity drives per server</strong> on Windows Server, two cache drives when a
            cache tier is used, and HDD-only is unsupported.</li>
          <li><strong>Cache contributes zero usable capacity</strong> and needs 4 GiB of host RAM per TB of cache
            for pool metadata — routinely forgotten and worth tens of GiB per node.</li>
          <li><strong>At least one CSV per node, and the total should be a whole multiple of node count</strong>
            so coordinator ownership distributes evenly. 64 CSVs per cluster maximum, 64 TiB each, 10 TiB if
            backup is VSS/volsnap.</li>
          <li><strong>Microsoft imposes no limit on VMs per CSV.</strong> Our blast-radius defaults are a tool
            assumption and are labelled as such.</li>
          <li><strong>A 2-node cluster requires a witness.</strong> 3 and 4 nodes should have one; 5+ gains nothing.</li>
          <li><strong>Windows Server 2025 changed NUMA behaviour</strong> — a VM needing more virtual cores than
            one NUMA node provides will not start unless NUMA spanning is explicitly enabled. Earlier versions
            started it with degraded performance.</li>
          <li><strong>Hyperconverged with SAN storage is supported</strong> from Windows Server 2022. S2D CSVs on
            ReFS and SAN CSVs on NTFS coexist in one cluster. SAN LUNs must never enter the S2D pool — the
            "SAN not supported" language in the S2D hardware requirements scopes to pool membership, not to
            the cluster.</li>
          <li><strong>LBFO teaming is unsupported for the Hyper-V virtual switch</strong> from Windows Server 2022.
            SET only, maximum 8 adapters.</li>
        </ul>
      </div>

      <div className="panel">
        <h2>What we assume, because nobody publishes it</h2>
        <div className="note warn">
          <strong>These are tool assumptions, not vendor guidance</strong>
          Anything tagged TOOL in the findings list, and every number on the tier panel.
        </div>
        <ul>
          <li><strong>vCPU:pCore ratios.</strong> Microsoft publishes none — the WS2025 maximums table says
            "Virtual processors per logical processor: No ratio imposed by Hyper-V", and Azure Stack Hub's docs
            state Microsoft deliberately declines to give guidance. Our defaults come from vendor and field
            consensus. Dell's own guidance is more conservative still.</li>
          <li><strong>Host CPU and memory reserves.</strong> Hyper-V calculates these dynamically and publishes no
            figure. The closest official anchor is Azure Stack Hub's 15% memory constant, which is Azure Stack
            Hub-specific.</li>
          <li><strong>VMs per CSV and blast radius.</strong> Microsoft imposes no limit; Pure's specific guidance
            sits behind a login-walled support portal.</li>
          <li><strong>SMT factor defaults to 1.0 — no hyperthreading credit.</strong> The core scheduler has been
            the default since Windows Server 2019 and pairs virtual processors onto SMT siblings so a physical
            core is never shared between two VMs. Taking SMT credit on top of an oversubscription ratio
            double-counts the same headroom.</li>
          <li><strong>SAN data reduction defaults to 2.5:1.</strong> Pure's blended marketing average is 5:1.
            The "up to 10:1" figure includes thin provisioning, which is not data reduction — it counts
            allocated-but-unwritten space that vanishes as guests fill their volumes.</li>
        </ul>
      </div>

      <div className="panel">
        <h2>The RVTools problem</h2>
        <div className="note warn">
          <strong>RVTools contains no utilisation history at all</strong>
          vInfo, vCPU and vMemory are allocation only. The CPU and Memory Usage columns on vHost are a
          point-in-time snapshot taken when RVTools connected to vCenter — not an average.
        </div>
        <p>
          A sizing built purely from an RVTools import therefore sizes on <em>allocation</em>, and will oversize,
          often substantially, because VMware estates are typically over-provisioned at the vCPU level. The
          per-tier Right-Sizing Factor exists to make that assumption visible rather than hidden. It defaults
          to 1.0 — the conservative choice. If measured utilisation matters, bring a Live Optics or Aria
          Operations export, which do carry time-series data.
        </p>
        <p className="small muted">
          The parser excludes templates, SRM placeholders and vCLS agent VMs, prefers vPartition consumed
          figures over vInfo In Use, and accepts both the pre-4.1.2 "MB" and post-4.1.2 "MiB" column spellings.
          Powered-off VMs are imported but excluded from sizing by default.
        </p>
      </div>
    </div>
  )
}
