import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  Check,
  CircleDollarSign,
  Database,
  GitCompareArrows,
  MessagesSquare,
  RotateCcw,
  Route,
  Search,
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
import { MANAGEMENT_WORKBOOK } from '../data/managementWorkbook.generated'

type AdvisorTab = 'recommend' | 'compare' | 'cost' | 'vmware' | 'field' | 'sources'
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
        <div className="advisor-freshness"><ShieldAlert size={16} /><span>Full advisor library generated from the supplied workbook · verify commercial terms before quoting</span></div>
      </div>

      <div className="subtabs" role="tablist" aria-label="Management Plane Advisor sections">
        <TabButton active={tab === 'recommend'} onClick={() => setTab('recommend')} icon={Route}>Recommendation</TabButton>
        <TabButton active={tab === 'compare'} onClick={() => setTab('compare')} icon={GitCompareArrows}>Capability comparison</TabButton>
        <TabButton active={tab === 'cost'} onClick={() => setTab('cost')} icon={CircleDollarSign}>Cost model</TabButton>
        <TabButton active={tab === 'vmware'} onClick={() => setTab('vmware')} icon={BookOpen}>VMware translation</TabButton>
        <TabButton active={tab === 'field'} onClick={() => setTab('field')} icon={MessagesSquare}>Field guide</TabButton>
        <TabButton active={tab === 'sources'} onClick={() => setTab('sources')} icon={Database}>Sources & SKUs</TabButton>
      </div>

      {tab === 'recommend' && <RecommendationPanel />}
      {tab === 'compare' && <ComparisonPanel />}
      {tab === 'vmware' && <VmwarePanel />}
      {tab === 'field' && <FieldGuidePanel />}
      {tab === 'sources' && <SourcesPanel />}
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
                {answers[question.id] !== undefined && (
                  <div className={`question-outcome ${answers[question.id] ? 'yes' : 'no'}`}>
                    <b>{answers[question.id] ? 'If yes' : 'If no'}</b>
                    {answers[question.id] ? question.ifYes : question.ifNo}
                  </div>
                )}
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
  const [query, setQuery] = useState('')
  const categories = ['All', ...Array.from(new Set(CAPABILITIES.map((row) => row.category)))]
  const normalizedQuery = query.trim().toLowerCase()
  const rows = CAPABILITIES.filter((row) => {
    if (category !== 'All' && row.category !== category) return false
    if (!normalizedQuery) return true
    return [row.category, row.capability, row.note, row.vmwareVsphere8, row.vmwareVcf9, ...Object.values(row.values)]
      .some((value) => value.toLowerCase().includes(normalizedQuery))
  })

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
            <h2>Full capability matrix</h2>
            <p className="small muted">Showing {rows.length} of {CAPABILITIES.length} workbook dimensions across all five management planes.</p>
          </div>
          <SearchField value={query} onChange={setQuery} placeholder="Search capabilities or notes" />
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
                <th>vSphere 8 analogue</th>
                <th>VCF 9 analogue</th>
                <th>Why it matters</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.capability}>
                  <td><span className="matrix-category">{row.category}</span><strong>{row.capability}</strong></td>
                  {MANAGEMENT_PLANES.map((plane) => (
                    <td key={plane.id}><CapabilityValue value={row.values[plane.id]} /></td>
                  ))}
                  <td>{row.vmwareVsphere8}</td>
                  <td>{row.vmwareVcf9}</td>
                  <td className="matrix-note">{row.note}</td>
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
  const tone = lower.startsWith('full') || lower === 'yes' || lower === 'array-aware'
    ? 'good'
    : lower === 'none' || lower === 'no'
      ? 'none'
      : 'partial'
  return <span className={`capability-value ${tone}`}>{value}</span>
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="library-search">
      <Search size={15} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  )
}

