import { PageHeader } from '../components/Shared'
import { useSurveyorStore } from '../state/store'
import { JourneyBar } from '../components/JourneyBar'
import { ManagementCheckpoint } from '../components/ManagementCheckpoint'
import { ArrowRight, Download } from 'lucide-react'
import { Link } from 'react-router-dom'
import { exportExistingCapacity } from '../io/exportXlsx'
import { WorkflowNav } from '../components/WorkflowNav'
import { usePlatformDesign } from '../state/usePlatformDesign'
import { ENGAGEMENT_LABELS } from '../state/journey'
import { ExistingHardwarePanel } from '../components/ExistingHardwarePanel'
import { ExistingResultsPanel } from '../components/ExistingResultsPanel'

export default function CapacityPage() {
  const store = useSurveyorStore()
  const { vms, engagementMode } = store
  const fitGap = engagementMode === 'fit-gap'
  const onExistingPath = engagementMode === 'existing-capacity' || engagementMode === 'fit-gap'
  const included = vms.filter((vm) => vm.include).length
  // The same design every other page reads. Off the existing paths this page is read as existing capacity.
  const design = usePlatformDesign(onExistingPath ? {} : { engagementMode: 'existing-capacity' })
  const assessment = design.existing
  // Counted only when the management plane really shares this hardware.
  const managementVms = design.management.countedVms
  const importedHosts = store.lastImport?.hostSummary?.perHost ?? []

  return (
    <>
      <PageHeader
        eyebrow={fitGap ? 'Fit and gap · Input 2 of 2' : onExistingPath ? 'Existing capacity · Platform outcome' : `Not part of your path${engagementMode ? ` (${ENGAGEMENT_LABELS[engagementMode]})` : ''} · Existing capacity`}
        title={fitGap ? 'Does your workload fit your hardware?' : 'What can your hardware carry?'}
        description={fitGap
          ? 'Test your workloads on your hosts. You get a verdict that reflects placement on real hosts, every limit and storage performance, and separate fixes for compute, storage and performance.'
          : 'Enter the hardware you already own to see its capacity, headroom by resource, what runs out first, how many more VMs of a profile you choose fit, and when growth uses it up.'}
        actions={<div className="row page-action-row">
          <button className="btn ghost" type="button" onClick={() => exportExistingCapacity(design, vms, useSurveyorStore.getState().costModel)}><Download size={15} /> Download workbook</button>
          {included === 0
            ? <Link className="btn link-btn" to="/workloads">Add workload evidence <ArrowRight size={15} /></Link>
            : <Link className="btn link-btn" to="/management-plane">Continue to management <ArrowRight size={15} /></Link>}
        </div>}
      />
      <JourneyBar detail={fitGap ? 'Your workload inventory and your hardware are combined here without changing the new-platform assumptions.' : 'An inventory is optional for capacity and required for a fit result.'} />
      <ExistingHardwarePanel
        hardware={store.existingHardware}
        setHardware={store.setExistingHardware}
        confirm={store.confirmExistingHardware}
        importedHosts={importedHosts}
        fillFromImport={store.fillExistingHardwareFromImport}
        policy={store.existingCapacityCfg}
        setPolicy={store.setExistingCapacityCfg}
        tiers={store.existingCapacityTiers}
        setTiers={store.setExistingCapacityTiers}
        reset={store.resetExistingCapacity}
        includedVms={included}
      />
      {assessment && (
        <ExistingResultsPanel
          assessment={assessment}
          hardware={store.existingHardware}
          tiers={design.tiers}
          fitPath={fitGap}
          setProfile={store.setExistingVmProfile}
          setAddSpec={store.setExistingAddSpec}
          managementImpact={design.management.impactLabel}
        />
      )}
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
