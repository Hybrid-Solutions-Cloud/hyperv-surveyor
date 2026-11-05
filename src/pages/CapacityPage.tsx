import { ReversePanel } from '../components/ReversePanel'
import { PageHeader } from '../components/Shared'
import { useSurveyorStore } from '../state/store'
import { FitGapPanel } from '../components/FitGapPanel'
import { JourneyBar } from '../components/JourneyBar'
import { ManagementCheckpoint } from '../components/ManagementCheckpoint'
import { useMemo } from 'react'
import { ArrowRight, Download } from 'lucide-react'
import { Link } from 'react-router-dom'
import { exportExistingCapacity } from '../io/exportXlsx'
import { WorkflowNav } from '../components/WorkflowNav'
import { usePlatformDesign } from '../state/usePlatformDesign'
import { ENGAGEMENT_LABELS } from '../state/journey'

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
  const onExistingPath = engagementMode === 'existing-capacity' || engagementMode === 'fit-gap'
  const included = vms.filter((vm) => vm.include).length
  // The same design every other page reads. Off the existing paths this page is read as existing capacity.
  const design = usePlatformDesign(onExistingPath ? {} : { engagementMode: 'existing-capacity' })
  // Counted only when the management plane really shares this hardware.
  const managementVms = design.management.countedVms

  return (
    <>
      <PageHeader
        eyebrow={fitGap ? 'Fit and gap · Input 2 of 2' : onExistingPath ? 'Existing capacity · Platform outcome' : `Not part of your path${engagementMode ? ` (${ENGAGEMENT_LABELS[engagementMode]})` : ''} · Existing capacity`}
        title={fitGap ? 'Workload fit and hardware gap' : 'Existing-hardware capacity'}
        description={fitGap ? 'Test the included workload against fixed hardware, identify every deficit, and determine whether same-spec node expansion can close the gap.' : 'Fix the hardware the customer already owns and calculate its capacity envelope, workload headroom, and first exhausted resource.'}
        actions={<div className="row page-action-row">
          <button className="btn ghost" type="button" onClick={() => exportExistingCapacity(design, vms)}><Download size={15} /> Download workbook</button>
          {included === 0
            ? <Link className="btn link-btn" to="/workloads">Add workload evidence <ArrowRight size={15} /></Link>
            : <Link className="btn link-btn" to="/management-plane">Continue to management <ArrowRight size={15} /></Link>}
        </div>}
      />
      <JourneyBar detail={fitGap ? 'The workload inventory and existing-hardware profile are combined here without changing the proposed-design assumptions.' : 'An inventory is optional for total capacity and required for an estate-specific utilization result.'} />
      {fitGap && <FitGapPanel cfg={existingCapacityCfg} nodes={existingCapacityNodes} vms={vms} tiers={existingCapacityTiers} managementVms={managementVms} />}
      <ReversePanel
        cfg={existingCapacityCfg}
        setCfg={setExistingCapacityCfg}
        tiers={existingCapacityTiers}
        setTiers={setExistingCapacityTiers}
        nodes={existingCapacityNodes}
        setNodes={setExistingCapacityNodes}
        reset={resetExistingCapacity}
        vms={vms}
        managementVms={managementVms}
      />
      <ManagementCheckpoint context={fitGap ? 'fit-gap' : 'existing-capacity'} countedManagementVms={managementVms.length} />
      <WorkflowNav
        previous={{ to: fitGap ? '/workloads' : '/', label: fitGap ? 'Workload inventory' : 'Choose planning path' }}
        next={fitGap && included === 0
          ? [{ to: '/workloads', label: 'Add workload evidence', description: 'A workload inventory is required to calculate fit and gap.' }]
          : [{ to: '/management-plane', label: 'Management Plane Advisor', description: 'Use this hardware context to design the management solution.' }]}
      />
    </>
  )
}
