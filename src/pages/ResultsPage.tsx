import { exportDesign } from '../io/exportXlsx'
import { compareArchitectures } from '../engine/solve'
import { ResultsPanel } from '../components/ResultsPanel'
import { PageHeader } from '../components/Shared'
import { useSurveyorStore } from '../state/store'

export default function ResultsPage() {
  const { cfg, vms, tiers, chosenKey, setChosenKey } = useSurveyorStore()
  const options = compareArchitectures(cfg, vms, tiers)
  const chosen = options.find((option) => option.key === chosenKey) ?? options[0]

  return (
    <>
      <PageHeader
        eyebrow="Step 3"
        title="Sizing results"
        description="Compare the same workload across every supported architecture and see the CPU, memory, or storage constraint that determines each answer."
      />
      <ResultsPanel
        options={options}
        chosenKey={chosen.key}
        setChosenKey={setChosenKey}
        tiers={tiers}
        onExport={() => exportDesign(options, chosen, chosen.cfg, tiers, vms)}
      />
    </>
  )
}
