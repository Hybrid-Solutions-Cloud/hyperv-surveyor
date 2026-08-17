import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Calculator,
  Check,
  CircleDollarSign,
  GitCompareArrows,
  RotateCcw,
  Route,
  ShieldAlert,
} from 'lucide-react'
import { compareArchitectures } from '../engine/solve'
import {
  calculatePlaneCost,
  type ManagementCostInputs,
} from '../engine/managementCost'
import { PageHeader } from '../components/Shared'
import { useSurveyorStore } from '../state/store'
import {
  CAPABILITIES,
  DECISION_QUESTIONS,
  MANAGEMENT_PLANES,
  PRICE_BOOK,
  recommendManagementPlane,
  type AdvisorAnswers,
} from '../data/managementPlane'

type AdvisorTab = 'recommend' | 'compare' | 'cost'
export default function ManagementPlanePage() {
  const [tab, setTab] = useState<AdvisorTab>('recommend')
  const { cfg, vms, tiers, chosenKey } = useSurveyorStore()
  const options = useMemo(() => compareArchitectures(cfg, vms, tiers), [cfg, vms, tiers])
  const chosen = options.find((option) => option.key === chosenKey) ?? options[0]
  const includedVms = vms.filter((vm) => vm.include).length

  return (
    <>
      <PageHeader
        eyebrow="Step 4 · Internal advisor"
        title="Management Plane Advisor"
        description="Turn the fabric requirements into an explainable operating-model recommendation, then compare capability and licensing impact."
      />

      <div className="advisor-context">
        <div><span>Selected design</span><strong>{chosen.label}</strong></div>
        <div><span>Calculated hosts</span><strong>{chosen.result.feasible ? chosen.result.nodes : 'Review design'}</strong></div>
        <div><span>Included workloads</span><strong>{includedVms.toLocaleString()} VMs</strong></div>
        <div className="advisor-freshness"><ShieldAlert size={16} /><span>Workbook content migrated for the first release · verify commercial terms before quoting</span></div>
      </div>

      <div className="subtabs" role="tablist" aria-label="Management Plane Advisor sections">
        <TabButton active={tab === 'recommend'} onClick={() => setTab('recommend')} icon={Route}>Recommendation</TabButton>
        <TabButton active={tab === 'compare'} onClick={() => setTab('compare')} icon={GitCompareArrows}>Capability comparison</TabButton>
        <TabButton active={tab === 'cost'} onClick={() => setTab('cost')} icon={CircleDollarSign}>Cost model</TabButton>
      </div>

      {tab === 'recommend' && <RecommendationPanel />}
      {tab === 'compare' && <ComparisonPanel />}
      {tab === 'cost' && (
        <CostPanel
          initialHosts={chosen.result.feasible ? chosen.result.nodes : 8}
          initialSockets={cfg.node.sockets}
          initialCoresPerSocket={cfg.node.coresPerSocket}
          initialVms={includedVms || 320}
          spareHosts={cfg.spareNodes}
        />
      )}
    </>
  )
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <button className={active ? 'subtab active' : 'subtab'} onClick={onClick} role="tab" aria-selected={active}>
      <Icon size={16} /> {children}
    </button>
  )
}

