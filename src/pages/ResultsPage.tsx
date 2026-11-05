import { exportDesign } from '../io/exportXlsx'
import { usePlatformDesign } from '../state/usePlatformDesign'
import { ENGAGEMENT_LABELS } from '../state/journey'
import { ResultsPanel } from '../components/ResultsPanel'
import { ClusterLayoutPanel } from '../components/ClusterLayoutPanel'
import { ReferenceServerPanel } from '../components/ReferenceServerPanel'
import { StorageDecisionPanel } from '../components/StorageDecisionPanel'
import { hardwareInputProblems } from '../engine/validate'
import { PageHeader } from '../components/Shared'
import { Link } from 'react-router-dom'
import { useSurveyorStore } from '../state/store'
import { JourneyBar } from '../components/JourneyBar'
import { ManagementCheckpoint } from '../components/ManagementCheckpoint'
import { WorkflowNav } from '../components/WorkflowNav'

export default function ResultsPage() {
  const { cfg, setCfg, vms, tiers, setChosenKey, sharedInventoryOmitted, placementInputs, setPlacementInputs, storageDecisionAnswers, setStorageDecisionAnswers, engagementMode } = useSurveyorStore()
  // This page always shows the new-platform design, even when it is opened from another path.
  const design = usePlatformDesign({ engagementMode: 'new-platform' })
  const options = design.options
  const chosen = design.chosen ?? options[0]
  const offPath = engagementMode !== null && engagementMode !== 'new-platform'
  const problems = hardwareInputProblems(cfg)

  return (
    <>
      <PageHeader
        eyebrow={offPath ? `Not part of your path (${ENGAGEMENT_LABELS[engagementMode!]}) · New platform` : 'New platform · Platform outcome'}
        title="New-platform results"
        description="Compare the same workload across SAN, S2D, and hybrid, see what limits each one, then choose your storage type, cluster layout, and server size."
      />
      <JourneyBar detail="This result answers how much new infrastructure is required. Existing-hardware fit is calculated in Existing hardware & fit." />
      {offPath && <div className="note warn" style={{ marginBottom: 16 }}><strong>This page is for the new-platform path</strong>Your current path is {ENGAGEMENT_LABELS[engagementMode!]}. The report, Implementation plan and Management page use that path, not the figures below.</div>}
      {sharedInventoryOmitted !== null && vms.length === 0 && (
        <div className="note err" style={{ marginBottom: 16 }}>
          <strong>This shared link omitted {sharedInventoryOmitted.toLocaleString()} workload records</strong>
          Results are intentionally blocked because calculating from an empty inventory would be misleading. Ask for the Surveyor project file, then open it from Project &amp; scenarios.
          <div style={{ marginTop: 10 }}><Link className="btn link-btn" to="/project">Open a project file</Link></div>
        </div>
      )}
      {problems.length > 0 && (
        <div className="note err" style={{ marginBottom: 16 }}>
          <strong>Results below are not reliable until these values are fixed</strong>
          {problems.map((problem) => <div key={problem}>{problem}</div>)}
          <div style={{ marginTop: 10 }}><Link className="btn link-btn" to="/configuration">Go to Hardware and assumptions</Link></div>
        </div>
      )}
      {!(sharedInventoryOmitted !== null && vms.length === 0) && (
      <ResultsPanel
        design={design}
        setChosenKey={setChosenKey}
        tiers={tiers}
        onExport={() => exportDesign(design, vms)}
        beforeComparison={<StorageDecisionPanel answers={storageDecisionAnswers} setAnswers={setStorageDecisionAnswers} options={options} chosenKey={chosen.key} setChosenKey={setChosenKey} />}
        designChoices={<>
          <ClusterLayoutPanel option={chosen} vms={vms} tiers={tiers} inputs={placementInputs} setInputs={setPlacementInputs} managementVms={design.management.countedVms} />
          <ReferenceServerPanel option={chosen} vms={vms} tiers={tiers} cfg={cfg} setCfg={setCfg} managementVms={design.management.countedVms} />
        </>}
      />
      )}
      {vms.some((vm) => vm.include) && !(sharedInventoryOmitted !== null && vms.length === 0) && <ManagementCheckpoint context="new-platform" />}
      <WorkflowNav
        previous={{ to: '/configuration', label: 'Hardware and assumptions' }}
        next={vms.some((vm) => vm.include) && !(sharedInventoryOmitted !== null && vms.length === 0)
          ? [{ to: '/management-plane', label: 'Management Plane Advisor', description: 'Turn the selected platform into a management recommendation and deployment BOM.' }]
          : [{ to: '/workloads', label: 'Workload inventory', description: 'Add workload evidence before continuing the design.' }]}
      />
    </>
  )
}
