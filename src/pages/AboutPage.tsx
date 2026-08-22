import { AlertTriangle, CheckCircle2, ExternalLink, Info, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/Shared'

const validationItems = [
  'Confirm that inventory data, utilization evidence, growth assumptions, failure reserves, and workload classifications are complete and accurate.',
  'Recheck current Microsoft documentation, product lifecycle status, licensing, support statements, and vendor-qualified hardware before purchase or implementation.',
  'Complete workload-specific performance, storage, network, security, identity, backup, disaster-recovery, and operational validation.',
  'Obtain the technical, commercial, security, compliance, and change approvals required by your organization.',
]

export default function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="About this project"
        title="About Hyper-V Surveyor"
        description="An independent planning aid for exploring Windows Server 2025 Hyper-V capacity, architecture, management, and implementation decisions."
      />

      <div className="stack about-page">
        <section className="panel about-intro">
          <div className="about-icon"><Info size={24} /></div>
          <div>
            <h2>Designed to support—not replace—engineering judgment</h2>
            <p>
              Hyper-V Surveyor turns supplied inventory and visible planning assumptions into estimates, comparisons,
              and implementation guidance. It is intended to make design conversations more consistent and explainable;
              it does not certify a design or make a purchasing decision for you.
            </p>
          </div>
        </section>

        <section className="panel legal-notice">
          <div className="legal-notice-heading">
            <AlertTriangle size={22} />
            <div>
              <span className="matrix-category">Important use notice</span>
              <h2>Review and validate every result before relying on it</h2>
            </div>
          </div>
          <p>
            This tool and its outputs are provided for informational and planning purposes only. Results depend on the
            accuracy and completeness of the data and assumptions entered, and may contain errors, omissions, outdated
            information, or estimates that do not reflect actual workload behavior. They are not a warranty, guarantee,
            certification, support statement, bill of materials, quotation, or approval from Microsoft or any hardware,
            software, storage, networking, or service provider.
          </p>
          <p>
            Use of Hyper-V Surveyor is at your own risk. You remain responsible for independently reviewing the source
            data, calculations, assumptions, recommendations, licensing, compatibility, supportability, security,
            availability, performance, and operational impact before purchasing equipment, changing an environment, or
            placing a solution into production.
          </p>
        </section>

        <section className="panel">
          <div className="about-section-heading">
            <CheckCircle2 size={20} />
            <div>
              <h2>Before approving a design</h2>
              <p>Use the report as evidence for review, not as the final authority.</p>
            </div>
          </div>
          <ul className="about-checklist">
            {validationItems.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <section className="about-grid">
          <article className="panel">
            <h2>No professional or vendor advice</h2>
            <p>
              Nothing produced by this tool is legal, financial, licensing, security, compliance, or professional
              engineering advice. Product names and trademarks belong to their respective owners. Hyper-V Surveyor is
              an independent project and is not affiliated with, endorsed by, or supported by Microsoft or other vendors.
            </p>
          </article>

          <article className="panel">
            <h2>Local processing and data responsibility</h2>
            <p>
              The application is designed to process scenario data locally in your browser without telemetry or customer
              inventory uploads. You are still responsible for protecting source files, browser data, shared scenario
              links, and exported reports according to your organization’s data-handling requirements.
            </p>
          </article>
        </section>

        <section className="panel warranty-notice">
          <div className="about-section-heading">
            <ShieldCheck size={20} />
            <div>
              <h2>No warranty and limitation of liability</h2>
              <p>Plain-language legal notice</p>
            </div>
          </div>
          <p>
            Hyper-V Surveyor is provided “as is” and “as available,” without warranties or guarantees of any kind,
            express or implied, including accuracy, completeness, availability, merchantability, fitness for a particular
            purpose, and non-infringement. To the fullest extent permitted by applicable law, the project’s authors and
            contributors will not be liable for any loss, damage, cost, or claim arising from use of, inability to use,
            or reliance on the tool or its outputs. Nothing in this notice excludes rights or liabilities that cannot
            lawfully be excluded or limited.
          </p>
          <div className="note info">
            <strong>Legal review is still appropriate.</strong>
            This is a general project notice, not a substitute for counsel reviewing the terms needed for a particular
            organization, jurisdiction, or commercial use.
          </div>
        </section>

        <section className="panel about-links">
          <div>
            <h2>Transparency and updates</h2>
            <p>Review calculation provenance in the site and inspect the project source when you need deeper assurance.</p>
          </div>
          <div className="page-action-row">
            <Link className="btn ghost link-btn" to="/method">Sources and method</Link>
            <a className="btn ghost link-btn" href="https://github.com/Hybrid-Solutions-Cloud/hyperv-surveyor" target="_blank" rel="noreferrer">
              Project source <ExternalLink size={14} />
            </a>
          </div>
        </section>
      </div>
    </>
  )
}
