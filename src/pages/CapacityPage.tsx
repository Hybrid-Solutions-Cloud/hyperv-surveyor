import { ReversePanel } from '../components/ReversePanel'
import { PageHeader } from '../components/Shared'
import { useSurveyorStore } from '../state/store'
import { FitGapPanel } from '../components/FitGapPanel'
import { JourneyBar } from '../components/JourneyBar'
import { ManagementCheckpoint } from '../components/ManagementCheckpoint'
import { ArrowRight, Download } from 'lucide-react'
import { Link } from 'react-router-dom'
import { exportExistingCapacity } from '../io/exportXlsx'

export default function CapacityPage() {
  const {
    existingCapacityCfg,
    existingCapacityTiers,
    existingCapacityNodes,
    setExistingCapacityCfg,
    setExistingCapacityTiers,
    setExistingCapacityNodes,
    resetExistingCapacity,
    vms,
    engagementMode,
  } = useSurveyorStore()
  const fitGap = engagementMode === 'fit-gap'
  const included = vms.filter((vm) => vm.include).length

  return (
    <>
      <PageHeader
        eyebrow={fitGap ? 'Fit and gap · Input 2 of 2' : 'Existing capacity · Platform outcome'}
        title={fitGap ? 'Workload fit and hardware gap' : 'Existing-hardware capacity'}
        description={fitGap ? 'Test the included workload against fixed hardware, identify every deficit, and determine whether same-spec node expansion can close the gap.' : 'Fix the hardware the customer already owns and calculate its capacity envelope, workload headroom, and first exhausted resource.'}
        actions={<div className="row page-action-row">
          <button className="btn ghost" type="button" onClick={() => exportExistingCapacity(existingCapacityCfg, existingCapacityNodes, existingCapacityTiers, vms, engagementMode)}><Download size={15} /> Download workbook</button>
          {included === 0
            ? <Link className="btn link-btn" to="/workloads">Add workload evidence <ArrowRight size={15} /></Link>
            : <Link className="btn link-btn" to="/management-plane">Continue to management <ArrowRight size={15} /></Link>}
        </div>}
      />
      <JourneyBar detail={fitGap ? 'The workload inventory and existing-hardware profile are combined here without changing the proposed-design assumptions.' : 'An inventory is optional for total capacity and required for an estate-specific utilization result.'} />
      {fitGap && <FitGapPanel cfg={existingCapacityCfg} nodes={existingCapacityNodes} vms={vms} tiers={existingCapacityTiers} />}
      <ReversePanel
        cfg={existingCapacityCfg}
        setCfg={setExistingCapacityCfg}
        tiers={existingCapacityTiers}
        setTiers={setExistingCapacityTiers}
        nodes={existingCapacityNodes}
        setNodes={setExistingCapacityNodes}
        reset={resetExistingCapacity}
        vms={vms}
      />
      <ManagementCheckpoint context={fitGap ? 'fit-gap' : 'existing-capacity'} />
    </>
  )
}
