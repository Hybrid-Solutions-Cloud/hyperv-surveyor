import { useMemo, useRef, useState } from 'react'
import { Download, FolderOpen, RotateCcw, Save, Trash2, Upload } from 'lucide-react'
import { compareScenario } from '../state/scenarioComparison'
import { PageHeader } from '../components/Shared'
import { useResetEverything } from '../components/useResetEverything'
import { createProject, downloadProject, parseProject, type ProjectPayload } from '../state/project'
import { useSurveyorStore } from '../state/store'
import { ENGAGEMENT_LABELS } from '../state/journey'

export default function ProjectPage() {
  const store = useSurveyorStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const currentPayload: ProjectPayload = {
    engagementMode: store.engagementMode,
    managementDecision: store.managementDecision,
    customerName: store.customerName,
    vms: store.vms,
    cfg: store.cfg,
    tiers: store.tiers,
    chosenKey: store.chosenKey,
    existingCapacityCfg: store.existingCapacityCfg,
    existingCapacityTiers: store.existingCapacityTiers,
    existingCapacityNodes: store.existingCapacityNodes,
    managementDeploymentInputs: store.managementDeploymentInputs,
    includeManagementInSizing: store.includeManagementInSizing,
    placementInputs: store.placementInputs,
    networkDesignInputs: store.networkDesignInputs,
    drDesignInputs: store.drDesignInputs,
    reportMetadata: store.reportMetadata,
    dataSources: store.dataSources,
    storageDecisionAnswers: store.storageDecisionAnswers,
  }

  const comparison = useMemo(() => [
    { id: 'current', name: 'Current working design', createdAt: '', ...currentPayload },
    ...store.savedScenarios,
  ].map((scenario) => {
    // The same design function as every other page, so a scenario row matches its report.
    const row = compareScenario(scenario)
    const result = row.design.path === 'management-only' ? null : row.design.sizing
    return { scenario, design: row.design, result, architecture: row.architecture, nodes: row.nodes, resultLabel: row.result, storage: row.storage }
  }), [store.engagementMode, store.managementDecision, store.cfg, store.vms, store.tiers, store.chosenKey, store.customerName, store.existingCapacityCfg, store.existingCapacityTiers, store.existingCapacityNodes, store.managementDeploymentInputs, store.includeManagementInSizing, store.placementInputs, store.networkDesignInputs, store.drDesignInputs, store.reportMetadata, store.dataSources, store.storageDecisionAnswers, store.savedScenarios])

  const resetEverything = useResetEverything()

  async function openProject(file: File) {
    setError('')
    try {
      const project = parseProject(await file.text())
      const current = store.savedScenarios.length
      const incoming = project.savedScenarios
      const scenarioText = incoming
        ? ` Your ${current} saved scenario${current === 1 ? '' : 's'} in this browser will be replaced by the project's ${incoming.length}.`
        : current > 0 ? ` This older project file has no saved scenarios, so your ${current} saved scenario${current === 1 ? '' : 's'} stay.` : ''
      const hasWork = store.vms.length > 0 || current > 0 || store.customerName.trim() !== ''
      if (hasWork && !window.confirm(`Open ${file.name}?\n\nThis replaces the current design, workloads and settings in this browser.${scenarioText} Download a project file first if you need the current work.`)) return
      store.loadProject(project.payload, incoming)
      setMessage(`Opened project exported ${new Date(project.exportedAt).toLocaleString()} with engine ${project.engineVersion}.${incoming ? ` ${incoming.length} saved scenario${incoming.length === 1 ? '' : 's'} loaded.` : ''}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open that project file.')
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Design workspace"
        title="Project & scenarios"
        description="Save a complete design, reopen it later, and compare named alternatives without losing the workload inventory or management choices."
        actions={<button className="btn danger" type="button" onClick={resetEverything}><RotateCcw size={15} /> Clear everything and start fresh</button>}
      />

      <div className="grid two">
        <section className="panel">
          <h2><FolderOpen size={17} /> Project file</h2>
          <p className="small muted">The project file is the portable source of truth. It contains the complete inventory, measurements, assumptions, management design, existing-capacity workspace, and saved scenarios.</p>
          <div className="row">
            <button className="btn" onClick={() => downloadProject(createProject(currentPayload, store.savedScenarios))}><Download size={15} /> Download project</button>
            <button className="btn ghost" onClick={() => fileRef.current?.click()}><Upload size={15} /> Open project</button>
          </div>
          <input ref={fileRef} type="file" accept=".json,.hvsurveyor.json" style={{ display: 'none' }} onChange={(event) => { const file = event.target.files?.[0]; if (file) openProject(file); event.target.value = '' }} />
          {message && <div className="note ok" style={{ marginTop: 12 }}>{message}</div>}
          {error && <div className="note err" style={{ marginTop: 12 }}><strong>Project could not be opened</strong>{error}</div>}
          <div className="note" style={{ marginTop: 12 }}>
            <strong>Private by design</strong>
            Automatic recovery state is kept in this browser using IndexedDB. Download a project before switching devices or clearing browser data; no customer inventory is uploaded.
          </div>
        </section>

        <section className="panel">
          <h2><Save size={17} /> Save a named scenario</h2>
          <p className="small muted">Capture the current project as a comparison point before changing hardware, architecture, growth, or management choices.</p>
          <label className="field">
            <span>Scenario name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: SAN · N+2 · 3-year growth" />
          </label>
          <button className="btn" onClick={() => { store.saveNamedScenario(name); setName(''); setMessage('Scenario saved in this browser.') }}><Save size={15} /> Save snapshot</button>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Scenario comparison</h2>
        <div className="scroll" style={{ maxHeight: 'none' }}>
          <table>
            <thead><tr><th>Scenario</th><th>Planning path</th><th>Architecture</th><th className="num">VMs</th><th className="num">Nodes</th><th>Result</th><th>Constraint</th><th className="num">Storage</th><th>Evidence</th><th /></tr></thead>
            <tbody>
              {comparison.map(({ scenario, design, result, architecture, nodes, resultLabel, storage }) => (
                <tr key={scenario.id}>
                  <td><strong>{scenario.name}</strong>{scenario.createdAt && <div className="small muted">{new Date(scenario.createdAt).toLocaleString()}</div>}</td>
                  <td>{scenario.engagementMode ? ENGAGEMENT_LABELS[scenario.engagementMode] : 'Not selected'}</td>
                  <td>{architecture}</td>
                  <td className="num">{scenario.vms.filter((vm) => vm.include).length.toLocaleString()}</td>
                  <td className="num"><strong>{nodes}</strong></td>
                  <td><span className={`pill ${design.feasible === true ? 'ok' : design.feasible === false ? 'err' : 'info'}`}>{resultLabel}</span></td>
                  <td>{result ? <span className="pill info">{result.binding}</span> : 'Not assessed'}</td>
                  <td className="num">{storage}</td>
                  <td>{result ? `${result.performanceAssessment.confidence.replace('-', ' ')} · ${result.performanceAssessment.score}/100` : 'Management inputs only'}</td>
                  <td className="nowrap">
                    {scenario.id !== 'current' && <>
                      <button className="btn ghost" onClick={() => store.loadNamedScenario(scenario.id)}>Load</button>{' '}
                      <button className="btn danger" aria-label={`Delete ${scenario.name}`} onClick={() => store.deleteNamedScenario(scenario.id)}><Trash2 size={14} /></button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {store.savedScenarios.length === 0 && <p className="small muted">Save at least one named scenario to compare it with the current working design.</p>}
      </section>
    </>
  )
}
