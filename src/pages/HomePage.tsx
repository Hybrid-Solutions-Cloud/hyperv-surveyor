import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Boxes,
  Calculator,
  Database,
  ExternalLink,
  FileSearch,
  FileText,
  FolderOpen,
  Gauge,
  GitCompareArrows,
  Network,
  Server,
  ShieldCheck,
  Workflow,
} from 'lucide-react'
import { useSurveyorStore } from '../state/store'
import { ENGAGEMENT_LABELS, journeyResumeRoute, journeyStartRoute, type EngagementMode } from '../state/journey'

const journeys: Array<{
  id: Exclude<EngagementMode, 'management-only'>
  eyebrow: string
  title: string
  question: string
  outcome: string
  icon: typeof Server
}> = [
  {
    id: 'new-platform',
    eyebrow: 'Workload driven',
    title: 'Design a new platform',
    question: 'I have workloads and need to size new hardware.',
    outcome: 'Required nodes, architecture comparison, storage layout, and growth plan.',
    icon: Boxes,
  },
  {
    id: 'existing-capacity',
    eyebrow: 'Hardware driven',
    title: 'Assess existing capacity',
    question: 'I have hardware and want to understand its capacity and headroom.',
    outcome: 'Usable capacity, binding resource, and the number of additional VMs that fit.',
    icon: Gauge,
  },
  {
    id: 'fit-gap',
    eyebrow: 'Workloads + hardware',
    title: 'Fit workloads to existing hardware',
    question: 'I have both. Tell me whether the estate fits and what is missing.',
    outcome: 'Pass or fail, resource deficits, same-spec expansion, and remediation.',
    icon: GitCompareArrows,
  },
]

const commonWorkflow = [
  { step: '01', title: 'Choose the question', body: 'Start with new hardware, existing capacity, workload fit, or management only.', icon: Workflow, to: '#planning-paths' },
  { step: '02', title: 'Provide only the needed inputs', body: 'Import workloads, describe hardware, or enter management scale. Advanced assumptions stay optional.', icon: Database, to: '/workloads' },
  { step: '03', title: 'Review the platform outcome', body: 'See required hardware, available headroom, or the exact fit-and-gap answer.', icon: Calculator, to: '/results' },
  { step: '04', title: 'Choose how to operate it', body: 'Design the management plane, record an existing solution, or defer that decision.', icon: Network, to: '/management-plane' },
  { step: '05', title: 'Deliver the decision', body: 'Create the implementation plan, workbook, controlled report, and reopenable project.', icon: FileText, to: '/report' },
]

