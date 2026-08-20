import { useState } from 'react'
import { ExternalLink, Search } from 'lucide-react'
import { BasisPill, PageHeader } from '../components/Shared'
import { MANAGEMENT_WORKBOOK } from '../data/managementWorkbook.generated'

const rules = [
  ['MS', 'S2D clusters use a 2–16-node envelope; hybrid designs inherit the S2D ceiling.'],
  ['MS', 'Capacity reserve is one drive per server, capped at four drives across the pool.'],
  ['MS', 'Cache contributes no usable capacity and requires host memory for pool metadata.'],
  ['MS-REC', 'CSV count should distribute ownership evenly across the nodes.'],
  ['TOOL', 'vCPU-to-core ratios, host reserves, right-sizing factors, and recovery blast-radius limits are editable assumptions.'],
] as const

type MethodSection = 'method' | 'limits'

export default function MethodPage() {
  const [section, setSection] = useState<MethodSection>('method')

  return (
    <>
      <PageHeader
        eyebrow="Trust and traceability"
        title="Sources and method"
        description="Understand how the calculations work, where vendor guidance stops, and which values are planning assumptions."
      />

      <div className="subtabs" role="tablist" aria-label="Sources and method sections">
        <button className={section === 'method' ? 'subtab active' : 'subtab'} onClick={() => setSection('method')} role="tab" aria-selected={section === 'method'}>Calculation method</button>
        <button className={section === 'limits' ? 'subtab active' : 'subtab'} onClick={() => setSection('limits')} role="tab" aria-selected={section === 'limits'}>Platform limits & capabilities</button>
      </div>

      {section === 'method' ? <MethodOverview /> : <PlatformLimits />}
    </>
  )
}

function MethodOverview() {
  return (
    <div className="stack">
      <section className="method-grid">
        <article className="panel method-lead">
          <h2>One engine, two directions</h2>
          <p>
            Forward sizing finds the minimum node count for a workload. Existing-capacity sizing fixes the hardware
            and calculates what still fits. Both use the same CPU, memory, storage, and validation functions so their
            answers cannot drift apart.
          </p>
          <div className="method-flow">
            <span>Workloads</span><i>+</i><span>Assumptions</span><i>→</i><strong>Constraint engine</strong><i>→</i><span>Explainable result</span>
          </div>
        </article>

        <article className="panel">
          <h2>The binding constraint is the answer</h2>
          <p>
            A node count without its reason is difficult to defend. Every result identifies whether CPU, memory,
            or storage bound first and shows what the other resources would have required independently.
          </p>
        </article>
      </section>

      <section className="panel">
        <h2>Rule provenance</h2>
        <div className="provenance-list">
          {rules.map(([basis, text]) => (
            <div key={text}>
              <BasisPill basis={basis} />
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Why RVTools needs an explicit assumption</h2>
        <div className="note warn">
          <strong>RVTools is an allocation inventory, not utilization history.</strong>
          It can size conservatively from configured vCPU, RAM, and storage, but it cannot establish a measured long-term utilization percentile.
        </div>
        <p>
          Imported workloads therefore default to a right-sizing factor of 1.0. If measured utilization is available
          from an operations platform, adjust the factor deliberately and document the evidence in the exported design.
        </p>
      </section>

      <section className="panel source-note">
        <div>
          <h2>Source maintenance</h2>
          <p>Rules and management-plane content are generated from the supplied research workbook. Commercial values must be reverified before quotation.</p>
        </div>
        <a href="https://learn.microsoft.com/windows-server/virtualization/hyper-v/" target="_blank" rel="noreferrer" className="btn ghost link-btn">
          Microsoft Hyper-V documentation <ExternalLink size={14} />
        </a>
      </section>
    </div>
  )
}

function PlatformLimits() {
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const categories = ['All', ...Array.from(new Set(MANAGEMENT_WORKBOOK.platformLimits.map((item) => item.category)))]
  const normalizedQuery = query.trim().toLowerCase()
  const rows = MANAGEMENT_WORKBOOK.platformLimits.filter((item) => {
    if (category !== 'All' && item.category !== category) return false
    if (!normalizedQuery) return true
    return Object.values(item).some((value) => value.toLowerCase().includes(normalizedQuery))
  })
  const lastVerified = MANAGEMENT_WORKBOOK.platformLimits.reduce(
    (latest, item) => item.verified > latest ? item.verified : latest,
    '',
  )

  return (
    <div className="stack">
      <section className="panel platform-limits-intro">
        <div>
          <span className="matrix-category">Workbook-backed reference</span>
          <h2>Windows Server 2025 platform limits</h2>
          <p>These are supported maximums and published requirements—not recommended operating targets. Practical designs still need failure headroom, vendor-qualified hardware, and workload-specific validation.</p>
        </div>
        <div className="platform-limit-stats">
          <span><strong>{MANAGEMENT_WORKBOOK.platformLimits.length}</strong> verified entries</span>
          <span><strong>{categories.length - 1}</strong> categories</span>
          <span><strong>{lastVerified}</strong> last verified</span>
        </div>
      </section>

      <section className="panel">
        <div className="matrix-toolbar">
          <div>
            <h2>Limits and requirements</h2>
            <p className="small muted">Showing {rows.length} of {MANAGEMENT_WORKBOOK.platformLimits.length} entries generated from {MANAGEMENT_WORKBOOK.generatedFrom}.</p>
          </div>
          <label className="library-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search limits or notes" />
          </label>
          <label className="field compact-field">
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </label>
        </div>

        <div className="scroll platform-limits-table-wrap">
          <table className="platform-limits-table">
            <thead><tr><th>Capability / limit</th><th>Published value</th><th>Applies to</th><th>Basis</th><th>Qualification</th></tr></thead>
            <tbody>
              {rows.map((item) => (
                <tr key={`${item.category}-${item.scope}-${item.capability}`}>
                  <td><span className="matrix-category">{item.category}</span><strong>{item.capability}</strong><small>{item.scope}</small></td>
                  <td><strong className="platform-limit-value">{item.value}</strong></td>
                  <td>{item.appliesTo}</td>
                  <td><BasisPill basis={item.basis as 'MS' | 'MS-REC' | 'TOOL'} /><small>Verified {item.verified}</small></td>
                  <td>{item.note || 'No additional qualification.'}{item.source && <a href={item.source} target="_blank" rel="noreferrer">Open Microsoft source <ExternalLink size={12} /></a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
