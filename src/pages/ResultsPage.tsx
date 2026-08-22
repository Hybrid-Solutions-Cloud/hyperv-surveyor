import { exportDesign } from '../io/exportXlsx'
import { compareArchitectures } from '../engine/solve'
import { ResultsPanel } from '../components/ResultsPanel'
import { PageHeader } from '../components/Shared'
import { Link } from 'react-router-dom'
import { useSurveyorStore } from '../state/store'

export default function ResultsPage() {
  const { cfg, vms, tiers, chosenKey, setChosenKey, sharedInventoryOmitted } = useSurveyorStore()
  const options = compareArchitectures(cfg, vms, tiers)
  const chosen = options.find((option) => option.key === chosenKey) ?? options[0]

  return (
    <>
      <PageHeader
        eyebrow="Step 3"
        title="Sizing results"
        description="Compare the same workload across every supported architecture and see the CPU, memory, or storage constraint that determines each answer."
      />
      {sharedInventoryOmitted !== null && vms.length === 0 && (
        <div className="note err" style={{ marginBottom: 16 }}>
          <strong>This shared link omitted {sharedInventoryOmitted.toLocaleString()} workload records</strong>
          Results are intentionally blocked because calculating from an empty inventory would be misleading. Ask for the Surveyor project file, then open it from Project &amp; scenarios.
          <div style={{ marginTop: 10 }}><Link className="btn link-btn" to="/project">Open a project file</Link></div>
        </div>
      )}
      {!(sharedInventoryOmitted !== null && vms.length === 0) && (
      <ResultsPanel
        options={options}
        chosenKey={chosen.key}
        setChosenKey={setChosenKey}
        tiers={tiers}
        vms={vms}
        onExport={() => exportDesign(options, chosen, chosen.cfg, tiers, vms)}
      />
      )}
    </>
  )
}