function RecommendationPanel() {
  const [answers, setAnswers] = useState<AdvisorAnswers>({})
  const recommendation = recommendManagementPlane(answers)
  const answered = Object.values(answers).filter((answer) => answer !== undefined).length

  return (
    <div className="advisor-layout">
      <section className="panel advisor-questions">
        <div className="panel-heading-row">
          <div>
            <h2>Qualifying questions</h2>
            <p className="small muted">Answer what is known. The recommendation updates immediately.</p>
          </div>
          <button className="btn ghost compact" onClick={() => setAnswers({})}><RotateCcw size={14} /> Reset</button>
        </div>

        <div className="progress-line"><i style={{ width: `${answered * 10}%` }} /></div>
        <div className="question-count">{answered} of {DECISION_QUESTIONS.length} answered</div>

        <div className="question-list">
          {DECISION_QUESTIONS.map((question, index) => (
            <article className="question-card" key={question.id}>
              <div className="question-number">{String(index + 1).padStart(2, '0')}</div>
              <div className="question-copy">
                <strong>{question.question}</strong>
                <span>{question.why}</span>
              </div>
              <div className="binary-choice" aria-label={question.question}>
                <button
                  className={answers[question.id] === true ? 'selected yes' : ''}
                  aria-pressed={answers[question.id] === true}
                  onClick={() => setAnswers({ ...answers, [question.id]: true })}
                >Yes</button>
                <button
                  className={answers[question.id] === false ? 'selected no' : ''}
                  aria-pressed={answers[question.id] === false}
                  onClick={() => setAnswers({ ...answers, [question.id]: false })}
                >No</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="recommendation-column">
        <section className="recommendation-card">
          <div className="recommendation-kicker"><Check size={16} /> Current recommendation</div>
          <h2>{recommendation.headline}</h2>

          {recommendation.stack.length > 0 && (
            <div className="stack-flow">
              {recommendation.stack.map((id, index) => {
                const plane = MANAGEMENT_PLANES.find((item) => item.id === id)!
                return (
                  <div className="stack-node" key={id}>
                    <span>{index === 0 ? 'Foundation' : id === 'arc-scvmm' ? 'Optional layer' : 'Day two'}</span>
                    <strong>{plane.shortName}</strong>
                  </div>
                )
              })}
            </div>
          )}

          <ul className="reason-list">
            {recommendation.rationale.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </section>

        {recommendation.cautions.length > 0 && (
          <section className="panel caution-panel">
            <h2><AlertTriangle size={16} /> Design cautions</h2>
            {recommendation.cautions.map((caution) => <p key={caution}>{caution}</p>)}
          </section>
        )}

        <section className="panel">
          <h2>Important framing</h2>
          <p className="small">
            Arc is additive to SCVMM, and WAC Administration Mode is commonly complementary to it.
            This advisor deliberately recommends a stack rather than forcing one winner.
          </p>
        </section>
      </aside>
    </div>
  )
}

function ComparisonPanel() {
  const [category, setCategory] = useState('All')
  const categories = ['All', ...Array.from(new Set(CAPABILITIES.map((row) => row.category)))]
  const rows = category === 'All' ? CAPABILITIES : CAPABILITIES.filter((row) => row.category === category)

  return (
    <div className="stack">
      <section className="plane-card-grid">
        {MANAGEMENT_PLANES.map((plane) => (
          <article className="plane-card" key={plane.id}>
            <div className={`plane-status ${plane.id === 'wac-virtual' ? 'preview' : ''}`}>{plane.status}</div>
            <h2>{plane.shortName}</h2>
            <p>{plane.role}</p>
            <dl>
              <div><dt>Best fit</dt><dd>{plane.bestFor}</dd></div>
              <div><dt>Watch for</dt><dd>{plane.watchFor}</dd></div>
            </dl>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="matrix-toolbar">
          <div>
            <h2>Priority capability matrix</h2>
            <p className="small muted">The first release focuses on the dimensions that most often eliminate an option.</p>
          </div>
          <label className="field compact-field">
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <div className="scroll" style={{ maxHeight: 'none' }}>
          <table className="matrix-table">
            <thead>
              <tr>
                <th>Capability</th>
                {MANAGEMENT_PLANES.map((plane) => <th key={plane.id}>{plane.shortName}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.capability}>
                  <td><span className="matrix-category">{row.category}</span><strong>{row.capability}</strong></td>
                  {MANAGEMENT_PLANES.map((plane) => (
                    <td key={plane.id}><CapabilityValue value={row.values[plane.id]} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function CapabilityValue({ value }: { value: string }) {
  const lower = value.toLowerCase()
  const tone = lower === 'full' || lower === 'yes' || lower === 'array-aware'
    ? 'good'
    : lower === 'none' || lower === 'no'
      ? 'none'
      : 'partial'
  return <span className={`capability-value ${tone}`}>{value}</span>
}

function CostPanel({
  initialHosts,
  initialSockets,
  initialCoresPerSocket,
  initialVms,
  spareHosts,
}: {
  initialHosts: number
  initialSockets: number
  initialCoresPerSocket: number
  initialVms: number
  spareHosts: number
}) {
  const [inputs, setInputs] = useState<ManagementCostInputs>({
    hosts: Math.max(1, initialHosts),
    sockets: initialSockets,
    coresPerSocket: initialCoresPerSocket,
    vms: initialVms,
    spareHosts,
    termYears: 3,
    sqlCores: 4,
    azurePerVmMonth: PRICE_BOOK.azureServicesPerVmMonth,
    model: 'perpetual',
  })

  const costs = MANAGEMENT_PLANES.map((plane) => ({ plane, ...calculatePlaneCost(plane.id, inputs) }))
  const licensableCoresPerHost = Math.max(inputs.sockets * inputs.coresPerSocket, inputs.sockets * 8, 16)

  const setNumber = (key: keyof ManagementCostInputs, value: number) => setInputs({ ...inputs, [key]: Math.max(0, value) })

  return (
    <div className="cost-layout">
      <section className="panel cost-inputs">
        <h2>Fabric and commercial assumptions</h2>
        <div className="license-toggle">
          <button className={inputs.model === 'perpetual' ? 'active' : ''} onClick={() => setInputs({ ...inputs, model: 'perpetual' })}>Perpetual + SA</button>
          <button className={inputs.model === 'spla' ? 'active' : ''} onClick={() => setInputs({ ...inputs, model: 'spla' })}>SPLA monthly</button>
        </div>

        <div className="form-grid two-column">
          <CostInput label="Physical hosts" value={inputs.hosts} onChange={(value) => setNumber('hosts', value)} />
          <CostInput label="Spare hosts" value={inputs.spareHosts} onChange={(value) => setNumber('spareHosts', value)} />
          <CostInput label="Sockets / host" value={inputs.sockets} onChange={(value) => setNumber('sockets', value)} />
          <CostInput label="Cores / socket" value={inputs.coresPerSocket} onChange={(value) => setNumber('coresPerSocket', value)} />
          <CostInput label="VMs in fabric" value={inputs.vms} onChange={(value) => setNumber('vms', value)} />
          <CostInput label="Term in years" value={inputs.termYears} onChange={(value) => setNumber('termYears', value)} />
          <CostInput label="SQL licensed cores" value={inputs.sqlCores} onChange={(value) => setNumber('sqlCores', value)} />
          <CostInput label="Arc services / VM / month" value={inputs.azurePerVmMonth} step={0.1} onChange={(value) => setNumber('azurePerVmMonth', value)} />
        </div>

        <div className="note">
          <strong>{licensableCoresPerHost} licensable cores per host</strong>
          Applies the 16-core-per-server and 8-core-per-socket licensing floors.
        </div>
        <div className="note warn">
          <strong>Planning estimate only</strong>
          SPLA values and Azure consumption vary by agreement, region, enabled services, and date. Obtain written commercial pricing before customer use.
        </div>
      </section>

      <section className="panel cost-results">
        <div className="panel-heading-row">
          <div>
            <h2>{inputs.model === 'perpetual' ? 'Perpetual + Software Assurance' : 'SPLA'} comparison</h2>
            <p className="small muted">Windows Server is included in every total so the effective VM cost stays comparable.</p>
          </div>
          <Calculator size={22} />
        </div>

        <div className="cost-card-grid">
          {costs.map(({ plane, total, managementOnly, perVmMonth }) => (
            <article className={`cost-card ${plane.id === 'scvmm' ? 'recommended' : ''}`} key={plane.id}>
              {plane.id === 'scvmm' && <span className="recommended-tag">Core fabric baseline</span>}
              <h3>{plane.shortName}</h3>
              <strong className="cost-total">{money(total)}</strong>
              <span>over {inputs.termYears} year{inputs.termYears === 1 ? '' : 's'}</span>
              <div className="cost-breakdown">
                <div><span>Management layer</span><strong>{money(managementOnly)}</strong></div>
                <div><span>Per VM / month</span><strong>{money(perVmMonth)}</strong></div>
              </div>
            </article>
          ))}
        </div>

        <div className="price-basis">
          <h3>Current model basis</h3>
          <div className="price-basis-grid">
            <span>Windows DC / 2 cores<strong>{inputs.model === 'perpetual' ? money(PRICE_BOOK.windowsPerTwoCorePack) : `${money(PRICE_BOOK.windowsSplaPerTwoCorePackMonth)}/mo`}</strong></span>
            <span>System Center DC / 2 cores<strong>{inputs.model === 'perpetual' ? money(PRICE_BOOK.systemCenterPerTwoCorePack) : `${money(PRICE_BOOK.systemCenterSplaPerTwoCorePackMonth)}/mo`}</strong></span>
            <span>SQL Standard / core<strong>{money(PRICE_BOOK.sqlStandardPerCore)}</strong></span>
            <span>Annual SA assumption<strong>{(PRICE_BOOK.softwareAssuranceAnnualRate * 100).toFixed(0)}%</strong></span>
          </div>
        </div>
      </section>
    </div>
  )
}

function CostInput({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (value: number) => void; step?: number }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} min={0} step={step} onChange={(event) => onChange(Number(event.target.value) || 0)} />
    </label>
  )
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 100 ? 2 : 0,
  }).format(value)
}
