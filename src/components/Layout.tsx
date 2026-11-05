import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  BarChart3,
  BookOpen,
  Calculator,
  ChevronRight,
  ClipboardCheck,
  Cpu,
  ExternalLink,
  Home,
  Info,
  Menu,
  Network,
  Workflow,
  FileText,
  FolderOpen,
  Server,
  Share2,
  X,
} from 'lucide-react'
import { payloadFromState, useSurveyorStore } from '../state/store'
import { toUrl, urlOmittedInventory } from '../state/urlState'
import { ENGAGEMENT_LABELS, journeyResumeRoute, type EngagementMode } from '../state/journey'

type NavItem = { to: string; label: string; icon: typeof Home; end?: boolean }

/**
 * Which platform pages belong to each path. Pages outside the path are hidden from the sidebar;
 * their routes still open and say they are not part of the current path.
 */
const PATH_PAGES: Record<EngagementMode, string[]> = {
  'new-platform': ['/workloads', '/configuration', '/results'],
  'existing-capacity': ['/capacity', '/workloads'],
  'fit-gap': ['/workloads', '/capacity'],
  'management-only': [],
}

const PATH_LABELS: Partial<Record<EngagementMode, Record<string, string>>> = {
  'existing-capacity': { '/capacity': 'Existing capacity', '/workloads': 'Workloads (optional)' },
  'fit-gap': { '/capacity': 'Fit and gap' },
}

export function navGroupsFor(mode: EngagementMode | null): Array<{ label: string; items: NavItem[] }> {
  if (!mode) return navGroups
  return navGroups
    .map((group) => group.label !== 'Platform' ? group : {
      ...group,
      items: group.items
        .filter((item) => PATH_PAGES[mode].includes(item.to))
        .map((item) => ({ ...item, label: PATH_LABELS[mode]?.[item.to] ?? item.label })),
    })
    .filter((group) => group.items.length > 0)
}

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  { label: 'Start', items: [{ to: '/', label: 'Planning paths', icon: Home, end: true }] },
  { label: 'Platform', items: [
    { to: '/workloads', label: 'Workloads', icon: Cpu },
    { to: '/configuration', label: 'Proposed hardware', icon: Server },
    { to: '/results', label: 'New-platform results', icon: BarChart3 },
    { to: '/capacity', label: 'Existing hardware & fit', icon: Calculator },
  ] },
  { label: 'Operate', items: [
    { to: '/management-plane', label: 'Management plane', icon: Network },
    { to: '/deployment', label: 'Implementation plan', icon: Workflow },
  ] },
  { label: 'Deliver', items: [
    { to: '/report', label: 'Solution report', icon: FileText },
    { to: '/project', label: 'Project & scenarios', icon: FolderOpen },
    { to: '/method', label: 'Sources & method', icon: BookOpen },
    { to: '/about', label: 'About & legal', icon: Info },
  ] },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [shareMessage, setShareMessage] = useState('')
  const store = useSurveyorStore()
  const { pathname } = useLocation()
  const { customerName, vms, engagementMode, sharedInventoryOmitted, dismissSharedInventoryNotice } = store
  const included = vms.filter((vm) => vm.include).length

  async function shareScenario() {
    // The whole design travels in the link's fragment; only a large inventory is left out.
    const scenario = payloadFromState(useSurveyorStore.getState())
    const url = toUrl(scenario, engagementMode ? journeyResumeRoute(engagementMode, included) : '/results')
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
          {navGroupsFor(engagementMode).map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const { to, label, icon: Icon } = item
                return (
                <NavLink
                  key={to}
                  to={to}
                  end={item.end}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                  <ChevronRight className="nav-arrow" size={14} />
                </NavLink>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-status">
          <div className="sidebar-status-label">Current scenario</div>
          <strong>{customerName || 'Untitled design'}</strong>
          <span>{engagementMode ? ENGAGEMENT_LABELS[engagementMode] : 'Choose a planning path'}</span>
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
        <div className="content-wrap">
          {sharedInventoryOmitted !== null && vms.length > 0 && (
            <div className="note warn" role="status">
              <strong>The shared link you opened left out its {sharedInventoryOmitted.toLocaleString()} workload records</strong>
              Its design settings were applied, but the {vms.length.toLocaleString()} workloads below are the ones already in this browser, not the sender's. Ask for the Surveyor project file to see the sender's inventory.
              <div className="row" style={{ marginTop: 8 }}>
                <Link className="btn ghost" to="/project">Open a project file</Link>
                <button className="btn ghost" type="button" onClick={dismissSharedInventoryNotice}>Keep my workloads and dismiss</button>
              </div>
            </div>
          )}
          {sharedInventoryOmitted !== null && vms.length === 0 && pathname !== '/results' && (
            <div className="note warn" role="status">
              <strong>The shared link you opened left out its {sharedInventoryOmitted.toLocaleString()} workload records</strong>
              Results that need workloads stay blocked until you open the sender's project file or import an inventory.
            </div>
          )}
          {children}
        </div>
        <footer className="site-footer">
          <span>Hyper-V Surveyor · Independent planning aid · Estimates require validation</span>
          <Link to="/about">Important use notice</Link>
        </footer>
      </main>
    </div>
  )
}
