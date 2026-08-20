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
  ServerCog,
  ShieldAlert,
} from 'lucide-react'
import { compareArchitectures, solveForward, type ArchitectureOption } from '../engine/solve'
import {
  deploymentComponentsToVms,
  deploymentInputsFromStack,
  planManagementDeployment,
  type ManagementDeploymentInputs,
} from '../engine/managementDeployment'
import {
  calculatePlaneCost,
  calculateProviderEconomics,
  DEFAULT_MANAGEMENT_RATE_CARD,
  type CommercialInputs,
  type ManagementCostInputs,
  type ManagementRateCard,
} from '../engine/managementCost'
import { BasisPill, Field, NumberInput, PageHeader } from '../components/Shared'
import { useSurveyorStore } from '../state/store'
import {
  CAPABILITIES,
  DECISION_QUESTIONS,
  MANAGEMENT_PLANES,
  PRICE_BOOK,
  recommendManagementPlane,
  type AdvisorAnswers,
  type PlaneId,
} from '../data/managementPlane'
import { MANAGEMENT_WORKBOOK } from '../data/managementWorkbook.generated'
import type { TierId, TierPolicy, Vm } from '../engine/types'

type AdvisorTab = 'recommend' | 'deploy' | 'compare' | 'cost' | 'vmware' | 'field' | 'sources'
export default function ManagementPlanePage() {
  const [tab, setTab] = useState<AdvisorTab>('recommend')
  const [answers, setAnswers] = useState<AdvisorAnswers>({})
  const { cfg, vms, tiers, chosenKey } = useSurveyorStore()
  const options = useMemo(() => compareArchitectures(cfg, vms, tiers), [cfg, vms, tiers])
  const chosen = options.find((option) => option.key === chosenKey) ?? options[0]
  const includedVms = vms.filter((vm) => vm.include).length
  const recommendation = recommendManagementPlane(answers)

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
        <TabButton active={tab === 'deploy'} onClick={() => setTab('deploy')} icon={ServerCog}>Deployment design</TabButton>
        <TabButton active={tab === 'compare'} onClick={() => setTab('compare')} icon={GitCompareArrows}>Capability comparison</TabButton>
        <TabButton active={tab === 'cost'} onClick={() => setTab('cost')} icon={CircleDollarSign}>Cost model</TabButton>
        <TabButton active={tab === 'vmware'} onClick={() => setTab('vmware')} icon={BookOpen}>VMware translation</TabButton>
        <TabButton active={tab === 'field'} onClick={() => setTab('field')} icon={MessagesSquare}>Field guide</TabButton>
        <TabButton active={tab === 'sources'} onClick={() => setTab('sources')} icon={Database}>Sources & SKUs</TabButton>
      </div>

      {tab === 'recommend' && <RecommendationPanel answers={answers} setAnswers={setAnswers} />}
      {tab === 'deploy' && (
        <DeploymentDesignerPanel
          recommendationStack={recommendation.stack}
          chosen={chosen}
          vms={vms}
          tiers={tiers}
        />
      )}
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

function RecommendationPanel({
  answers,
  setAnswers,
}: {
  answers: AdvisorAnswers
  setAnswers: (answers: AdvisorAnswers) => void
}) {
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
            Prefer WAC vMode where its readiness and capability coverage fit. Keep aMode as the
            production fallback for current gaps, and treat Arc as an additive layer over SCVMM.
            This advisor recommends a stack rather than forcing one winner.
          </p>
        </section>
      </aside>
    </div>
  )
}

