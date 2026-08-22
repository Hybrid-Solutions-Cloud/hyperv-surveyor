import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { WorkloadPanel } from '../components/WorkloadPanel'
import { JourneyBar } from '../components/JourneyBar'
import { PageHeader } from '../components/Shared'
import { WorkflowNav } from '../components/WorkflowNav'
import { useSurveyorStore } from '../state/store'

export default function WorkloadsPage() {
  const { vms, setVms, tiers, addDataSource, engagementMode } = useSurveyorStore()
  const next = engagementMode === 'fit-gap' || engagementMode === 'existing-capacity'
    ? { to: '/capacity', label: 'Continue to existing hardware' }
    : engagementMode === 'management-only'
      ? { to: '/management-plane', label: 'Continue to management' }
      : { to: '/configuration', label: 'Continue to proposed hardware' }
  const description = engagementMode === 'fit-gap'
    ? 'Provide the workload side of the fit decision. Next, describe the hardware the customer already owns or has been quoted.'
    : engagementMode === 'existing-capacity'
      ? 'Workload inventory is optional for a capacity envelope and required for measured utilization and remaining headroom.'
      : 'Bring in the estate, review the assumptions, and decide what belongs in the design. Imported and manual workloads use the same editable model.'

  return (
    <>
      <PageHeader
        eyebrow={engagementMode === 'fit-gap' ? 'Fit and gap · Input 1 of 2' : engagementMode === 'existing-capacity' ? 'Optional workload evidence' : 'New platform · Step 1'}
        title="Workload inventory"
        description={description}
        actions={<Link className="btn link-btn" to={next.to}>{next.label} <ArrowRight size={15} /></Link>}
      />
      <JourneyBar detail={engagementMode === 'fit-gap' ? 'Workloads and existing hardware remain independent inputs until the fit calculation.' : undefined} />
      <WorkloadPanel vms={vms} setVms={setVms} tiers={tiers} onDataSource={addDataSource} />
      <WorkflowNav
        previous={{ to: '/', label: 'Choose planning path' }}
        next={[{ to: next.to, label: next.label.replace('Continue to ', ''), description }]}
      />
    </>
  )
}
