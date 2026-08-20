import { useMemo, useState } from 'react'
import { CheckSquare, FileCode2, FileDown, FileText, Printer, Square, SlidersHorizontal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/Shared'
import {
  downloadJsonReport,
  downloadMarkdownReport,
  downloadPdfReport,
  downloadWordReport,
} from '../report/exportReport'
import {
  buildSolutionReport,
  defaultReportSelection,
  REPORT_SECTION_DEFINITIONS,
  selectedReportSections,
  type ReportSectionId,
} from '../report/reportModel'
import { useSurveyorStore } from '../state/store'

export default function ReportPage() {
  const {
    customerName,
    cfg,
    vms,
    tiers,
    chosenKey,
    managementDeploymentInputs,
    includeManagementInSizing,
  } = useSurveyorStore()
  const [selection, setSelection] = useState(defaultReportSelection)
  const [generatedAt] = useState(() => new Date().toISOString())
  const [exporting, setExporting] = useState<'word' | null>(null)
  const [exportError, setExportError] = useState('')
  const report = useMemo(() => buildSolutionReport({
    customerName,
    cfg,
    vms,
    tiers,
    chosenKey,
    managementDeploymentInputs,
    includeManagementInSizing,
    generatedAt,
  }), [cfg, chosenKey, customerName, generatedAt, includeManagementInSizing, managementDeploymentInputs, tiers, vms])
  const visibleSections = selectedReportSections(report, selection)
  const selectedCount = Object.values(selection).filter(Boolean).length

  const toggleSection = (id: ReportSectionId) => setSelection((current) => ({ ...current, [id]: !current[id] }))
  const exportWord = async () => {
    setExportError('')
    setExporting('word')
    try {
      await downloadWordReport(report, selection)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Word export failed. Please try again.')
    } finally {
      setExporting(null)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Final deliverable"
        title="Solution report"
        description="Build a complete customer-ready record of the selected architecture, workloads, node requirements, storage plan, and management-plane deployment."
      />

      <div className="report-layout">
        <aside className="panel report-controls">
          <div className="panel-heading-row">
            <div>
              <h2><SlidersHorizontal size={16} /> Report contents</h2>
              <p className="small muted">Choose what appears in the preview and exported files.</p>
            </div>
          </div>

          <div className="report-selection-actions">
            <button type="button" onClick={() => setSelection(defaultReportSelection())}><CheckSquare size={14} /> Include all</button>
            <button type="button" onClick={() => setSelection(Object.fromEntries(REPORT_SECTION_DEFINITIONS.map(({ id }) => [id, false])) as typeof selection)}><Square size={14} /> Clear all</button>
          </div>

          <div className="report-section-options">
            {REPORT_SECTION_DEFINITIONS.map(({ id, label }) => (
              <label key={id}>
                <input type="checkbox" checked={selection[id]} onChange={() => toggleSection(id)} />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div className="report-management-status">
            <strong>Management selection</strong>
            <span>{managementDeploymentInputs ? 'Using your saved deployment choices' : 'Using the advisor baseline'}</span>
            <Link to="/management-plane">Review management design</Link>
          </div>

          <div className="report-export-heading">
            <strong>Export selected sections</strong>
            <span>{selectedCount} of {REPORT_SECTION_DEFINITIONS.length} included</span>
          </div>
          <div className="report-export-grid">
            <button type="button" disabled={selectedCount === 0} onClick={() => downloadMarkdownReport(report, selection)}><FileText size={16} /><span>Markdown<small>.md</small></span></button>
            <button type="button" disabled={selectedCount === 0} onClick={() => downloadJsonReport(report, selection)}><FileCode2 size={16} /><span>Structured data<small>.json</small></span></button>
            <button type="button" disabled={selectedCount === 0 || exporting === 'word'} onClick={exportWord}><FileDown size={16} /><span>{exporting === 'word' ? 'Building…' : 'Microsoft Word'}<small>.docx</small></span></button>
            <button type="button" disabled={selectedCount === 0} onClick={() => downloadPdfReport(report, selection)}><Printer size={16} /><span>PDF document<small>.pdf</small></span></button>
          </div>
          {exportError && <div className="note warn">{exportError}</div>}
          <p className="small muted report-local-note">Exports are generated locally in this browser. Customer inventory is not uploaded.</p>
        </aside>

        <div className="report-preview" aria-label="Solution report preview">
          <header className="report-cover">
            <span>Hyper-V Surveyor · Solution report</span>
            <h1>{report.title}</h1>
            <p>{report.customerName} · {report.selectedArchitecture}</p>
            <small>Generated {new Date(report.generatedAt).toLocaleString()}</small>
          </header>

          {visibleSections.length === 0 ? (
            <section className="panel report-empty">
              <FileText size={28} />
              <h2>No report sections selected</h2>
              <p>Select at least one section to build the preview and enable exports.</p>
            </section>
          ) : visibleSections.map((section) => (
            <section className="panel report-section" key={section.id}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.metrics.length > 0 && (
                <div className="report-metrics">
                  {section.metrics.map((metric) => (
                    <article key={`${section.id}-${metric.label}`}>
                      <span>{metric.label}</span>
                      <strong>{metric.value}</strong>
                      {metric.detail && <small>{metric.detail}</small>}
                    </article>
                  ))}
                </div>
              )}
              {section.bullets.length > 0 && <ul className="report-bullets">{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
              {section.tables.map((table, tableIndex) => (
                <div className="report-table-block" key={`${section.id}-${table.title ?? tableIndex}`}>
                  {table.title && <h3>{table.title}</h3>}
                  <div className="scroll report-table-scroll">
                    <table className="report-table">
                      <thead><tr>{table.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
                      <tbody>{table.rows.map((row, rowIndex) => <tr key={`${section.id}-${tableIndex}-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                  {table.rows.length === 0 && <p className="small muted">No rows are available for this section.</p>}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </>
  )
}