function DeploymentDesignerPanel({
  recommendationStack,
  chosen,
  vms,
  tiers,
}: {
  recommendationStack: PlaneId[]
  chosen: ArchitectureOption
  vms: Vm[]
  tiers: Record<TierId, TierPolicy>
}) {
  const includedVms = vms.filter((vm) => vm.include).length
  const suggestedStack: PlaneId[] = recommendationStack.length > 0
    ? recommendationStack
    : chosen.result.nodes <= 4
      ? ['classic', 'wac-admin']
      : ['scvmm', 'wac-admin']
  const makeSuggestedInputs = () => deploymentInputsFromStack(
    suggestedStack,
    chosen.result.feasible ? chosen.result.nodes : 0,
    includedVms,
  )
  const [inputs, setInputs] = useState<ManagementDeploymentInputs>(makeSuggestedInputs)
  const [includeInSizing, setIncludeInSizing] = useState(true)
  const plan = useMemo(() => planManagementDeployment(inputs), [inputs])
  const managementVms = useMemo(() => deploymentComponentsToVms(plan.components), [plan.components])
  const adjusted = useMemo(
    () => includeInSizing ? solveForward(chosen.cfg, [...vms, ...managementVms], tiers) : chosen.result,
    [chosen, includeInSizing, managementVms, tiers, vms],
  )
  const hostDelta = adjusted.feasible && chosen.result.feasible ? adjusted.nodes - chosen.result.nodes : null

  const setNumber = (key: keyof ManagementDeploymentInputs, value: number) => {
    setInputs({ ...inputs, [key]: Math.max(0, value) })
  }

  return (
    <div className="deployment-layout">
      <aside className="panel deployment-inputs">
        <div className="panel-heading-row">
          <div>
            <h2>Deployment choices</h2>
            <p className="small muted">The advisor supplies the starting stack. Every choice remains editable.</p>
          </div>
          <button className="btn ghost compact" onClick={() => setInputs(makeSuggestedInputs())}>
            <RotateCcw size={14} /> Use advisor
          </button>
        </div>

        <label className="field">
          <span>Fabric foundation</span>
          <div className="license-toggle deployment-choice-toggle">
            <button
              className={inputs.foundation === 'classic' ? 'active' : ''}
              onClick={() => setInputs({ ...inputs, foundation: 'classic', includeArc: false })}
              type="button"
            >Classic</button>
            <button
              className={inputs.foundation === 'scvmm' ? 'active' : ''}
              onClick={() => setInputs({ ...inputs, foundation: 'scvmm' })}
              type="button"
            >SCVMM 2025</button>
          </div>
        </label>

        <Field label="Windows Admin Center experience">
          <select value={inputs.wac} onChange={(event) => setInputs({ ...inputs, wac: event.target.value as ManagementDeploymentInputs['wac'] })}>
            <option value="none">None</option>
            <option value="wac-admin">Administration Mode</option>
            <option value="wac-virtual">Virtualization Mode (preview)</option>
          </select>
        </Field>

        <div className="meter-toggles deployment-toggles">
          <CostToggle label="Highly available management plane" checked={inputs.highAvailability} onChange={(checked) => setInputs({ ...inputs, highAvailability: checked })} />
          <CostToggle label="Add Azure Arc-enabled SCVMM" checked={inputs.includeArc} onChange={(checked) => setInputs({ ...inputs, includeArc: checked })} />
          <CostToggle label="Add dedicated AD DS / DNS VMs" checked={inputs.includeIdentityServices} onChange={(checked) => setInputs({ ...inputs, includeIdentityServices: checked })} />
          <CostToggle label="Include management VMs in host sizing" checked={includeInSizing} onChange={setIncludeInSizing} />
        </div>
        {inputs.foundation !== 'scvmm' && inputs.includeArc && (
          <div className="note warn">Arc-enabled SCVMM requires SCVMM as the fabric foundation.</div>
        )}

        <div className="form-grid two-column deployment-scale-inputs">
          <Field label="Managed hosts">
            <NumberInput value={inputs.managedHosts} min={0} onChange={(value) => setNumber('managedHosts', value)} />
          </Field>
          <Field label="Managed workload VMs">
            <NumberInput value={inputs.managedVms} min={0} onChange={(value) => setNumber('managedVms', value)} />
          </Field>
          <Field label="Managed clusters">
            <NumberInput value={inputs.managedClusters} min={1} onChange={(value) => setNumber('managedClusters', value)} />
          </Field>
          <Field label="Library content (GiB)">
            <NumberInput value={inputs.libraryContentGiB} min={100} step={100} onChange={(value) => setNumber('libraryContentGiB', value)} />
          </Field>
        </div>

        <div className="deployment-basis-note">
          <BasisPill basis="MS" /> published requirement
          <BasisPill basis="MS-REC" /> published recommendation
          <BasisPill basis="TOOL" /> visible Surveyor planning profile
        </div>
      </aside>

      <div className="deployment-results stack">
        <section className="panel deployment-summary">
          <div className="panel-heading-row">
            <div>
              <span className="matrix-category">Calculated management footprint</span>
              <h2>{plan.scaleLabel}</h2>
              <p className="small muted">Sized for {inputs.managedHosts.toLocaleString()} hosts, {inputs.managedVms.toLocaleString()} workload VMs, and {inputs.managedClusters.toLocaleString()} clusters.</p>
            </div>
            <div className={`deployment-impact ${hostDelta !== null && hostDelta > 0 ? 'changed' : ''}`}>
              <span>Host sizing impact</span>
              <strong>{adjusted.feasible ? `${chosen.result.nodes} → ${adjusted.nodes}` : 'Review design'}</strong>
              <small>{!includeInSizing ? 'Management overhead excluded' : hostDelta === null ? 'Could not compare' : hostDelta > 0 ? `Adds ${hostDelta} host${hostDelta === 1 ? '' : 's'}` : 'No additional hosts'}</small>
            </div>
          </div>

          <div className="deployment-kpis">
            <article><span>VM instances</span><strong>{plan.totalInstances}</strong><small>Management components</small></article>
            <article><span>Total vCPU</span><strong>{plan.totalVCpu.toLocaleString()}</strong><small>Allocated</small></article>
            <article><span>Total memory</span><strong>{plan.totalRamGiB.toLocaleString()} GiB</strong><small>Allocated</small></article>
            <article><span>Total disk</span><strong>{plan.totalDiskGiB.toLocaleString()} GiB</strong><small>Provisioned</small></article>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading-row">
            <div>
              <h2>Management-plane bill of materials</h2>
              <p className="small muted">VM size is shown per instance; totals multiply by quantity.</p>
            </div>
          </div>
          {plan.components.length === 0 ? (
            <div className="note">No dedicated management VM is required for the selected Classic-only stack.</div>
          ) : (
            <div className="scroll deployment-table-wrap">
              <table className="deployment-table">
                <thead><tr><th>Component</th><th>Qty</th><th>Availability</th><th>VM size each</th><th>Operating system / licensing</th><th>Basis</th></tr></thead>
                <tbody>
                  {plan.components.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.name}</strong><small>{item.role}</small></td>
                      <td><strong>{item.count}</strong></td>
                      <td>{item.availability}</td>
                      <td>{item.resourceType === 'vm'
                        ? <><strong>{item.vCpu} vCPU</strong><small>{item.ramGiB} GiB RAM · {item.diskGiB.toLocaleString()} GiB disk</small></>
                        : <><strong>{item.diskGiB.toLocaleString()} GiB</strong><small>Shared storage capacity</small></>}</td>
                      <td>{item.operatingSystem}<small>{item.licensing}</small></td>
                      <td>
                        <BasisPill basis={item.basis} />
                        <small>{item.basisDetail}</small>
                        {item.source && <a href={item.source} target="_blank" rel="noreferrer">Microsoft source</a>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="two-panel-grid">
          <section className="panel">
            <h2>Required dependencies</h2>
            {plan.dependencies.length > 0
              ? <ul className="deployment-list">{plan.dependencies.map((item) => <li key={item}>{item}</li>)}</ul>
              : <p className="small muted">No external dependencies were added.</p>}
          </section>
          <section className="panel">
            <h2>Design cautions</h2>
            {plan.cautions.length > 0
              ? <ul className="deployment-list cautions">{plan.cautions.map((item) => <li key={item}>{item}</li>)}</ul>
              : <p className="small muted">No scale or topology cautions for the current selections.</p>}
          </section>
        </div>
      </div>
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
    model: 'spla',
  })
  const [selectedPlane, setSelectedPlane] = useState<PlaneId>('scvmm')
  const [rateCard, setRateCard] = useState<ManagementRateCard>({ ...DEFAULT_MANAGEMENT_RATE_CARD })
  const [commercial, setCommercial] = useState<CommercialInputs>({
    motion: 'msp',
    tenantCount: 8,
    rdsUsers: 0,
    microsoftDiscountPct: 0,
    licenseMarkupPct: 8,
    azureMarkupPct: 8,
    onboardingDeliveryCostPerTenant: 1_500,
    onboardingFeePerTenant: 3_000,
    monthlyPlatformFeePerTenant: 1_000,
    monthlyManagedFeePerVm: 55,
    monthlyOpsCostPerVm: 18,
    monthlySharedOpsCost: 2_500,
    targetGrossMarginPct: 35,
    useLighthouse: true,
  })

  const costs = MANAGEMENT_PLANES.map((plane) => ({ plane, ...calculatePlaneCost(plane.id, inputs, rateCard) }))
  const licensableCoresPerHost = Math.max(inputs.sockets * inputs.coresPerSocket, inputs.sockets * 8, 16)
  const months = Math.max(1, inputs.termYears * 12)
  const effectiveVms = costs[0].effectiveVms
  const arcCost = costs.find((item) => item.plane.id === 'arc-scvmm')!
  const selectedCost = costs.find((item) => item.plane.id === selectedPlane) ?? costs[1]
  const economics = calculateProviderEconomics(selectedPlane, selectedCost, inputs, commercial, rateCard)
  const windowsPaygReference = inputs.hosts * licensableCoresPerHost * PRICE_BOOK.windowsPaygPerCoreMonth * months
  const azureLocalReference = inputs.hosts * licensableCoresPerHost * PRICE_BOOK.azureLocalPerCoreMonth * months

  const setNumber = (key: keyof ManagementCostInputs, value: number) => setInputs({ ...inputs, [key]: Math.max(0, value) })
  const setCommercialNumber = (key: keyof CommercialInputs, value: number) => {
    const nonNegative = Math.max(0, value)
    const normalized = key === 'tenantCount'
      ? Math.max(1, nonNegative)
      : key === 'microsoftDiscountPct'
        ? Math.min(100, nonNegative)
        : key === 'targetGrossMarginPct'
          ? Math.min(95, nonNegative)
          : nonNegative
    setCommercial({ ...commercial, [key]: normalized })
  }
  const setRate = (key: keyof ManagementRateCard, value: number) => setRateCard({ ...rateCard, [key]: Math.max(0, value) })
  const isCommercial = commercial.motion !== 'internal'

  return (
    <div className="cost-layout">
      <section className="panel cost-inputs">
        <h2>Commercial route</h2>
        <div className="license-toggle commercial-toggle">
          <button className={commercial.motion === 'internal' ? 'active' : ''} onClick={() => setCommercial({ ...commercial, motion: 'internal' })}>Internal TCO</button>
          <button className={commercial.motion === 'csp' ? 'active' : ''} onClick={() => setCommercial({ ...commercial, motion: 'csp' })}>CSP managed customer</button>
          <button className={commercial.motion === 'msp' ? 'active' : ''} onClick={() => setCommercial({ ...commercial, motion: 'msp' })}>MSP hosted platform</button>
        </div>
        <p className="small muted commercial-explainer">
          {commercial.motion === 'internal' && 'Customer revenue is excluded. Use this view for internal platform TCO and allocation.'}
          {commercial.motion === 'csp' && 'Customer owns the subscriptions or Azure consumption; model resale margin plus managed services.'}
          {commercial.motion === 'msp' && 'The provider owns the hosted-platform COGS; customer revenue comes from service and platform fees.'}
        </p>

        <h3>Licensing basis</h3>
        <div className="license-toggle">
          <button className={inputs.model === 'perpetual' ? 'active' : ''} onClick={() => setInputs({ ...inputs, model: 'perpetual' })}>Perpetual + SA</button>
          <button className={inputs.model === 'spla' ? 'active' : ''} onClick={() => setInputs({ ...inputs, model: 'spla' })}>SPLA monthly</button>
        </div>

        <h3>Fabric demand</h3>
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

        <h3>Customer and delivery economics</h3>
        <div className="form-grid two-column">
          <CostInput label="Customer tenants" value={commercial.tenantCount} onChange={(value) => setCommercialNumber('tenantCount', value)} />
          <CostInput label="RDS users / subscribers" value={commercial.rdsUsers} onChange={(value) => setCommercialNumber('rdsUsers', value)} />
          <CostInput label="Microsoft discount %" value={commercial.microsoftDiscountPct} step={0.1} onChange={(value) => setCommercialNumber('microsoftDiscountPct', value)} />
          <CostInput label="Target gross margin %" value={commercial.targetGrossMarginPct} step={0.1} onChange={(value) => setCommercialNumber('targetGrossMarginPct', value)} />
          <CostInput label="Onboarding cost / tenant" value={commercial.onboardingDeliveryCostPerTenant} onChange={(value) => setCommercialNumber('onboardingDeliveryCostPerTenant', value)} />
          <CostInput label="Onboarding fee / tenant" value={commercial.onboardingFeePerTenant} onChange={(value) => setCommercialNumber('onboardingFeePerTenant', value)} />
          <CostInput label="Platform fee / tenant / mo" value={commercial.monthlyPlatformFeePerTenant} onChange={(value) => setCommercialNumber('monthlyPlatformFeePerTenant', value)} />
          <CostInput label="Managed service / VM / mo" value={commercial.monthlyManagedFeePerVm} onChange={(value) => setCommercialNumber('monthlyManagedFeePerVm', value)} />
          <CostInput label="Operations cost / VM / mo" value={commercial.monthlyOpsCostPerVm} onChange={(value) => setCommercialNumber('monthlyOpsCostPerVm', value)} />
          <CostInput label="Shared operations cost / mo" value={commercial.monthlySharedOpsCost} onChange={(value) => setCommercialNumber('monthlySharedOpsCost', value)} />
          {commercial.motion === 'csp' && <CostInput label="License resale markup %" value={commercial.licenseMarkupPct} step={0.1} onChange={(value) => setCommercialNumber('licenseMarkupPct', value)} />}
          {commercial.motion === 'csp' && <CostInput label="Azure resale markup %" value={commercial.azureMarkupPct} step={0.1} onChange={(value) => setCommercialNumber('azureMarkupPct', value)} />}
        </div>
        {commercial.motion === 'csp' && (
          <div className="meter-toggles commercial-controls">
            <CostToggle label="Use Azure Lighthouse delegated administration" checked={commercial.useLighthouse} onChange={(checked) => setCommercial({ ...commercial, useLighthouse: checked })} />
          </div>
        )}

        <h3>Arc metered services</h3>
        <div className="meter-toggles">
          <CostToggle label={`Update Manager · ${money(rateCard.updateManagerPerVmMonth)}/VM/mo`} checked={inputs.includeUpdateManager} onChange={(checked) => setInputs({ ...inputs, includeUpdateManager: checked })} />
          <CostToggle label={`Defender for Servers P2 · ${money(rateCard.defenderP2PerVmMonth)}/VM/mo`} checked={inputs.includeDefenderP2} onChange={(checked) => setInputs({ ...inputs, includeDefenderP2: checked })} />
          <CostToggle label={`Guest Config + Change Tracking · ${money(rateCard.guestConfigPerVmMonth)}/VM/mo`} checked={inputs.includeGuestConfig} onChange={(checked) => setInputs({ ...inputs, includeGuestConfig: checked })} />
          <CostToggle label={`Log Analytics · ${money(rateCard.logAnalyticsPerGb)}/GB`} checked={inputs.includeLogAnalytics} onChange={(checked) => setInputs({ ...inputs, includeLogAnalytics: checked })} />
          <CostToggle label="Waive Update Manager + Guest Config with qualifying entitlement" checked={inputs.waiveUpdateAndGuest} onChange={(checked) => setInputs({ ...inputs, waiveUpdateAndGuest: checked })} />
        </div>

        <details className="rate-card-details">
          <summary>Editable rate card <b>Workbook assumptions</b></summary>
          <div className="rate-card-body">
            <p>Replace every value with the written quote for the applicable customer, provider agreement, date, and region.</p>
            <div className="form-grid two-column">
              <CostInput label="Windows DC / 2 cores" value={rateCard.windowsPerTwoCorePack} step={0.01} onChange={(value) => setRate('windowsPerTwoCorePack', value)} />
              <CostInput label="Windows DC SPLA / 2 cores / mo" value={rateCard.windowsSplaPerTwoCorePackMonth} step={0.01} onChange={(value) => setRate('windowsSplaPerTwoCorePackMonth', value)} />
              <CostInput label="System Center DC / 2 cores" value={rateCard.systemCenterPerTwoCorePack} step={0.01} onChange={(value) => setRate('systemCenterPerTwoCorePack', value)} />
              <CostInput label="System Center DC SPLA / 2 cores / mo" value={rateCard.systemCenterSplaPerTwoCorePackMonth} step={0.01} onChange={(value) => setRate('systemCenterSplaPerTwoCorePackMonth', value)} />
              <CostInput label="SQL Standard / core" value={rateCard.sqlStandardPerCore} step={0.01} onChange={(value) => setRate('sqlStandardPerCore', value)} />
              <CostInput label="Annual SA rate" value={rateCard.softwareAssuranceAnnualRate * 100} step={0.1} onChange={(value) => setRate('softwareAssuranceAnnualRate', value / 100)} />
              <CostInput label="RDS SAL / user / mo" value={rateCard.rdsSalPerUserMonth} step={0.01} onChange={(value) => setRate('rdsSalPerUserMonth', value)} />
              <CostInput label="RDS User CAL" value={rateCard.rdsCalPerUser} step={0.01} onChange={(value) => setRate('rdsCalPerUser', value)} />
              <CostInput label="Update Manager / VM / mo" value={rateCard.updateManagerPerVmMonth} step={0.01} onChange={(value) => setRate('updateManagerPerVmMonth', value)} />
              <CostInput label="Defender P2 / VM / mo" value={rateCard.defenderP2PerVmMonth} step={0.01} onChange={(value) => setRate('defenderP2PerVmMonth', value)} />
              <CostInput label="Guest services / VM / mo" value={rateCard.guestConfigPerVmMonth} step={0.01} onChange={(value) => setRate('guestConfigPerVmMonth', value)} />
              <CostInput label="Log Analytics / GB" value={rateCard.logAnalyticsPerGb} step={0.01} onChange={(value) => setRate('logAnalyticsPerGb', value)} />
            </div>
            <div className="csp-reference-rates">
              <span>SC Standard CSP NCE 1-year reference<strong>{money(rateCard.systemCenterStandardCspOneYearPerTwoCorePack)} / 2-core pack</strong></span>
              <span>SC Standard CSP NCE 3-year reference<strong>{money(rateCard.systemCenterStandardCspThreeYearPerTwoCorePack)} / 2-core pack</strong></span>
            </div>
            <p className="small"><strong>Reference only:</strong> these CSP figures are Standard edition, not a Datacenter substitute for dense virtualization, and are excluded from calculations.</p>
          </div>
        </details>

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
            <h2>{commercial.motion === 'internal' ? 'Internal platform economics' : commercial.motion === 'csp' ? 'CSP customer pricing' : 'MSP hosted-service economics'}</h2>
            <p className="small muted">Commercial model uses {selectedCost.plane.shortName} over {inputs.termYears} year{inputs.termYears === 1 ? '' : 's'} with {inputs.model === 'spla' ? 'SPLA monthly' : 'perpetual + SA'} licensing.</p>
          </div>
          <Calculator size={22} />
        </div>

        <div className="commercial-kpis">
          <article><span>{isCommercial ? 'Customer contract value' : 'Term platform TCO'}</span><strong>{money(isCommercial ? economics.totalRevenue : economics.totalProviderCost)}</strong><small>{inputs.termYears}-year model</small></article>
          <article><span>Provider COGS</span><strong>{money(economics.totalProviderCost)}</strong><small>software + Azure + access + delivery</small></article>
          <article className={isCommercial && economics.grossProfit < 0 ? 'negative' : ''}><span>Gross profit</span><strong>{isCommercial ? money(economics.grossProfit) : '—'}</strong><small>before tax and financing</small></article>
          <article className={isCommercial && economics.grossMarginPct < commercial.targetGrossMarginPct / 100 ? 'negative' : 'positive'}><span>Gross margin</span><strong>{isCommercial ? `${(economics.grossMarginPct * 100).toFixed(1)}%` : '—'}</strong><small>{commercial.targetGrossMarginPct}% target</small></article>
          <article><span>Customer / tenant / month</span><strong>{isCommercial ? money(economics.customerPerTenantMonth) : '—'}</strong><small>{commercial.tenantCount} tenant{commercial.tenantCount === 1 ? '' : 's'}</small></article>
          <article><span>Customer / managed VM / month</span><strong>{isCommercial ? money(economics.customerPerVmMonth) : '—'}</strong><small>{inputs.vms.toLocaleString()} managed VMs</small></article>
        </div>

        <div className="economics-grid">
          <div className="economics-bridge">
            <h3>Provider cost and revenue bridge</h3>
            <div><span>Microsoft software COGS</span><strong>{money(economics.softwareCost)}</strong></div>
            <div><span>Azure consumption COGS</span><strong>{money(economics.azureCost)}</strong></div>
            <div><span>{inputs.model === 'spla' ? 'RDS SAL COGS' : 'RDS CAL COGS'}</span><strong>{money(economics.accessLicensingCost)}</strong></div>
            <div><span>Delivery + operations COGS</span><strong>{money(economics.deliveryCost)}</strong></div>
            <div className="bridge-total"><span>Total provider COGS</span><strong>{money(economics.totalProviderCost)}</strong></div>
            {isCommercial && <div><span>License resale revenue</span><strong>{money(economics.licenseRevenue)}</strong></div>}
            {isCommercial && <div><span>Azure resale revenue</span><strong>{money(economics.azureRevenue)}</strong></div>}
            {isCommercial && <div><span>Managed service revenue</span><strong>{money(economics.serviceRevenue)}</strong></div>}
            {isCommercial && <div className="bridge-total"><span>Total customer revenue</span><strong>{money(economics.totalRevenue)}</strong></div>}
            {isCommercial && economics.revenueGap > 0 && <div className="bridge-gap"><span>Revenue needed for target margin</span><strong>+{money(economics.revenueGap)}</strong></div>}
          </div>
          <div className="commercial-recommendations">
            <h3>Commercial recommendations</h3>
            <div className="recommendation-stack">
              {economics.recommendations.map((recommendation) => (
                <article className={`commercial-recommendation ${recommendation.tone}`} key={`${recommendation.title}-${recommendation.detail}`}>
                  <strong>{recommendation.title}</strong>
                  <p>{recommendation.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </div>

        <div className="comparison-heading">
          <div>
            <h2>{inputs.model === 'perpetual' ? 'Perpetual + Software Assurance' : 'SPLA'} management-plane comparison</h2>
            <p className="small muted">Select a plane to use it in the commercial model. Windows Server is included in every total.</p>
          </div>
        </div>

        <div className="cost-card-grid">
          {costs.map(({ plane, total, managementOnly, perVmMonth, azure }) => (
            <article className={`cost-card ${plane.id === selectedPlane ? 'selected' : ''} ${plane.id === 'scvmm' ? 'recommended' : ''}`} key={plane.id}>
              {plane.id === selectedPlane && <span className="recommended-tag">Commercial selection</span>}
              <h3>{plane.shortName}</h3>
              <strong className="cost-total">{money(total)}</strong>
              <span>over {inputs.termYears} year{inputs.termYears === 1 ? '' : 's'}</span>
              <div className="cost-breakdown">
                <div><span>Management layer</span><strong>{money(managementOnly)}</strong></div>
                {plane.id === 'arc-scvmm' && <div><span>Azure services</span><strong>{money(azure)}</strong></div>}
                <div><span>Per VM / month</span><strong>{money(perVmMonth)}</strong></div>
              </div>
              <button className="cost-card-select" onClick={() => setSelectedPlane(plane.id)}>{plane.id === selectedPlane ? 'Selected for pricing' : 'Use for pricing'}</button>
            </article>
          ))}
        </div>

        <div className="price-basis">
          <h3>Current model basis</h3>
          <div className="price-basis-grid">
            <span>Windows DC / 2 cores<strong>{inputs.model === 'perpetual' ? money(rateCard.windowsPerTwoCorePack) : `${money(rateCard.windowsSplaPerTwoCorePackMonth)}/mo`}</strong></span>
            <span>System Center DC / 2 cores<strong>{inputs.model === 'perpetual' ? money(rateCard.systemCenterPerTwoCorePack) : `${money(rateCard.systemCenterSplaPerTwoCorePackMonth)}/mo`}</strong></span>
            <span>SQL Standard / core<strong>{money(rateCard.sqlStandardPerCore)}</strong></span>
            <span>Annual SA assumption<strong>{(rateCard.softwareAssuranceAnnualRate * 100).toFixed(0)}%</strong></span>
            <span>Arc meters / VM / month<strong>{money(arcCost.azurePerVmMonth)}</strong></span>
            <span>Log Analytics volume<strong>{inputs.logAnalyticsGbPerVm.toFixed(1)} GB / VM / month</strong></span>
          </div>
        </div>

        <div className="alternative-costs">
          <h3>Alternative licensing references — excluded from totals</h3>
          <div><span>Windows Server pay-as-you-go via Arc</span><strong>{money(windowsPaygReference)}</strong><small>over the selected term; no core minimum and AVMA is unavailable</small></div>
          <div><span>Azure Local host service equivalent</span><strong>{money(azureLocalReference)}</strong><small>reference only; Azure Hybrid Benefit and storage topology rules can change applicability</small></div>
        </div>
        <div className="note warn public-pricing-note">
          <strong>Do not quote from this page without validation</strong>
          CSP NCE and SPLA rights, discounts, incentives, Azure meters, taxes, and regional pricing change. Obtain a current Partner Center or distributor quote and confirm licensing responsibility in the customer agreement.
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