export default function HomePage() {
  const navigate = useNavigate()
  const store = useSurveyorStore()
  const included = store.vms.filter((vm) => vm.include)
  const storageTiB = included.reduce((sum, vm) => sum + vm.storageGiB, 0) / 1024

  const chooseJourney = (mode: EngagementMode) => {
    store.setEngagementMode(mode)
    if (mode === 'management-only') store.setManagementDecision('design')
    navigate(journeyStartRoute(mode))
  }

  const continueRoute = store.engagementMode
    ? journeyResumeRoute(store.engagementMode, included.length)
    : null
  const platformInputRoute = store.engagementMode === 'existing-capacity'
    ? '/capacity'
    : store.engagementMode === 'management-only' ? '/management-plane' : '/workloads'
  const platformOutcomeRoute = store.engagementMode === 'existing-capacity' || store.engagementMode === 'fit-gap'
    ? '/capacity'
    : store.engagementMode === 'management-only' ? '/management-plane' : '/results'

  return (
    <div className="home-page">
      <section className="hero journey-hero">
        <div className="hero-copy">
          <div className="hero-badge"><ShieldCheck size={15} /> Local-first infrastructure planning</div>
          <h1>Start with the question the customer is actually asking.</h1>
          <p>
            Design new Hyper-V infrastructure, assess hardware already owned, test a workload against an existing estate,
            or go directly to the management-plane decision. Surveyor exposes the depth only when it is needed.
          </p>
          <div className="hero-actions">
            {continueRoute
              ? <Link className="btn link-btn" to={continueRoute}>Continue {ENGAGEMENT_LABELS[store.engagementMode!]} <ArrowRight size={16} /></Link>
              : <a className="btn link-btn" href="#planning-paths">Choose a planning path <ArrowRight size={16} /></a>}
            <Link className="btn ghost" to="/project"><FolderOpen size={15} /> Open or resume a project</Link>
          </div>
        </div>

        <div className="scenario-card">
          <div className="scenario-title">Current engagement</div>
          <label className="field">
            <span>Customer or scenario name</span>
            <input
              value={store.customerName}
              onChange={(event) => store.setCustomerName(event.target.value)}
              placeholder="Contoso private cloud refresh"
            />
          </label>
          {store.engagementMode && <div className="current-journey"><span>Planning path</span><strong>{ENGAGEMENT_LABELS[store.engagementMode]}</strong></div>}
          <div className="scenario-metrics">
            <div><strong>{included.length.toLocaleString()}</strong><span>included VMs</span></div>
            <div><strong>{storageTiB.toFixed(1)}</strong><span>TiB consumed</span></div>
          </div>
          <div className="privacy-callout">
            <FileSearch size={18} />
            <div><strong>Customer data stays here.</strong><span>Imports and saved work remain on this device unless you export them.</span></div>
          </div>
        </div>
      </section>

      <section id="planning-paths" className="journey-section">
        <div className="section-heading">
          <div className="eyebrow">Choose one starting point</div>
          <h2>What do you need Surveyor to answer?</h2>
          <p>The choice changes the order and the result—not the capabilities available later. Switching paths never deletes entered data.</p>
        </div>

        <div className="journey-grid">
          {journeys.map(({ id, eyebrow, title, question, outcome, icon: Icon }) => (
            <button className={`journey-card ${store.engagementMode === id ? 'selected' : ''}`} type="button" onClick={() => chooseJourney(id)} key={id}>
              <div className="journey-card-top"><span>{eyebrow}</span><Icon size={22} /></div>
              <h3>{title}</h3>
              <p>{question}</p>
              <div className="journey-outcome"><strong>Result</strong>{outcome}</div>
              <span className="journey-start">Start this path <ArrowRight size={15} /></span>
            </button>
          ))}
        </div>

        <button className={`management-only-card ${store.engagementMode === 'management-only' ? 'selected' : ''}`} type="button" onClick={() => chooseJourney('management-only')}>
          <div className="management-only-icon"><Network size={22} /></div>
          <div><span>Platform decision already made</span><strong>Plan a management solution only</strong><p>Build the VMM, WAC, SCOM, SQL, Arc, HA, placement, VM sizing, and cost model without repeating infrastructure sizing.</p></div>
          <ArrowRight size={19} />
        </button>

        <div className="demo-path">
          <span>Want to explore first?</span>
          <button className="btn ghost" type="button" onClick={() => { store.setEngagementMode('new-platform'); store.loadDemo(); navigate('/workloads') }}>Load a random 400-VM new-platform demo</button>
        </div>
      </section>

      <a className="sister-banner" href="https://azurelocal.cloud/azurelocal-surveyor" target="_blank" rel="noreferrer">
        <div className="sister-banner-mark">AL</div>
        <div><span>Sister solution</span><strong>Planning Azure Local instead?</strong><p>Open Azure Local Surveyor for Azure Local hardware, workload, capacity, volume, and report planning.</p></div>
        <ExternalLink size={18} />
      </a>

      <section className="section-heading">
        <div className="eyebrow">Complexity on demand</div>
        <h2>A simple start, with every engineering control still available</h2>
        <p>Advisor defaults guide a first-time user. Advanced hardware, performance, storage, networking, recovery, management, licensing, and reporting controls remain editable.</p>
      </section>

      <section className="workflow-grid journey-workflow-grid">
        {commonWorkflow.map(({ step, title, body, icon: Icon, to }) => {
          const destination = step === '02' ? platformInputRoute : step === '03' ? platformOutcomeRoute : to
          const content = <><div className="workflow-top"><span>{step}</span><Icon size={20} /></div><h3>{title}</h3><p>{body}</p><span className="workflow-link">Open <ArrowRight size={14} /></span></>
          return destination.startsWith('#')
            ? <a className="workflow-card" href={destination} key={step}>{content}</a>
            : <Link className="workflow-card" to={destination} key={step}>{content}</Link>
        })}
      </section>

      <section className="trust-band">
        <div><strong>MS</strong><span>Documented requirement</span></div>
        <div><strong>MS-REC</strong><span>Microsoft recommendation</span></div>
        <div><strong>TOOL</strong><span>Editable planning assumption</span></div>
        <p>Every rule is labelled so a tool assumption can never masquerade as vendor guidance.</p>
      </section>
    </div>
  )
}
