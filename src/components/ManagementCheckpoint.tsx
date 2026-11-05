import { ArrowRight, CheckCircle2, Clock3, Network } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSurveyorStore } from '../state/store'

const labels = {
  unassessed: 'No management decision recorded',
  design: 'Management-plane design selected',
  existing: 'Existing management solution recorded',
  deferred: 'Management decision deferred',
} as const

export function ManagementCheckpoint({ context, countedManagementVms = 0 }: {
  context: 'new-platform' | 'existing-capacity' | 'fit-gap'
  /** Management VMs already counted in the results on this page. */
  countedManagementVms?: number
}) {
  const decision = useSurveyorStore((state) => state.managementDecision)
  const setDecision = useSurveyorStore((state) => state.setManagementDecision)
  const contextCopy = context === 'new-platform'
    ? 'Use the calculated platform size to build the VMM, WAC, SCOM, SQL, Arc, placement, and HA design.'
    : countedManagementVms > 0
      ? `The ${countedManagementVms.toLocaleString()} management VMs from your design are placed on this hardware and are counted in the results above.`
      : 'Management VMs are not counted in the results above. They count once you design the management plane, place it on the workload cluster, and keep it included in sizing.'

  return (
    <section className="panel management-checkpoint">
      <div className="checkpoint-heading">
        <div className="checkpoint-icon"><Network size={21} /></div>
        <div><span>Platform outcome checkpoint</span><h2>How will this platform be managed?</h2><p>{contextCopy}</p></div>
        <div className={`checkpoint-status ${decision}`}><CheckCircle2 size={14} /> {labels[decision]}</div>
      </div>
      <div className="checkpoint-options">
        <Link className="checkpoint-option primary" to="/management-plane" onClick={() => setDecision('design')}>
          <strong>Design the management plane</strong><span>Get the recommendation, deployment BOM, placement impact, and cost model.</span><ArrowRight size={16} />
        </Link>
        <button className={`checkpoint-option ${decision === 'existing' ? 'selected' : ''}`} type="button" onClick={() => setDecision('existing')}>
          <strong>Use an existing management solution</strong><span>Record that the operating model is already supplied and continue.</span><CheckCircle2 size={16} />
        </button>
        <button className={`checkpoint-option ${decision === 'deferred' ? 'selected' : ''}`} type="button" onClick={() => setDecision('deferred')}>
          <strong>Decide later</strong><span>Keep the decision visibly open in the report instead of treating it as “none.”</span><Clock3 size={16} />
        </button>
      </div>
      {(decision === 'existing' || decision === 'deferred') && <div className="checkpoint-next"><Link className="btn ghost" to="/deployment">Continue to implementation planning <ArrowRight size={15} /></Link></div>}
    </section>
  )
}
