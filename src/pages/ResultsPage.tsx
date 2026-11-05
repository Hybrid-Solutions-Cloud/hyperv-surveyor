import { Link } from 'react-router-dom'
import { usePlatformDesign, useOptionsMatrix } from '../state/usePlatformDesign'
import { OptionsMatrixPanel, SplitOptionsPanel } from '../components/OptionsMatrixPanel'
import { ClusterLayoutPanel } from '../components/ClusterLayoutPanel'
import { NewPlatformHeader, NewPlatformNav } from '../components/NewPlatformStep'
import { hardwareInputProblems } from '../engine/validate'
import { useSurveyorStore } from '../state/store'

/** Options: every storage option, server size and drive layout your workload allows. */
export default function ResultsPage() {
  const { cfg, vms, tiers, chosenKey, sharedInventoryOmitted, placementInputs, setPlacementInputs, selectDesignOption } = useSurveyorStore()
  // This page always shows the new-platform design, even when it is opened from another path.
  const design = usePlatformDesign({ engagementMode: 'new-platform' })
  const matrix = useOptionsMatrix(design)
  const chosen = design.chosen ?? design.options[0]
  // C14: problems for the option in use, not for the base SAN configuration.
  const problems = hardwareInputProblems(design.cfg)
  const blocked = sharedInventoryOmitted !== null && vms.length === 0
  const hasWorkloads = vms.some((vm) => vm.include)

  return (
    <>
      <NewPlatformHeader
        route="/results"
        description="Every storage option (SAN, each S2D resiliency, hybrid) on every server size and S2D drive layout, with what fits one cluster, what binds, and why any option is ruled out. Selecting a row sets your storage, server and drives."
      />
      {blocked && (
        <div className="note err" style={{ marginBottom: 16 }}>
          <strong>This shared link omitted {sharedInventoryOmitted!.toLocaleString()} workload records</strong>
          Options are intentionally blocked because calculating from an empty inventory would be misleading. Ask for the Surveyor project file, then open it from Project &amp; scenarios.
          <div style={{ marginTop: 10 }}><Link className="btn link-btn" to="/project">Open a project file</Link></div>
        </div>
      )}
      {!blocked && !hasWorkloads && <div className="panel"><p className="muted">Add workloads first. <Link to="/workloads">Import an inventory</Link>.</p></div>}
      {!blocked && hasWorkloads && matrix && (
        <div className="stack">
          <div className={`note ${design.feasible ? 'ok' : 'warn'}`}>
            <strong>In use now: {design.platformLabel} on {cfg.node.sockets} × {cfg.node.coresPerSocket} cores, {cfg.node.ramGiB.toLocaleString()} GiB{chosen.cfg.architecture !== 'san' ? `, ${cfg.node.capacityDrivesPerNode} × ${cfg.node.capacityDriveTB} TB drives` : ''}</strong>
            {design.headline}. {design.feasible ? 'See the Shortlist for ranked starting points, or select any viable row.' : 'Select a viable row, or see the Shortlist.'}
          </div>
          {problems.length > 0 && (
            <div className="note err">
              <strong>The option in use has input problems</strong>
              {problems.map((problem) => <div key={problem}>{problem}</div>)}
              <div style={{ marginTop: 10 }}><Link className="btn link-btn" to="/configuration">Refine assumptions</Link></div>
            </div>
          )}
          <OptionsMatrixPanel matrix={matrix} cfg={cfg} chosenKey={chosenKey} onSelect={(option) => selectDesignOption(option)} />
          <SplitOptionsPanel
            candidates={matrix.splitCandidates}
            vms={vms}
            tiers={tiers}
            managementVms={design.management.countedVms}
            placementInputs={placementInputs}
            onChooseSplit={(option) => selectDesignOption(option, 'split')}
          />
          <ClusterLayoutPanel option={chosen} vms={vms} tiers={tiers} inputs={placementInputs} setInputs={setPlacementInputs} managementVms={design.management.countedVms} />
        </div>
      )}
      <NewPlatformNav route="/results" nextDescription="The top three viable options, ranked by stated criteria, with trade-offs." />
    </>
  )
}
