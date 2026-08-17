import { ExternalLink } from 'lucide-react'
import { PageHeader } from '../components/Shared'

const rules = [
  ['MS', 'S2D clusters use a 2–16-node envelope; hybrid designs inherit the S2D ceiling.'],
  ['MS', 'Capacity reserve is one drive per server, capped at four drives across the pool.'],
  ['MS', 'Cache contributes no usable capacity and requires host memory for pool metadata.'],
  ['MS-REC', 'CSV count should distribute ownership evenly across the nodes.'],
  ['TOOL', 'vCPU-to-core ratios, host reserves, right-sizing factors, and recovery blast-radius limits are editable assumptions.'],
]

export default function MethodPage() {
  return (
    <>
      <PageHeader
        eyebrow="Trust and traceability"
        title="Sources and method"
        description="Understand how the calculations work, where vendor guidance stops, and which values are planning assumptions."
      />

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
              <span className={`pill ${basis === 'MS' ? 'ms' : basis === 'MS-REC' ? 'msrec' : 'tool'}`}>{basis}</span>
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
          <p>Rules and management-plane content were assembled from Microsoft product documentation and the supplied management-plane research workbook. Commercial values must be reverified before quotation.</p>
        </div>
        <a href="https://learn.microsoft.com/windows-server/virtualization/hyper-v/" target="_blank" rel="noreferrer" className="btn ghost link-btn">
          Microsoft Hyper-V documentation <ExternalLink size={14} />
        </a>
      </section>
    </>
  )
}
