import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { ConfigPanel } from '../components/ConfigPanel'
import { JourneyBar } from '../components/JourneyBar'
import { PageHeader } from '../components/Shared'
import { WorkflowNav } from '../components/WorkflowNav'
import { useSurveyorStore } from '../state/store'

export default function ConfigurationPage() {
  const { cfg, setCfg, tiers, setTiers } = useSurveyorStore()

  return (
    <>
      <PageHeader
        eyebrow="New platform · Step 2"
        title="Hardware and assumptions"
        description="Starting assumptions for the comparison. You do not need final hardware: Surveyor uses these to work out the node count and the storage you need."
        actions={<Link className="btn link-btn" to="/results">Calculate designs <ArrowRight size={15} /></Link>}
      />
      <JourneyBar detail="These are proposed-design assumptions and remain separate from the existing-hardware profile." />
      <ConfigPanel cfg={cfg} setCfg={setCfg} tiers={tiers} setTiers={setTiers} />
      <WorkflowNav
        previous={{ to: '/workloads', label: 'Workload inventory' }}
        next={[{ to: '/results', label: 'Calculate designs', description: 'Compare SAN, S2D, and hybrid options using these assumptions.' }]}
      />
    </>
  )
}