function VmwarePanel() {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const rows = MANAGEMENT_WORKBOOK.vmwareTranslation.filter((row) => (
    !normalizedQuery || Object.values(row).some((value) => value.toLowerCase().includes(normalizedQuery))
  ))

  return (
    <section className="panel">
      <div className="matrix-toolbar">
        <div>
          <h2>VMware → Hyper-V translation</h2>
          <p className="small muted">Showing {rows.length} of {MANAGEMENT_WORKBOOK.vmwareTranslation.length} mappings, including honest fidelity gaps.</p>
        </div>
        <SearchField value={query} onChange={setQuery} placeholder="Search VMware or Hyper-V terms" />
      </div>
      <div className="scroll library-table-wrap">
        <table className="library-table">
          <thead><tr><th>VMware concept</th><th>Hyper-V equivalent</th><th>Fidelity</th><th>Operator note</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.vmware}>
                <td><strong>{row.vmware}</strong></td>
                <td>{row.hyperv}</td>
                <td><span className={`fidelity fidelity-${row.fidelity.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{row.fidelity}</span></td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

type FieldSection = 'decisions' | 'advantages' | 'objections' | 'guardrails'

function FieldGuidePanel() {
  const [section, setSection] = useState<FieldSection>('decisions')

  return (
    <div className="stack">
      <div className="subtabs compact-subtabs" role="tablist" aria-label="Field guide sections">
        <button className={section === 'decisions' ? 'subtab active' : 'subtab'} onClick={() => setSection('decisions')}>Decision patterns</button>
        <button className={section === 'advantages' ? 'subtab active' : 'subtab'} onClick={() => setSection('advantages')}>Defensible advantages</button>
        <button className={section === 'objections' ? 'subtab active' : 'subtab'} onClick={() => setSection('objections')}>Objection handling</button>
        <button className={section === 'guardrails' ? 'subtab active' : 'subtab'} onClick={() => setSection('guardrails')}>Claims & honest losses</button>
      </div>

      {section === 'decisions' && (
        <>
          <section className="panel">
            <h2>Common decision patterns</h2>
            <div className="library-card-grid">
              {MANAGEMENT_WORKBOOK.decisionPatterns.map((item) => (
                <article className="library-card" key={item.situation}>
                  <span className="matrix-category">Situation</span>
                  <h3>{item.situation}</h3>
                  <strong>{item.answer}</strong>
                  <p>{item.because}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Pros, cons, and walk-away conditions</h2>
            <div className="plane-guide-list">
              {MANAGEMENT_WORKBOOK.planeGuides.map((item) => (
                <details className="library-details" key={item.plane}>
                  <summary>{item.plane}</summary>
                  <div className="detail-columns">
                    <div><h4>Pros</h4><p className="preserve-lines">{item.pros}</p></div>
                    <div><h4>Cons</h4><p className="preserve-lines">{item.cons}</p></div>
                    <div><h4>Pick it when</h4><p>{item.pickWhen}</p></div>
                    <div><h4>Walk away when</h4><p>{item.walkAwayWhen}</p></div>
                  </div>
                </details>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Things that are not a choice</h2>
            <div className="callout-list">
              {MANAGEMENT_WORKBOOK.decisionCautions.map((item) => (
                <article className="note warn" key={item.statement}><strong>{item.statement}</strong>{item.explanation}</article>
              ))}
            </div>
          </section>
        </>
      )}

      {section === 'advantages' && (
        <section className="panel">
          <h2>Where Hyper-V genuinely wins</h2>
          <p className="small muted">The evidence and usage guidance are retained so claims stay defensible.</p>
          <div className="library-card-grid">
            {MANAGEMENT_WORKBOOK.advantages.map((item) => (
              <article className="library-card" key={item.claim}>
                <div className="card-meta"><span>{item.area}</span><b>{item.strength}</b></div>
                <h3>{item.claim}</h3>
                <h4>Evidence</h4><p>{item.evidence}</p>
                <h4>How to use it</h4><p>{item.guidance}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {section === 'objections' && (
        <section className="panel">
          <h2>Objection handling for VMware-native customers</h2>
          <div className="objection-list">
            {MANAGEMENT_WORKBOOK.objections.map((item) => (
              <details className="library-details" key={item.objection}>
                <summary><span>{item.objection}</span><b>{item.verdict}</b></summary>
                <div className="detail-columns two">
                  <div><h4>Factual answer</h4><p>{item.answer}</p></div>
                  <div><h4>Concede first</h4><p>{item.concede}</p></div>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {section === 'guardrails' && (
        <div className="two-panel-grid">
          <section className="panel">
            <h2>Do not claim these</h2>
            <div className="callout-list">
              {MANAGEMENT_WORKBOOK.doNotClaim.map((item) => (
                <article className="note danger-note" key={item.claim}><strong>{item.claim}</strong>{item.whyWrong}</article>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>The honest losses</h2>
            <div className="callout-list">
              {MANAGEMENT_WORKBOOK.honestLosses.map((item) => (
                <article className="note warn" key={item.area}><strong>{item.area}</strong>{item.detail}</article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

type ReferenceSection = 'sources' | 'skus'

function SourcesPanel() {
  const [section, setSection] = useState<ReferenceSection>('sources')
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const sources = MANAGEMENT_WORKBOOK.sources.filter((row) => !normalizedQuery || Object.values(row).some((value) => value.toLowerCase().includes(normalizedQuery)))
  const skus = MANAGEMENT_WORKBOOK.skuReference.filter((row) => !normalizedQuery || Object.values(row).some((value) => value.toLowerCase().includes(normalizedQuery)))

  return (
    <div className="stack">
      <section className="panel">
        <div className="matrix-toolbar">
          <div>
            <h2>Workbook evidence library</h2>
            <p className="small muted">Generated from {MANAGEMENT_WORKBOOK.generatedFrom}; commercial terms still require revalidation before quoting.</p>
          </div>
          <SearchField value={query} onChange={setQuery} placeholder="Search sources or SKUs" />
          <div className="license-toggle">
            <button className={section === 'sources' ? 'active' : ''} onClick={() => setSection('sources')}>Sources</button>
            <button className={section === 'skus' ? 'active' : ''} onClick={() => setSection('skus')}>SKU catalog</button>
          </div>
        </div>

        {section === 'sources' ? (
          <div className="source-list">
            {sources.map((item) => (
              <article className="source-row" key={item.topic}>
                <div><strong>{item.topic}</strong><p>{item.finding}</p></div>
                {item.source && <a href={item.source} target="_blank" rel="noreferrer">Open source</a>}
              </article>
            ))}
          </div>
        ) : (
          <div className="scroll library-table-wrap">
            <table className="library-table">
              <thead><tr><th>Ref</th><th>Product</th><th>Channel / unit</th><th>Price</th><th>Confidence</th><th>Rule / note</th><th>Source</th></tr></thead>
              <tbody>
                {skus.map((item) => (
                  <tr key={item.ref}>
                    <td><strong>{item.ref}</strong></td><td>{item.product}<small>{item.edition}</small></td>
                    <td>{item.channel}<small>{item.unit}</small></td><td>{item.price}</td><td>{item.confidence}<small>{item.priceDate}</small></td>
                    <td>{item.note}</td><td>{item.source && <a href={item.source} target="_blank" rel="noreferrer">Source</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {section === 'sources' && (
        <section className="panel">
          <h2>Caveats before customer use</h2>
          <div className="callout-list caveat-grid">
            {MANAGEMENT_WORKBOOK.caveats.map((item) => <article className="note warn" key={item.topic}><strong>{item.topic}</strong>{item.detail}</article>)}
          </div>
        </section>
      )}
    </div>
  )
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
    waiveUpdateAndGuest: true,
    includeUpdateManager: true,
    includeDefenderP2: true,
    includeGuestConfig: true,
    includeLogAnalytics: true,
    logAnalyticsGbPerVm: 2,
    model: 'perpetual',
  })

  const costs = MANAGEMENT_PLANES.map((plane) => ({ plane, ...calculatePlaneCost(plane.id, inputs) }))
  const licensableCoresPerHost = Math.max(inputs.sockets * inputs.coresPerSocket, inputs.sockets * 8, 16)
  const months = Math.max(1, inputs.termYears * 12)
  const effectiveVms = costs[0].effectiveVms
  const arcCost = costs.find((item) => item.plane.id === 'arc-scvmm')!
  const windowsPaygReference = inputs.hosts * licensableCoresPerHost * PRICE_BOOK.windowsPaygPerCoreMonth * months
  const azureLocalReference = inputs.hosts * licensableCoresPerHost * PRICE_BOOK.azureLocalPerCoreMonth * months

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
          <CostInput label="Log Analytics GB / VM / month" value={inputs.logAnalyticsGbPerVm} step={0.1} onChange={(value) => setNumber('logAnalyticsGbPerVm', value)} />
        </div>

        <h3>Arc metered services</h3>
        <div className="meter-toggles">
          <CostToggle label={`Update Manager · ${money(PRICE_BOOK.updateManagerPerVmMonth)}/VM/mo`} checked={inputs.includeUpdateManager} onChange={(checked) => setInputs({ ...inputs, includeUpdateManager: checked })} />
          <CostToggle label={`Defender for Servers P2 · ${money(PRICE_BOOK.defenderP2PerVmMonth)}/VM/mo`} checked={inputs.includeDefenderP2} onChange={(checked) => setInputs({ ...inputs, includeDefenderP2: checked })} />
          <CostToggle label={`Guest Config + Change Tracking · ${money(PRICE_BOOK.guestConfigPerVmMonth)}/VM/mo`} checked={inputs.includeGuestConfig} onChange={(checked) => setInputs({ ...inputs, includeGuestConfig: checked })} />
          <CostToggle label={`Log Analytics · ${money(PRICE_BOOK.logAnalyticsPerGb)}/GB`} checked={inputs.includeLogAnalytics} onChange={(checked) => setInputs({ ...inputs, includeLogAnalytics: checked })} />
          <CostToggle label="Waive Update Manager + Guest Config with qualifying entitlement" checked={inputs.waiveUpdateAndGuest} onChange={(checked) => setInputs({ ...inputs, waiveUpdateAndGuest: checked })} />
        </div>

        <div className="note">
          <strong>{licensableCoresPerHost} licensable cores per host</strong>
          Applies the 16-core-per-server and 8-core-per-socket licensing floors.
        </div>
        <div className="note">
          <strong>{Math.round(effectiveVms).toLocaleString()} effective workload VMs after N+{inputs.spareHosts}</strong>
          Per-VM totals use workload-bearing hosts as the denominator; Azure meters still apply to all {inputs.vms.toLocaleString()} managed VMs.
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
          {costs.map(({ plane, total, managementOnly, perVmMonth, azure }) => (
            <article className={`cost-card ${plane.id === 'scvmm' ? 'recommended' : ''}`} key={plane.id}>
              {plane.id === 'scvmm' && <span className="recommended-tag">Core fabric baseline</span>}
              <h3>{plane.shortName}</h3>
              <strong className="cost-total">{money(total)}</strong>
              <span>over {inputs.termYears} year{inputs.termYears === 1 ? '' : 's'}</span>
              <div className="cost-breakdown">
                <div><span>Management layer</span><strong>{money(managementOnly)}</strong></div>
                {plane.id === 'arc-scvmm' && <div><span>Azure services</span><strong>{money(azure)}</strong></div>}
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
            <span>Arc meters / VM / month<strong>{money(arcCost.azurePerVmMonth)}</strong></span>
            <span>Log Analytics volume<strong>{inputs.logAnalyticsGbPerVm.toFixed(1)} GB / VM / month</strong></span>
          </div>
        </div>

        <div className="alternative-costs">
          <h3>Alternative licensing references — excluded from totals</h3>
          <div><span>Windows Server pay-as-you-go via Arc</span><strong>{money(windowsPaygReference)}</strong><small>over the selected term; no core minimum and AVMA is unavailable</small></div>
          <div><span>Azure Local host service equivalent</span><strong>{money(azureLocalReference)}</strong><small>reference only; Azure Hybrid Benefit and storage topology rules can change applicability</small></div>
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

function CostToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="cost-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 100 ? 2 : 0,
  }).format(value)
}
