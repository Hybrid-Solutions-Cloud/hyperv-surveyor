import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  BarChart3,
  BookOpen,
  Calculator,
  ChevronRight,
  ClipboardCheck,
  Cpu,
  ExternalLink,
  Home,
  Menu,
  Network,
  Server,
  Share2,
  X,
} from 'lucide-react'
import { useSurveyorStore } from '../state/store'
import { toUrl, urlOmittedInventory } from '../state/urlState'

const nav = [
  { to: '/', label: 'Overview', icon: Home, end: true },
  { to: '/workloads', label: 'Workloads', icon: Cpu },
  { to: '/configuration', label: 'Hardware & assumptions', icon: Server },
  { to: '/results', label: 'Sizing results', icon: BarChart3 },
  { to: '/capacity', label: 'Existing capacity', icon: Calculator },
  { to: '/management-plane', label: 'Management plane', icon: Network },
  { to: '/method', label: 'Sources & method', icon: BookOpen },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [shareMessage, setShareMessage] = useState('')
  const { customerName, vms, cfg, tiers } = useSurveyorStore()
  const included = vms.filter((vm) => vm.include).length

  async function shareScenario() {
    const scenario = { customerName, vms, cfg, tiers }
    const url = toUrl(scenario, '/results')
    try {
      await navigator.clipboard.writeText(url)
      setShareMessage(urlOmittedInventory(scenario) ? 'Link copied — inventory omitted' : 'Scenario link copied')
    } catch {
      window.prompt('Copy this scenario link:', url)
    }
    window.setTimeout(() => setShareMessage(''), 2600)
  }

  return (
    <div className="shell">
      <button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation">
        <Menu size={20} />
      </button>

      {menuOpen && <button className="nav-backdrop" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}

      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true"><span>H</span></div>
          <div>
            <div className="brand-kicker">Hyper-V</div>
            <div className="brand-name">Surveyor</div>
          </div>
          <button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>

        <div className="brand-caption">Plan, compare, and defend the design.</div>
        <a
          className="sister-link"
          href="https://azurelocal.cloud/azurelocal-surveyor"
          target="_blank"
          rel="noreferrer"
        >
          <span><strong>Planning Azure Local?</strong>Open Azure Local Surveyor</span>
          <ExternalLink size={14} />
        </a>

        <nav className="side-nav" aria-label="Primary navigation">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
            >
              <Icon size={17} />
              <span>{label}</span>
              <ChevronRight className="nav-arrow" size={14} />
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-status">
          <div className="sidebar-status-label">Current scenario</div>
          <strong>{customerName || 'Untitled design'}</strong>
          <span>{included.toLocaleString()} included VMs</span>
          <button className="sidebar-action" onClick={shareScenario}>
            <Share2 size={15} /> Share scenario
          </button>
          {shareMessage && <div className="share-message">{shareMessage}</div>}
        </div>
      </aside>

      <main className="main-area">
        <div className="top-strip">
          <span><ClipboardCheck size={15} /> Runs locally in your browser</span>
          <span>No telemetry · no customer data upload</span>
        </div>
        <div className="content-wrap">{children}</div>
        <footer className="site-footer">
          Hyper-V Surveyor · Windows Server 2025 planning · assumptions and recommendations are labelled in every result
        </footer>
      </main>
    </div>
  )
}
