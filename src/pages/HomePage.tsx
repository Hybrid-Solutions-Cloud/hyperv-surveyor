import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Calculator,
  Database,
  ExternalLink,
  FileSearch,
  Network,
  Server,
  ShieldCheck,
} from 'lucide-react'
import { useSurveyorStore } from '../state/store'

const workflow = [
  {
    step: '01',
    title: 'Describe the estate',
    body: 'Import RVTools or enter grouped workloads. Every VM remains editable and nothing leaves the browser.',
    icon: Database,
    to: '/workloads',
  },
  {
    step: '02',
    title: 'Set the design guardrails',
    body: 'Choose node hardware, resilience, reserves, storage architecture, recovery limits, and planning assumptions.',
    icon: Server,
    to: '/configuration',
  },
  {
    step: '03',
    title: 'Compare the answers',
    body: 'See SAN, S2D, and hybrid outcomes together, including the constraint that actually determines the design.',
    icon: Calculator,
    to: '/results',
  },
  {
    step: '04',
    title: 'Choose how to operate it',
    body: 'Use the Management Plane Advisor to compare Classic, SCVMM, Windows Admin Center, and Arc.',
    icon: Network,
    to: '/management-plane',
  },
]

export default function HomePage() {
  const { customerName, setCustomerName, vms, loadDemo } = useSurveyorStore()
  const included = vms.filter((vm) => vm.include)
  const storageTiB = included.reduce((sum, vm) => sum + vm.storageGiB, 0) / 1024

  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-badge"><ShieldCheck size={15} /> Local-first infrastructure planning</div>
          <h1>Design the Hyper-V platform before the hardware—or the proposal—gets locked.</h1>
          <p>
            Size Windows Server 2025 Hyper-V across SAN, Storage Spaces Direct, and hybrid designs,
            then connect the technical answer to the management-plane and licensing decision.
          </p>
          <div className="hero-actions">
            <Link className="btn link-btn" to="/workloads">Start with workloads <ArrowRight size={16} /></Link>
            <button className="btn ghost" onClick={loadDemo}>Generate a random 400-VM demo</button>
          </div>
        </div>

        <div className="scenario-card">
          <div className="scenario-title">Current engagement</div>
          <label className="field">
            <span>Customer or scenario name</span>
            <input
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="Contoso private cloud refresh"
            />
          </label>
          <div className="scenario-metrics">
            <div><strong>{included.length.toLocaleString()}</strong><span>included VMs</span></div>
            <div><strong>{storageTiB.toFixed(1)}</strong><span>TiB consumed</span></div>
          </div>
          <div className="privacy-callout">
            <FileSearch size={18} />
            <div><strong>Customer data stays here.</strong><span>Imports are parsed on this device. No backend is required.</span></div>
          </div>
        </div>
      </section>

      <a
        className="sister-banner"
        href="https://azurelocal.cloud/azurelocal-surveyor"
        target="_blank"
        rel="noreferrer"
      >
        <div className="sister-banner-mark">AL</div>
        <div>
          <span>Sister solution</span>
          <strong>Planning Azure Local instead?</strong>
          <p>Open Azure Local Surveyor for Azure Local hardware, workload, capacity, volume, and report planning.</p>
        </div>
        <ExternalLink size={18} />
      </a>

      <section className="section-heading">
        <div className="eyebrow">One connected workflow</div>
        <h2>From inventory to an explainable recommendation</h2>
        <p>The first release keeps the proven sizing engine and gives it a product workflow built for solution engineers.</p>
      </section>

      <section className="workflow-grid">
        {workflow.map(({ step, title, body, icon: Icon, to }) => (
          <Link className="workflow-card" to={to} key={step}>
            <div className="workflow-top"><span>{step}</span><Icon size={20} /></div>
            <h3>{title}</h3>
            <p>{body}</p>
            <span className="workflow-link">Open <ArrowRight size={14} /></span>
          </Link>
        ))}
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
