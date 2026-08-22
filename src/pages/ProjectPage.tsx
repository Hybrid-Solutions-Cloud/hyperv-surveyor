import { useMemo, useRef, useState } from 'react'
import { Download, FolderOpen, Save, Trash2, Upload } from 'lucide-react'
import { compareArchitectures, solveForward } from '../engine/solve'
import { PageHeader } from '../components/Shared'
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
  }

  const comparison = useMemo(() => [
    { id: 'current', name: 'Current working design', createdAt: '', ...currentPayload },
    ...store.savedScenarios,
  ].map((scenario) => {
    const options = compareArchitectures(scenario.cfg, scenario.vms, scenario.tiers)
    const selected = options.find((option) => option.key === scenario.chosenKey) ?? options[0]
    const usesExisting = scenario.engagementMode === 'existing-capacity' || scenario.engagementMode === 'fit-gap'
    const managementOnly = scenario.engagementMode === 'management-only'
    const result = managementOnly
      ? null
      : usesExisting
        ? solveForward(scenario.existingCapacityCfg, scenario.vms, scenario.existingCapacityTiers)
        : selected.result
    const architecture = managementOnly
      ? 'Management only'
      : usesExisting ? `Existing ${scenario.existingCapacityCfg.architecture.toUpperCase()}` : selected.label
    const nodes = managementOnly
      ? '—'
      : usesExisting ? `${scenario.existingCapacityNodes} existing` : result?.feasible ? result.nodes.toLocaleString() : 'Review'
    return { scenario, result, architecture, nodes }
  }), [store.engagementMode, store.managementDecision, store.cfg, store.vms, store.tiers, store.chosenKey, store.customerName, store.existingCapacityCfg, store.existingCapacityTiers, store.existingCapacityNodes, store.managementDeploymentInputs, store.includeManagementInSizing, store.placementInputs, store.networkDesignInputs, store.drDesignInputs, store.reportMetadata, store.dataSources, store.savedScenarios])

  async function openProject(file: File) {
    setError('')
    try {
      const project = parseProject(await file.text())
      store.loadProject(project.payload)
      setMessage(`Opened project exported ${new Date(project.exportedAt).toLocaleString()} with engine ${project.engineVersion}.`)
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
      />

      <div className="grid two">
        <section className="panel">
          <h2><FolderOpen size={17} /> Project file</h2>
          <p className="small muted">The project file is the portable source of truth. It contains the complete inventory, measurements, assumptions, management design, and existing-capacity workspace.</p>
          <div className="row">
            <button className="btn" onClick={() => downloadProject(createProject(currentPayload))}><Download size={15} /> Download project</button>
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
            <thead><tr><th>Scenario</th><th>Planning path</th><th>Architecture</th><th className="num">VMs</th><th className="num">Nodes</th><th>Constraint</th><th className="num">Storage</th><th>Evidence</th><th /></tr></thead>
            <tbody>
              {comparison.map(({ scenario, result, architecture, nodes }) => (
                <tr key={scenario.id}>
                  <td><strong>{scenario.name}</strong>{scenario.createdAt && <div className="small muted">{new Date(scenario.createdAt).toLocaleString()}</div>}</td>
                  <td>{scenario.engagementMode ? ENGAGEMENT_LABELS[scenario.engagementMode] : 'Not selected'}</td>
                  <td>{architecture}</td>
                  <td className="num">{scenario.vms.filter((vm) => vm.include).length.toLocaleString()}</td>
                  <td className="num"><strong>{nodes}</strong></td>
                  <td>{result ? <span className={`pill ${result.feasible ? 'info' : 'err'}`}>{result.binding}</span> : 'Not assessed'}</td>
                  <td className="num">{result ? `${result.requiredStorageTiB.toFixed(1)} TiB` : '—'}</td>
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
