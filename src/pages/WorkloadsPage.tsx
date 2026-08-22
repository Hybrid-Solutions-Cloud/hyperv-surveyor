import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { WorkloadPanel } from '../components/WorkloadPanel'
import { PageHeader } from '../components/Shared'
import { useSurveyorStore } from '../state/store'

export default function WorkloadsPage() {
  const { vms, setVms, tiers, addDataSource } = useSurveyorStore()

  return (
    <>
      <PageHeader
        eyebrow="Step 1"
        title="Workload inventory"
        description="Bring in the estate, review the assumptions, and decide what belongs in the design. Imported and manual workloads use the same editable model."
        actions={<Link className="btn link-btn" to="/configuration">Continue to hardware <ArrowRight size={15} /></Link>}
      />
      <WorkloadPanel vms={vms} setVms={setVms} tiers={tiers} onDataSource={addDataSource} />
    </>
  )
}
