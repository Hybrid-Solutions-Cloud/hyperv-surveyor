import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { ConfigPanel } from '../components/ConfigPanel'
import { JourneyBar } from '../components/JourneyBar'
import { PageHeader } from '../components/Shared'
import { useSurveyorStore } from '../state/store'

export default function ConfigurationPage() {
  const { cfg, setCfg, tiers, setTiers } = useSurveyorStore()

  return (
    <>
      <PageHeader
        eyebrow="New platform · Step 2"
        title="Hardware and assumptions"
        description="Set the proposed node, resilience policy, storage configuration, host reserves, and workload treatment used by every comparison."
        actions={<Link className="btn link-btn" to="/results">Calculate designs <ArrowRight size={15} /></Link>}
      />
      <JourneyBar detail="These are proposed-design assumptions and remain separate from the existing-hardware profile." />
      <ConfigPanel cfg={cfg} setCfg={setCfg} tiers={tiers} setTiers={setTiers} />
    </>
  )
}
