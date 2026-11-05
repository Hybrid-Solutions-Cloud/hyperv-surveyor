import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { WorkloadPanel } from '../components/WorkloadPanel'
import { JourneyBar } from '../components/JourneyBar'
import { PageHeader } from '../components/Shared'
import { WorkflowNav } from '../components/WorkflowNav'
import { useSurveyorStore } from '../state/store'
import { newPlatformStep } from '../state/journey'

export default function WorkloadsPage() {
  const { vms, setVms, tiers, addDataSource, engagementMode, lastImport, applyImport, clearWorkloads, loadDemo } = useSurveyorStore()
  const step = newPlatformStep('/workloads')
  const next = engagementMode === 'fit-gap' || engagementMode === 'existing-capacity'
    ? { to: '/capacity', label: 'Continue to existing hardware' }
    : engagementMode === 'management-only'
      ? { to: '/management-plane', label: 'Continue to management' }
      : { to: step.next.to, label: `Continue to ${step.next.label.toLowerCase()}` }
  const description = engagementMode === 'fit-gap'
    ? 'Provide the workload side of the fit decision. Next, describe the hardware you own or have been quoted.'
    : engagementMode === 'existing-capacity'
      ? 'Workload inventory is optional for a capacity envelope and required for measured utilization and remaining headroom.'
      : 'Bring in your estate from RVTools or another inventory. You do not need to know your hardware: the next steps check the data, ask about your goals, and then show every option your workload allows.'

  return (
    <>
      <PageHeader
        eyebrow={engagementMode === 'fit-gap' ? 'Fit and gap · Input 1 of 2' : engagementMode === 'existing-capacity' ? 'Optional workload evidence' : engagementMode === 'management-only' ? 'Workloads' : step.eyebrow}
        title="Workload inventory"
        description={description}
        actions={<Link className="btn link-btn" to={next.to}>{next.label} <ArrowRight size={15} /></Link>}
      />
      <JourneyBar detail={engagementMode === 'fit-gap' ? 'Workloads and existing hardware remain independent inputs until the fit calculation.' : undefined} />
      <WorkloadPanel vms={vms} setVms={setVms} tiers={tiers} report={lastImport} onImport={applyImport} onClearAll={clearWorkloads} onLoadDemo={loadDemo} onPerformanceSource={addDataSource} />
      <WorkflowNav
        previous={{ to: '/', label: 'Choose planning path' }}
        next={[{ to: next.to, label: next.label.replace('Continue to ', ''), description: engagementMode === 'new-platform' || engagementMode === null ? 'Review what is counted, excluded and unusual before anything is sized.' : description }]}
      />
    </>
  )
}
