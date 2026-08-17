import { ReversePanel } from '../components/ReversePanel'
import { PageHeader } from '../components/Shared'
import { useSurveyorStore } from '../state/store'

export default function CapacityPage() {
  const { cfg, tiers, vms } = useSurveyorStore()

  return (
    <>
      <PageHeader
        eyebrow="Reuse and expansion"
        title="Existing-hardware capacity"
        description="Fix the hardware the customer already owns and calculate the workload headroom, including which resource is exhausted first."
      />
      <ReversePanel cfg={cfg} tiers={tiers} vms={vms} />
    </>
  )
}
