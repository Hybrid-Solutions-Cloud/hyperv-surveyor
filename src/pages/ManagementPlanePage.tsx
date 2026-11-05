import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  Check,
  CircleDollarSign,
  Database,
  GitCompareArrows,
  MessagesSquare,
  RotateCcw,
  Route,
  Search,
  ServerCog,
  ShieldAlert,
} from 'lucide-react'
import { usePlatformDesign } from '../state/usePlatformDesign'
import {
  ARC_SERVICE_CATALOG,
  normalizeManagementDeploymentInputs,
  planManagementDeployment,
  type ArcServiceId,
  type ManagementDeploymentInputs,
} from '../engine/managementDeployment'
import { advisorMatchSentence, applyAdvisorResult, withScaleChange, withStackChoice } from '../engine/managementAdvisor'
import type { PlatformDesign } from '../engine/platformDesign'
import { calculateProviderEconomics } from '../engine/managementCost'
import {
  arcMetersInUse, basisLabel, estimateLicensing, licensingQuantities, resolveRate,
  type ArcMeterId, type CommercialInputs, type CostModelInputs, type EditionChoice,
} from '../engine/licensing'
import { BasisPill, Field, NumberInput, PageHeader } from '../components/Shared'
import { useSurveyorStore } from '../state/store'
import {
  CAPABILITIES,
  DECISION_QUESTIONS,
  MANAGEMENT_PLANES,
  PRICE_ENTRIES,
  PRICES_CHECKED,
  recommendManagementPlane,
  type PriceKey,
  type AdvisorAnswers,
  type PlaneId,
} from '../data/managementPlane'
import { MANAGEMENT_WORKBOOK } from '../data/managementWorkbook.generated'
import { JourneyBar } from '../components/JourneyBar'
import { WorkflowNav } from '../components/WorkflowNav'

type AdvisorTab = 'recommend' | 'deploy' | 'compare' | 'cost' | 'vmware' | 'field' | 'sources'
export default function ManagementPlanePage() {
  const [tab, setTab] = useState<AdvisorTab>('recommend')
  // Answers are saved with the project, so they reach the deployment, the plan and the report.
  const answers = useSurveyorStore((state) => state.managementAdvisorAnswers)
  const setAnswers = useSurveyorStore((state) => state.setManagementAdvisorAnswers)
  const { vms, setManagementDecision } = useSurveyorStore()
  // The same design the report and the Implementation plan use: the chosen option, not the base config.
  const design = usePlatformDesign()
  const includedVms = vms.filter((vm) => vm.include).length
  const usesExistingHardware = design.path === 'existing'
  const managementOnly = design.path === 'management-only'
  // Defaults follow the design's node count, or the nodes it needs when it does not fit: never the cluster limit.
  const platformNodes = managementOnly ? design.management.inputs.managedHosts : design.totalNodes ?? design.management.contextNodes
  const platformLabel = design.platformLabel

  return (
    <>
      <PageHeader
        eyebrow="Operating model · Internal advisor"
        title="Management Plane Advisor"
        description="Turn the fabric requirements into an explainable operating-model recommendation, then compare capability and licensing impact."
      />
      <JourneyBar detail="This can follow any platform path or run independently when the infrastructure decision is already made." />

      <div className="advisor-context">
        <div><span>Platform context</span><strong>{platformLabel}</strong></div>
        <div><span>{usesExistingHardware ? 'Existing hosts' : managementOnly ? 'Managed hosts' : design.totalNodes === null ? 'Hosts the workload needs' : 'Calculated hosts'}</span><strong>{platformNodes || 'Enter in deployment design'}</strong>{!managementOnly && !usesExistingHardware && design.feasible === false && <small>The design does not fit yet</small>}</div>
        <div><span>Included workloads</span><strong>{includedVms.toLocaleString()} VMs</strong></div>
        <div className="advisor-freshness"><ShieldAlert size={16} /><span>Workbook-backed advisor library · qualifying questions fact-checked {MANAGEMENT_WORKBOOK.decisionQuestionsVerified} · verify commercial terms before quoting</span></div>
      </div>

      <div className="subtabs" role="tablist" aria-label="Management Plane Advisor sections">
        <TabButton active={tab === 'recommend'} onClick={() => setTab('recommend')} icon={Route}>Recommendation</TabButton>
        <TabButton active={tab === 'deploy'} onClick={() => setTab('deploy')} icon={ServerCog}>Deployment design</TabButton>
        <TabButton active={tab === 'compare'} onClick={() => setTab('compare')} icon={GitCompareArrows}>Capability comparison</TabButton>
        <TabButton active={tab === 'cost'} onClick={() => setTab('cost')} icon={CircleDollarSign}>Cost model</TabButton>
        <TabButton active={tab === 'vmware'} onClick={() => setTab('vmware')} icon={BookOpen}>VMware translation</TabButton>
        <TabButton active={tab === 'field'} onClick={() => setTab('field')} icon={MessagesSquare}>Field guide</TabButton>
        <TabButton active={tab === 'sources'} onClick={() => setTab('sources')} icon={Database}>Sources & SKUs</TabButton>
      </div>

      {tab === 'recommend' && <RecommendationPanel answers={answers} setAnswers={setAnswers} />}
      {tab === 'deploy' && (
        <DeploymentDesignerPanel
          design={design}
          platformKind={managementOnly ? 'management-only' : usesExistingHardware ? 'existing' : 'new'}
          platformNodes={platformNodes}
          onReviewAdvisor={() => setTab('recommend')}
        />
      )}
      {tab === 'compare' && <ComparisonPanel />}
      {tab === 'vmware' && <VmwarePanel />}
      {tab === 'field' && <FieldGuidePanel />}
      {tab === 'sources' && <SourcesPanel />}
      {tab === 'cost' && (
        <CostPanel design={design} />
      )}
      <WorkflowNav
        previous={{
          to: managementOnly ? '/' : usesExistingHardware ? '/capacity' : '/configuration',
          label: managementOnly ? 'Choose planning path' : usesExistingHardware ? 'Existing-hardware outcome' : 'Refine assumptions',
        }}
        next={[
          {
            to: '/deployment',
            label: 'Implementation plan',
            description: 'Carry the management design into placement, networking, migration, backup, and disaster recovery.',
            onClick: () => setManagementDecision('design'),
          },
          {
            to: '/report',
            label: 'Solution report',
            description: 'Build the selectable report and export it to HTML, Word, PDF, Markdown, or JSON.',
            onClick: () => setManagementDecision('design'),
          },
        ]}
      />
    </>
  )
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <button className={active ? 'subtab active' : 'subtab'} onClick={onClick} role="tab" aria-selected={active}>
      <Icon size={16} /> {children}
    </button>
  )
}

function RecommendationPanel({
  answers,
  setAnswers,
}: {
  answers: AdvisorAnswers
  setAnswers: (answers: AdvisorAnswers) => void
}) {
  const recommendation = recommendManagementPlane(answers)
  const answered = Object.values(answers).filter((answer) => answer !== undefined).length
  const statusLabel = recommendation.status === 'ready'
    ? 'Current recommendation'
    : recommendation.status === 'conflict'
      ? 'Requirements conflict'
      : 'Decision in progress'
  const StatusIcon = recommendation.status === 'ready'
    ? Check
    : recommendation.status === 'conflict'
      ? AlertTriangle
      : Route
  const remainingQuestions = recommendation.unansweredDecisionIds
    .map((id) => {
      const index = DECISION_QUESTIONS.findIndex((question) => question.id === id)
      return { index, question: DECISION_QUESTIONS[index] }
    })
    .filter((item) => item.index >= 0)

  return (
    <div className="advisor-layout">
      <section className="panel advisor-questions">
        <div className="panel-heading-row">
          <div>
            <h2>Qualifying questions</h2>
            <p className="small muted">Answer what is known. The recommendation updates immediately.</p>
          </div>
          <button className="btn ghost compact" onClick={() => setAnswers({})}><RotateCcw size={14} /> Reset</button>
        </div>

        <div className="progress-line"><i style={{ width: `${(answered / DECISION_QUESTIONS.length) * 100}%` }} /></div>
        <div className="question-count">{answered} of {DECISION_QUESTIONS.length} answered</div>

        <div className="question-list">
          {DECISION_QUESTIONS.map((question, index) => (
            <article className="question-card" key={question.id}>
              <div className="question-number">{String(index + 1).padStart(2, '0')}</div>
              <div className="question-copy">
                <strong>{question.question}</strong>
                <span>{question.why}</span>
                {question.sources.length > 0 && (
                  <div className="question-sources">
                    {question.sources.map((source) => (
                      <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label}</a>
                    ))}
                  </div>
                )}
                {answers[question.id] !== undefined && (
                  <div className={`question-outcome ${answers[question.id] ? 'yes' : 'no'}`}>
                    <b>{answers[question.id] ? 'If yes' : 'If no'}</b>
                    {answers[question.id] ? question.ifYes : question.ifNo}
                  </div>
                )}
              </div>
              <div className="binary-choice" aria-label={question.question}>
                <button
                  className={answers[question.id] === true ? 'selected yes' : ''}
                  aria-pressed={answers[question.id] === true}
                  onClick={() => setAnswers({ ...answers, [question.id]: true })}
                >Yes</button>
                <button
                  className={answers[question.id] === false ? 'selected no' : ''}
                  aria-pressed={answers[question.id] === false}
                  onClick={() => setAnswers({ ...answers, [question.id]: false })}
                >No</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="recommendation-column">
        <section className={`recommendation-card ${recommendation.status}`}>
          <div className="recommendation-kicker"><StatusIcon size={16} /> {statusLabel}</div>
          <h2>{recommendation.headline}</h2>

          {recommendation.stack.length > 0 && (
            <div className="stack-flow">
              {recommendation.stack.map((id, index) => {
                const plane = MANAGEMENT_PLANES.find((item) => item.id === id)!
                return (
                  <div className="stack-node" key={id}>
                    <span>{id === 'scvmm'
                      ? answers.bareMetal ? 'Bare-metal + fabric' : 'Fabric'
                      : answers.clusterCreation
                        ? 'Prepared-host cluster + day two'
                        : index === 0 ? 'Foundation' : 'Day two'}</span>
                    <strong>{plane.shortName}</strong>
                  </div>
                )
              })}
              {recommendation.arcServers && (
                <div className="stack-node">
                  <span>Optional Azure services</span>
                  <strong>Arc-enabled servers</strong>
                </div>
              )}
              {recommendation.monitoring !== 'none' && (
                <div className="stack-node">
                  <span>{recommendation.monitoring === 'scom' ? 'Monitoring' : 'Reporting and forecasting'}</span>
                  <strong>SCOM 2025</strong>
                </div>
              )}
            </div>
          )}

          <div className="candidate-groups">
            <div className="candidate-group">
              <span>{recommendation.status === 'ready' ? 'Eligible components' : 'Still available'}</span>
              <div className="candidate-pills">
                {recommendation.eligible.map((id) => (
                  <b key={id}>{MANAGEMENT_PLANES.find((plane) => plane.id === id)!.shortName}</b>
                ))}
              </div>
            </div>

            {recommendation.excluded.length > 0 && (
              <div className="candidate-group excluded">
                <span>Excluded by current answers</span>
                {recommendation.excluded.map((item) => (
                  <div className="candidate-exclusion" key={item.id}>
                    <b>{MANAGEMENT_PLANES.find((plane) => plane.id === item.id)!.shortName}</b>
                    <small>{item.reason}</small>
                  </div>
                ))}
              </div>
            )}

            {remainingQuestions.length > 0 && recommendation.status !== 'conflict' && (
              <div className="candidate-group remaining-gates">
                <span>Needed to finalize ({remainingQuestions.length})</span>
                {remainingQuestions.slice(0, 4).map((item) => (
                  <small key={item.question.id}>Question {item.index + 1}: {item.question.question}</small>
                ))}
                {remainingQuestions.length > 4 && <small>+ {remainingQuestions.length - 4} more decision gates</small>}
              </div>
            )}
          </div>

          <ul className="reason-list">
            {recommendation.rationale.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </section>

        {recommendation.cautions.length > 0 && (
          <section className="panel caution-panel">
            <h2><AlertTriangle size={16} /> Design cautions</h2>
            {recommendation.cautions.map((caution) => <p key={caution}>{caution}</p>)}
          </section>
        )}

        <section className="panel">
          <h2>Important framing</h2>
          <p className="small">
            Prefer WAC vMode when Preview is explicitly accepted and no selected requirement hits a
            documented capability gap; use aMode as the production fallback. WAC creates clusters from
            prepared hosts but does not install the host OS. Azure Arc-enabled servers are an optional add-on
            for Azure management services and do not change the fabric choice. Arc-enabled SCVMM stopped
            new onboarding in October 2026, so it is not offered here.
          </p>
        </section>
      </aside>
    </div>
  )
}

/** Stack fields: picking one of these makes the stack the user's, so it stops following the advisor. */
type StackPatch = Partial<Pick<ManagementDeploymentInputs, 'foundation' | 'wac' | 'monitoring' | 'includeArc' | 'arcServices' | 'highAvailability' | 'fabricHighAvailability' | 'scomHighAvailability' | 'scomSqlPlacement'>>

function DeploymentDesignerPanel({
  design,
  platformKind,
  platformNodes,
  onReviewAdvisor,
}: {
  design: PlatformDesign
  platformKind: 'new' | 'existing' | 'management-only'
  platformNodes: number
  onReviewAdvisor: () => void
}) {
  const persistInputs = useSurveyorStore((state) => state.setManagementDeploymentInputs)
  const setManagementDecision = useSurveyorStore((state) => state.setManagementDecision)
  const storedInputs = useSurveyorStore((state) => state.managementDeploymentInputs)
  const management = design.management
  const advisor = management.advisor
  // Edits start from the unfilled inputs, so a value that follows the estate keeps following it.
  const save = (next: ManagementDeploymentInputs) => {
    persistInputs(next)
    setManagementDecision('design')
  }
  const setStack = (patch: StackPatch) => save(withStackChoice(management.rawInputs, patch))
  const setScale = (patch: Partial<ManagementDeploymentInputs>) => save(withScaleChange(management.rawInputs, patch))
  const applyAdvisor = () => save(applyAdvisorResult(storedInputs ?? management.rawInputs, advisor.recommendation))
  const includeInSizing = useSurveyorStore((state) => state.includeManagementInSizing)
  const setIncludeInSizing = useSurveyorStore((state) => state.setIncludeManagementInSizing)
  const inputs = management.inputs
  const plan = management.plan
  const impactDesign = design
  const hostDelta = impactDesign.management.hostDelta
  const existingVerdict = impactDesign.existing?.verdict
  const fitText = platformKind === 'existing' && (existingVerdict === 'fits' || existingVerdict === 'does-not-fit')
    ? existingVerdict === 'fits' ? ` Fits on your ${platformNodes} hosts.` : ` Does not fit your ${platformNodes} hosts.`
    : ''
  const impactValue = platformKind === 'management-only' ? 'BOM only' : impactDesign.management.impactLabel
  const impactDetail = platformKind === 'management-only'
    ? 'No workload cluster supplied'
    : `${impactDesign.management.impactDetail}${fitText}`

  const scomPlanned = inputs.monitoring === 'scom' || (inputs.monitoring === 'scom-features' && inputs.foundation === 'scvmm')

  const setNumber = (key: keyof ManagementDeploymentInputs, value: number) => {
    setScale({ [key]: Math.max(0, value) })
  }
  const setArcService = (id: ArcServiceId, checked: boolean) => {
    const arcServices = checked
      ? [...new Set([...inputs.arcServices, id])]
      : inputs.arcServices.filter((service) => service !== id)
    setScale({ arcServices })
  }
  const advisorReady = advisor.status === 'ready'
  const showApply = advisorReady && advisor.matches === false
  const statusNote = management.source === 'advisor'
    ? { tone: 'ok', title: 'Following the advisor', text: `The stack below is the advisor recommendation: ${advisor.recommendedStack}. It updates when the answers change, until you pick a stack field here.` }
    : management.source === 'starting-point'
      ? { tone: 'warn', title: advisor.status === 'not-started' ? 'Starting point, not a recommendation' : advisor.status === 'conflict' ? 'Advisor answers conflict' : 'Advisor incomplete', text: `${advisorMatchSentence(management.source, advisor)} It uses the components the answers confirm and the host-count default for the rest.` }
      : showApply
        ? { tone: 'warn', title: 'The advisor now recommends something else', text: advisorMatchSentence(management.source, advisor) }
        : { tone: '', title: 'Your saved stack', text: advisorMatchSentence(management.source, advisor) }

  return (
    <div className="deployment-layout">
      <aside className="panel deployment-inputs">
        <div className="panel-heading-row">
          <div>
            <h2>Deployment choices</h2>
            <p className="small muted">The stack follows the advisor until you pick a stack field. Hosts, VMs, placement, and retention are always yours.</p>
          </div>
        </div>
        <div className={`note ${statusNote.tone}`}>
          <strong>{statusNote.title}</strong>{statusNote.text}
          {showApply && (
            <div><button className="btn compact" type="button" onClick={applyAdvisor}><RotateCcw size={14} /> Apply advisor result</button> <small>Changes only the stack. Managed hosts, VMs, clusters, placement, and retention stay as entered.</small></div>
          )}
          {!advisorReady && <div><button className="btn ghost compact" type="button" onClick={onReviewAdvisor}>Open the advisor questions</button></div>}
        </div>

        <label className="field">
          <span>Fabric foundation</span>
          <div className="license-toggle deployment-choice-toggle">
            <button
              className={inputs.foundation === 'classic' ? 'active' : ''}
              onClick={() => setStack({ foundation: 'classic' })}
              type="button"
            >Classic</button>
            <button
              className={inputs.foundation === 'scvmm' ? 'active' : ''}
              onClick={() => setStack({ foundation: 'scvmm' })}
              type="button"
            >SCVMM 2025</button>
          </div>
        </label>

        <Field label="Windows Admin Center experience">
          <select value={inputs.wac} onChange={(event) => setStack({ wac: event.target.value as ManagementDeploymentInputs['wac'] })}>
            <option value="none">None</option>
            <option value="wac-admin">Administration Mode</option>
            <option value="wac-virtual">Virtualization Mode (preview)</option>
          </select>
        </Field>

        <Field label="System Center Operations Manager (SCOM)" hint="Capacity reporting, forecasting, and PRO come from connecting SCVMM to SCOM, even if another product does your monitoring.">
          <select value={inputs.monitoring} onChange={(event) => setStack({ monitoring: event.target.value as ManagementDeploymentInputs['monitoring'] })}>
            <option value="none">No SCOM</option>
            <option value="scom-features">SCOM for reporting and forecasting only, not monitoring</option>
            <option value="scom">SCOM for monitoring, reporting, and forecasting</option>
          </select>
        </Field>
        {inputs.monitoring === 'scom-features' && inputs.foundation !== 'scvmm' && (
          <div className="note warn"><strong>This choice needs SCVMM</strong>These reports and PRO come from the VMM integration, so no SCOM servers are planned until SCVMM is the fabric foundation.</div>
        )}
        {inputs.monitoring === 'scom-features' && inputs.foundation === 'scvmm' && (
          <div className="note"><strong>SCOM for features only</strong>Gives you Capacity Utilization, Host Group Forecasting, SAN Usage Forecasting, and PRO, with agents on the hosts and VMM servers. This is a planning choice, not a Microsoft product mode: it still needs SCOM servers, databases, and licensing, plus SQL Server Analysis Services on the reporting server for forecasting. SCOM still monitors the VMM fabric, but you keep it out of your alert and ticket process.</div>
        )}

        <Field label="Management VM placement" hint="Choose whether the management plane shares the workload failure domain or runs on independent infrastructure.">
          <select value={inputs.managementPlacement} onChange={(event) => setScale({ managementPlacement: event.target.value as ManagementDeploymentInputs['managementPlacement'] })}>
            <option value="workload-cluster">Same cluster as workload VMs</option>
            <option value="dedicated-management-cluster">Dedicated management cluster</option>
            <option value="external-fabric">External virtualization fabric</option>
          </select>
        </Field>

        <div className="meter-toggles deployment-toggles">
          <CostToggle label={`${inputs.foundation === 'scvmm' ? 'SCVMM / WAC' : 'WAC'} high availability`} checked={inputs.fabricHighAvailability} onChange={(checked) => setStack({ fabricHighAvailability: checked, highAvailability: checked, scomSqlPlacement: checked ? inputs.scomSqlPlacement : 'dedicated' })} />
          {scomPlanned && <CostToggle label="SCOM high availability" checked={inputs.scomHighAvailability} onChange={(checked) => setStack({ scomHighAvailability: checked, scomSqlPlacement: checked ? inputs.scomSqlPlacement : 'dedicated' })} />}
          <CostToggle label="Add Azure Arc-enabled servers" checked={inputs.includeArc} onChange={(checked) => setStack({ includeArc: checked, arcServices: checked ? inputs.arcServices : [] })} />
          <CostToggle label="Add dedicated AD DS / DNS VMs" checked={inputs.includeIdentityServices} onChange={(checked) => setScale({ includeIdentityServices: checked })} />
          {inputs.managementPlacement === 'workload-cluster' && platformKind !== 'management-only' && <CostToggle label="Include management VMs in workload-cluster sizing" checked={includeInSizing} onChange={setIncludeInSizing} />}
        </div>
        {inputs.managementPlacement !== 'workload-cluster' && <div className="note"><strong>Separate capacity domain</strong>Management VMs remain in the BOM but do not consume workload-cluster capacity for dedicated-cluster or external-fabric placement.</div>}
        {inputs.managementPlacement === 'workload-cluster' && platformKind === 'management-only' && <div className="note warn"><strong>Workload capacity not supplied</strong>The BOM is complete, but host impact cannot be calculated until a platform or existing-hardware profile is added.</div>}
        {scomPlanned && inputs.scomHighAvailability && inputs.foundation === 'scvmm' && inputs.fabricHighAvailability && (
          <Field label="SCOM database placement">
            <select value={inputs.scomSqlPlacement} onChange={(event) => setScale({ scomSqlPlacement: event.target.value as ManagementDeploymentInputs['scomSqlPlacement'] })}>
              <option value="dedicated">Dedicated SCOM SQL Always On pair</option>
              <option value="shared-vmm">Share VMM SQL Always On infrastructure</option>
            </select>
          </Field>
        )}
        {scomPlanned && inputs.scomHighAvailability && inputs.foundation === 'scvmm' && !inputs.fabricHighAvailability && (
          <div className="note"><strong>Dedicated SCOM SQL required</strong>Sharing VMM's SQL Always On infrastructure becomes available when SCVMM / WAC high availability is enabled.</div>
        )}
        {scomPlanned && !inputs.scomHighAvailability && (
          <div className="note warn"><strong>Single-server SCOM topology</strong>One VM contains the management server, databases, reporting, and web console roles. Microsoft positions this mainly for labs and only the smallest production loads.</div>
        )}
        {scomPlanned && (
          <>
            <h3>SCOM workload and retention</h3>
            <div className="form-grid two-column deployment-scale-inputs">
              <Field label="Expected management packs" hint="Recorded for the Sizing Helper. Microsoft publishes no per-pack figure, so it does not change sizing."><NumberInput value={inputs.scomManagementPackCount} min={0} onChange={(value) => setNumber('scomManagementPackCount', value)} /></Field>
              <Field label="Collected data GiB / day" hint={inputs.scomDailyDataUserSet ? 'Set by you. It no longer follows the managed hosts and VMs.' : `Calculated from ${plan.scomAgentManagedComputers.toLocaleString()} agent-managed computers. It follows the managed hosts and VMs until you change it.`}>
                <NumberInput value={inputs.scomDailyDataGiB} min={0.1} step={0.1} onChange={(value) => setScale({ scomDailyDataGiB: Math.max(0.1, value) })} />
                {inputs.scomDailyDataUserSet && <button className="btn ghost compact" type="button" onClick={() => setScale({ scomDailyDataGiB: undefined })}>Calculate from the estate</button>}
              </Field>
              <Field label="Operational retention days"><NumberInput value={inputs.scomOperationalRetentionDays} min={1} onChange={(value) => setNumber('scomOperationalRetentionDays', value)} /></Field>
              <Field label="Warehouse retention days"><NumberInput value={inputs.scomWarehouseRetentionDays} min={1} onChange={(value) => setNumber('scomWarehouseRetentionDays', value)} /></Field>
            </div>
            {inputs.scomHighAvailability && (
              <Field label="Reporting and web-console recovery">
                <select value={inputs.scomAuxiliaryRecovery} onChange={(event) => setScale({ scomAuxiliaryRecovery: event.target.value as ManagementDeploymentInputs['scomAuxiliaryRecovery'] })}>
                  <option value="rebuild">Documented rebuild recovery</option>
                  <option value="warm-standby">Warm standby instances</option>
                </select>
              </Field>
            )}
          </>
        )}
        {inputs.includeArc && (
          <div className="arc-service-picker">
            <h3>Azure Arc-enabled servers</h3>
            <p className="small muted">Connects the guest operating systems to Azure management services. It needs no management VM and does not provide VM lifecycle operations from Azure.</p>
            <div className="form-grid two-column deployment-scale-inputs">
              <Field label="Azure connectivity">
                <select value={inputs.arcConnectivity} onChange={(event) => setScale({ arcConnectivity: event.target.value as ManagementDeploymentInputs['arcConnectivity'] })}>
                  <option value="public">Direct outbound public endpoints</option>
                  <option value="proxy">Outbound proxy</option>
                  <option value="private-link">Azure Private Link</option>
                </select>
              </Field>
              <Field label="Azure region"><input value={inputs.arcRegion} onChange={(event) => setScale({ arcRegion: event.target.value })} placeholder="Example: East US 2" /></Field>
              <Field label="Servers to connect (% of workload VMs)"><NumberInput value={inputs.arcGuestScopePct} min={0} max={100} onChange={(value) => setNumber('arcGuestScopePct', value)} /></Field>
              <Field label="Log Analytics retention days"><NumberInput value={inputs.logAnalyticsRetentionDays} min={30} max={2555} onChange={(value) => setNumber('logAnalyticsRetentionDays', value)} /></Field>
            </div>
            <div className="arc-core-choice">
              <Check size={15} />
              <span><strong>Core Azure Arc management</strong><small>No additional charge for the core control plane. Each connected server runs the Azure Connected Machine agent.</small></span>
            </div>
            <div className="meter-toggles">
              {ARC_SERVICE_CATALOG.map((service) => (
                <CostToggle
                  key={service.id}
                  label={`${service.name} · ${service.billing}`}
                  checked={inputs.arcServices.includes(service.id as ArcServiceId)}
                  onChange={(checked) => setArcService(service.id as ArcServiceId, checked)}
                />
              ))}
            </div>
            {inputs.arcServices.length > 0 && <p className="small muted">Charges or qualifying entitlements for these services are evaluated separately.</p>}
          </div>
        )}

        <div className="form-grid two-column deployment-scale-inputs">
          <Field label="Managed hosts">
            <NumberInput value={inputs.managedHosts} min={0} onChange={(value) => setNumber('managedHosts', value)} />
          </Field>
          <Field label="Managed workload VMs">
            <NumberInput value={inputs.managedVms} min={0} onChange={(value) => setNumber('managedVms', value)} />
          </Field>
          {platformKind === 'management-only' && (
            <>
              <Field label="Sockets per managed host" hint="For System Center licensing. Leave 0 until you know it.">
                <NumberInput value={inputs.managedHostSockets ?? 0} min={0} onChange={(value) => setNumber('managedHostSockets', value)} />
              </Field>
              <Field label="Cores per socket" hint="Physical cores. System Center licenses every core, at least 16 per host.">
                <NumberInput value={inputs.managedHostCoresPerSocket ?? 0} min={0} onChange={(value) => setNumber('managedHostCoresPerSocket', value)} />
              </Field>
            </>
          )}
          <Field label="Managed clusters" hint="Recorded in the design. It does not change component sizing.">
            <NumberInput value={inputs.managedClusters} min={1} onChange={(value) => setNumber('managedClusters', value)} />
          </Field>
          <Field label="Library content (GiB)">
            <NumberInput value={inputs.libraryContentGiB} min={100} step={100} onChange={(value) => setNumber('libraryContentGiB', value)} />
          </Field>
        </div>

        {management.warnings.map((warning) => <div className="note warn" key={warning}><strong>Missing input</strong>{warning}</div>)}
        <div className="deployment-basis-note">
          <BasisPill basis="MS" /> published requirement
          <BasisPill basis="MS-REC" /> published recommendation
          <BasisPill basis="TOOL" /> visible Surveyor planning profile
        </div>
      </aside>

      <div className="deployment-results stack">
        <section className="panel deployment-summary">
          <div className="panel-heading-row">
            <div>
              <span className="matrix-category">Calculated management footprint</span>
              <h2>{plan.scaleLabel}</h2>
              <p className="small muted">Sized for {inputs.managedHosts.toLocaleString()} hosts, {inputs.managedVms.toLocaleString()} workload VMs, and {inputs.managedClusters.toLocaleString()} clusters.</p>
            </div>
            <div className={`deployment-impact ${hostDelta !== null && hostDelta > 0 ? 'changed' : ''}`}>
              <span>Host sizing impact</span>
              <strong>{impactValue}</strong>
              <small>{impactDetail}</small>
            </div>
          </div>

          {plan.errors.map((error) => <div className="note err" key={error}><strong>Above a published limit</strong>{error}</div>)}
          {management.dedicated && <div className={`note ${management.dedicated.nodes !== null ? '' : 'warn'}`}><strong>Dedicated management cluster</strong>{management.dedicated.nodes !== null ? `${management.dedicated.nodes} hosts for ${management.vms.length} management instances, including the failure reserve. ${management.dedicated.basis ?? ''}` : management.dedicated.reason}</div>}
          <div className="deployment-kpis">
            <article><span>VM instances</span><strong>{plan.totalInstances}</strong><small>Management components</small></article>
            <article><span>Total vCPU</span><strong>{plan.totalVCpu.toLocaleString()}</strong><small>Allocated</small></article>
            <article><span>Total memory</span><strong>{plan.totalRamGiB.toLocaleString()} GiB</strong><small>Allocated</small></article>
            <article><span>Total disk</span><strong>{plan.totalDiskGiB.toLocaleString()} GiB</strong><small>Provisioned</small></article>
          </div>
        </section>

        {inputs.includeArc && (
          <section className="panel">
            <div className="panel-heading-row">
              <div>
                <h2>Azure Arc-enabled servers plan</h2>
                <p className="small muted">Core management is separated from optional guest-level Azure services so the free control plane is not confused with metered add-ons.</p>
              </div>
            </div>
            <div className="arc-service-grid">
              {plan.arcServices.map((service) => (
                <article className={service.category === 'Core management' ? 'core' : ''} key={service.id}>
                  <span>{service.category}</span>
                  <strong>{service.name}</strong>
                  <p>{service.billing}</p>
                  <small>{service.requirement}</small>
                  <a href={service.source} target="_blank" rel="noreferrer">Microsoft source</a>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="panel">
          <div className="panel-heading-row">
            <div>
              <h2>Management-plane bill of materials</h2>
              <p className="small muted">VM size is shown per instance; totals multiply by quantity.</p>
            </div>
          </div>
          {plan.components.length === 0 ? (
            <div className="note">No dedicated management VM is required for the selected Classic-only stack.</div>
          ) : (
            <div className="scroll deployment-table-wrap">
              <table className="deployment-table">
                <thead><tr><th>Component</th><th>Qty</th><th>Availability</th><th>VM size each</th><th>Operating system / licensing</th><th>Basis</th></tr></thead>
                <tbody>
                  {plan.components.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                        <small>{item.role}</small>
                        {item.notes.length > 0 && (
                          <ul className="deployment-component-notes">
                            {item.notes.map((note) => <li key={note}>{note}</li>)}
                          </ul>
                        )}
                      </td>
                      <td><strong>{item.count}</strong></td>
                      <td>{item.availability}</td>
                      <td>{item.resourceType === 'vm'
                        ? <><strong>{item.vCpu} vCPU</strong><small>{item.ramGiB} GiB RAM · {item.diskGiB.toLocaleString()} GiB disk</small></>
                        : <><strong>{item.diskGiB.toLocaleString()} GiB</strong><small>Shared storage capacity</small></>}</td>
                      <td>{item.operatingSystem}<small>{item.licensing}</small></td>
                      <td>
                        <BasisPill basis={item.basis} />
                        <small>{item.basisDetail}</small>
                        {item.source && <a href={item.source} target="_blank" rel="noreferrer">Microsoft source</a>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="two-panel-grid">
          <section className="panel">
            <h2>Required dependencies</h2>
            {plan.dependencies.length > 0
              ? <ul className="deployment-list">{plan.dependencies.map((item) => <li key={item}>{item}</li>)}</ul>
              : <p className="small muted">No external dependencies were added.</p>}
          </section>
          <section className="panel">
            <h2>Design cautions</h2>
            {plan.cautions.length > 0
              ? <ul className="deployment-list cautions">{plan.cautions.map((item) => <li key={item}>{item}</li>)}</ul>
              : <p className="small muted">No scale or topology cautions for the current selections.</p>}
          </section>
        </div>
      </div>
    </div>
  )
}

function ComparisonPanel() {
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const categories = ['All', ...Array.from(new Set(CAPABILITIES.map((row) => row.category)))]
  const normalizedQuery = query.trim().toLowerCase()
  const rows = CAPABILITIES.filter((row) => {
    if (category !== 'All' && row.category !== category) return false
    if (!normalizedQuery) return true
    return [row.category, row.capability, row.note, row.vmwareVsphere8, row.vmwareVcf9, ...Object.values(row.values)]
      .some((value) => value.toLowerCase().includes(normalizedQuery))
  })

  return (
    <div className="stack">
      <section className="plane-card-grid">
        {MANAGEMENT_PLANES.map((plane) => (
          <article className="plane-card" key={plane.id}>
            <div className={`plane-status ${plane.id === 'wac-virtual' ? 'preview' : ''}`}>{plane.status}</div>
            <h2>{plane.shortName}</h2>
            <p>{plane.role}</p>
            <dl>
              <div><dt>Best fit</dt><dd>{plane.bestFor}</dd></div>
              <div><dt>Watch for</dt><dd>{plane.watchFor}</dd></div>
            </dl>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="matrix-toolbar">
          <div>
            <h2>Full capability matrix</h2>
            <p className="small muted">Showing {rows.length} of {CAPABILITIES.length} workbook dimensions across all four management planes.</p>
          </div>
          <SearchField value={query} onChange={setQuery} placeholder="Search capabilities or notes" />
          <label className="field compact-field">
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <div className="scroll" style={{ maxHeight: 'none' }}>
          <table className="matrix-table">
            <thead>
              <tr>
                <th>Capability</th>
                {MANAGEMENT_PLANES.map((plane) => <th key={plane.id}>{plane.shortName}</th>)}
                <th>vSphere 8 analogue</th>
                <th>VCF 9 analogue</th>
                <th>Why it matters</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.capability}>
                  <td><span className="matrix-category">{row.category}</span><strong>{row.capability}</strong></td>
                  {MANAGEMENT_PLANES.map((plane) => (
                    <td key={plane.id}><CapabilityValue value={row.values[plane.id]} /></td>
                  ))}
                  <td>{row.vmwareVsphere8}</td>
                  <td>{row.vmwareVcf9}</td>
                  <td className="matrix-note">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function CapabilityValue({ value }: { value: string }) {
  const lower = value.toLowerCase()
  const tone = lower.startsWith('full') || lower === 'yes' || lower === 'array-aware'
    ? 'good'
    : lower === 'none' || lower === 'no'
      ? 'none'
      : 'partial'
  return <span className={`capability-value ${tone}`}>{value}</span>
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="library-search">
      <Search size={15} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  )
}

function VmwarePanel() {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const rows = MANAGEMENT_WORKBOOK.vmwareTranslation.filter((row) => (
    !normalizedQuery || Object.values(row).some((value) => value.toLowerCase().includes(normalizedQuery))
  ))

  return (
    <section className="panel">
      <div className="matrix-toolbar">
        <div>
          <h2>VMware → Hyper-V translation</h2>
          <p className="small muted">Showing {rows.length} of {MANAGEMENT_WORKBOOK.vmwareTranslation.length} mappings, including honest fidelity gaps.</p>
        </div>
        <SearchField value={query} onChange={setQuery} placeholder="Search VMware or Hyper-V terms" />
      </div>
      <div className="scroll library-table-wrap">
        <table className="library-table">
          <thead><tr><th>VMware concept</th><th>Hyper-V equivalent</th><th>Fidelity</th><th>Operator note</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.vmware}>
                <td><strong>{row.vmware}</strong></td>
                <td>{row.hyperv}</td>
                <td><span className={`fidelity fidelity-${row.fidelity.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{row.fidelity}</span></td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

type FieldSection = 'decisions' | 'advantages' | 'objections' | 'guardrails'

function FieldGuidePanel() {
  const [section, setSection] = useState<FieldSection>('decisions')

  return (
    <div className="stack">
      <div className="subtabs compact-subtabs" role="tablist" aria-label="Field guide sections">
        <button className={section === 'decisions' ? 'subtab active' : 'subtab'} onClick={() => setSection('decisions')}>Decision patterns</button>
        <button className={section === 'advantages' ? 'subtab active' : 'subtab'} onClick={() => setSection('advantages')}>Defensible advantages</button>
        <button className={section === 'objections' ? 'subtab active' : 'subtab'} onClick={() => setSection('objections')}>Objection handling</button>
        <button className={section === 'guardrails' ? 'subtab active' : 'subtab'} onClick={() => setSection('guardrails')}>Claims & honest losses</button>
      </div>

      {section === 'decisions' && (
        <>
          <section className="panel">
            <h2>Common decision patterns</h2>
            <div className="library-card-grid">
              {MANAGEMENT_WORKBOOK.decisionPatterns.map((item) => (
                <article className="library-card" key={item.situation}>
                  <span className="matrix-category">Situation</span>
                  <h3>{item.situation}</h3>
                  <strong>{item.answer}</strong>
                  <p>{item.because}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Pros, cons, and walk-away conditions</h2>
            <div className="plane-guide-list">
              {MANAGEMENT_WORKBOOK.planeGuides.map((item) => (
                <details className="library-details" key={item.plane}>
                  <summary>{item.plane}</summary>
                  <div className="detail-columns">
                    <div><h4>Pros</h4><p className="preserve-lines">{item.pros}</p></div>
                    <div><h4>Cons</h4><p className="preserve-lines">{item.cons}</p></div>
                    <div><h4>Pick it when</h4><p>{item.pickWhen}</p></div>
                    <div><h4>Walk away when</h4><p>{item.walkAwayWhen}</p></div>
                  </div>
                </details>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>Things that are not a choice</h2>
            <div className="callout-list">
              {MANAGEMENT_WORKBOOK.decisionCautions.map((item) => (
                <article className="note warn" key={item.statement}><strong>{item.statement}</strong>{item.explanation}</article>
              ))}
            </div>
          </section>
        </>
      )}

      {section === 'advantages' && (
        <section className="panel">
          <h2>Where Hyper-V genuinely wins</h2>
          <p className="small muted">The evidence and usage guidance are retained so claims stay defensible.</p>
          <div className="library-card-grid">
            {MANAGEMENT_WORKBOOK.advantages.map((item) => (
              <article className="library-card" key={item.claim}>
                <div className="card-meta"><span>{item.area}</span><b>{item.strength}</b></div>
                <h3>{item.claim}</h3>
                <h4>Evidence</h4><p>{item.evidence}</p>
                <h4>How to use it</h4><p>{item.guidance}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {section === 'objections' && (
        <section className="panel">
          <h2>Common VMware objections</h2>
          <div className="objection-list">
            {MANAGEMENT_WORKBOOK.objections.map((item) => (
              <details className="library-details" key={item.objection}>
                <summary><span>{item.objection}</span><b>{item.verdict}</b></summary>
                <div className="detail-columns two">
                  <div><h4>Factual answer</h4><p>{item.answer}</p></div>
                  <div><h4>Concede first</h4><p>{item.concede}</p></div>
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {section === 'guardrails' && (
        <div className="two-panel-grid">
          <section className="panel">
            <h2>Do not claim these</h2>
            <div className="callout-list">
              {MANAGEMENT_WORKBOOK.doNotClaim.map((item) => (
                <article className="note danger-note" key={item.claim}><strong>{item.claim}</strong>{item.whyWrong}</article>
              ))}
            </div>
          </section>
          <section className="panel">
            <h2>The honest losses</h2>
            <div className="callout-list">
              {MANAGEMENT_WORKBOOK.honestLosses.map((item) => (
                <article className="note warn" key={item.area}><strong>{item.area}</strong>{item.detail}</article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

type ReferenceSection = 'sources' | 'skus'

function SourcesPanel() {
  const [section, setSection] = useState<ReferenceSection>('sources')
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const sources = MANAGEMENT_WORKBOOK.sources.filter((row) => !normalizedQuery || Object.values(row).some((value) => value.toLowerCase().includes(normalizedQuery)))
  const skus = MANAGEMENT_WORKBOOK.skuReference.filter((row) => !normalizedQuery || Object.values(row).some((value) => value.toLowerCase().includes(normalizedQuery)))

  return (
    <div className="stack">
      <section className="panel">
        <div className="matrix-toolbar">
          <div>
            <h2>Workbook evidence library</h2>
            <p className="small muted">Generated from {MANAGEMENT_WORKBOOK.generatedFrom}; commercial terms still require revalidation before quoting.</p>
          </div>
          <SearchField value={query} onChange={setQuery} placeholder="Search sources or SKUs" />
          <div className="license-toggle">
            <button className={section === 'sources' ? 'active' : ''} onClick={() => setSection('sources')}>Sources</button>
            <button className={section === 'skus' ? 'active' : ''} onClick={() => setSection('skus')}>SKU catalog</button>
          </div>
        </div>

        {section === 'sources' ? (
          <div className="source-list">
            {sources.map((item) => (
              <article className="source-row" key={item.topic}>
                <div><strong>{item.topic}</strong><p>{item.finding}</p></div>
                {item.source && <a href={item.source} target="_blank" rel="noreferrer">Open source</a>}
              </article>
            ))}
          </div>
        ) : (
          <div className="scroll library-table-wrap">
            <table className="library-table">
              <thead><tr><th>Ref</th><th>Product</th><th>Channel / unit</th><th>Price</th><th>Confidence</th><th>Rule / note</th><th>Source</th></tr></thead>
              <tbody>
                {skus.map((item) => (
                  <tr key={item.ref}>
                    <td><strong>{item.ref}</strong></td><td>{item.product}<small>{item.edition}</small></td>
                    <td>{item.channel}<small>{item.unit}</small></td><td>{item.price}</td><td>{item.confidence}<small>{item.priceDate}</small></td>
                    <td>{item.note}</td><td>{item.source && <a href={item.source} target="_blank" rel="noreferrer">Source</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {section === 'sources' && (
        <section className="panel">
          <h2>Caveats before you rely on this</h2>
          <div className="callout-list caveat-grid">
            {MANAGEMENT_WORKBOOK.caveats.map((item) => <article className="note warn" key={item.topic}><strong>{item.topic}</strong>{item.detail}</article>)}
          </div>
        </section>
      )}
    </div>
  )
}

function CostPanel({ design }: { design: PlatformDesign }) {
  const vms = useSurveyorStore((state) => state.vms)
  const costModel = useSurveyorStore((state) => state.costModel)
  const setCostModel = useSurveyorStore((state) => state.setCostModel)
  const quantities = useMemo(() => licensingQuantities(design, vms), [design, vms])
  const update = (patch: Partial<CostModelInputs>) => setCostModel({ ...costModel, ...patch })
  const planeEstimates = MANAGEMENT_PLANES.map((plane) => ({ plane, estimate: estimateLicensing(quantities, costModel, { plane: plane.id }) }))
  const selectedPlane = costModel.selectedPlane ?? quantities.design.plane
  const estimate = planeEstimates.find((item) => item.plane.id === selectedPlane)?.estimate ?? estimateLicensing(quantities, costModel)
  const economics = calculateProviderEconomics(selectedPlane, estimate, costModel)
  const commercial = costModel.commercial
  const isCommercial = commercial.motion !== 'internal'
  const arc = arcMetersInUse(quantities, costModel)
  const designSqlCores = quantities.design.sqlCores
  const rate = (key: PriceKey) => resolveRate(key, costModel.rateOverrides)
  const setRate = (key: PriceKey, value: number) => {
    const rateOverrides = { ...costModel.rateOverrides }
    if (value === PRICE_ENTRIES[key].value) delete rateOverrides[key]
    else rateOverrides[key] = Math.max(0, value)
    update({ rateOverrides })
  }
  const setCommercialNumber = (key: keyof CommercialInputs, value: number) => {
    const nonNegative = Math.max(0, value)
    const normalized = key === 'tenantCount' ? Math.max(1, nonNegative)
      : key === 'microsoftDiscountPct' ? Math.min(100, nonNegative)
        : key === 'targetGrossMarginPct' ? Math.min(95, nonNegative)
          : nonNegative
    update({ commercial: { ...commercial, [key]: normalized } })
  }
  const setMeter = (id: ArcMeterId, checked: boolean) => update({ arcMeters: { ...arc.meters, [id]: checked } })
  const termLabel = `${estimate.termYears} year${estimate.termYears === 1 ? '' : 's'}`
  const notCalculated = quantities.status !== 'ready'
  const rateCardKeys: PriceKey[] = [
    'windowsPerTwoCorePack', 'windowsStandardPerTwoCorePack', 'windowsSplaPerTwoCorePackMonth', 'windowsStandardSplaPerTwoCorePackMonth',
    'systemCenterPerTwoCorePack', 'systemCenterStandardPerTwoCorePack', 'systemCenterSplaPerTwoCorePackMonth', 'systemCenterStandardSplaPerTwoCorePackMonth',
    'sqlStandardPerCore', 'sqlStandardSplaPerTwoCorePackMonth', 'windowsCalPerUnit', 'rdsCalPerUser', 'rdsSalPerUserMonth',
    'updateManagerPerVmMonth', 'defenderP2PerVmMonth', 'guestConfigPerVmMonth', 'changeTrackingPerVmMonth', 'logAnalyticsPerGb',
    'windowsPaygPerCoreMonth', 'azureLocalPerCoreMonth',
  ]
  const confidenceTag = (key: PriceKey) => {
    const resolved = rate(key)
    return resolved.confidence === 'entered' ? 'your rate' : resolved.confidence === 'verified' ? `verified ${resolved.checked}` : 'unverified: quote required in the report'
  }

  return (
    <div className="cost-layout">
      <section className="panel cost-inputs">
        <h2>Commercial route</h2>
        <div className="license-toggle commercial-toggle">
          <button className={commercial.motion === 'internal' ? 'active' : ''} onClick={() => update({ commercial: { ...commercial, motion: 'internal' } })}>Internal TCO</button>
          <button className={commercial.motion === 'csp' ? 'active' : ''} onClick={() => update({ commercial: { ...commercial, motion: 'csp' } })}>CSP managed customer</button>
          <button className={commercial.motion === 'msp' ? 'active' : ''} onClick={() => update({ commercial: { ...commercial, motion: 'msp' } })}>MSP hosted platform</button>
        </div>
        <p className="small muted commercial-explainer">
          {commercial.motion === 'internal' && 'Your own platform cost. Customer revenue is not modelled.'}
          {commercial.motion === 'csp' && 'Your customer owns the subscriptions or Azure consumption; you model resale margin plus managed services.'}
          {commercial.motion === 'msp' && 'You own the hosted-platform cost; revenue comes from your service and platform fees.'}
        </p>

        <h3>Licensing basis</h3>
        <div className="license-toggle">
          <button className={costModel.basis === 'perpetual-sa' ? 'active' : ''} onClick={() => update({ basis: 'perpetual-sa' })}>Perpetual + SA</button>
          <button className={costModel.basis === 'spla' ? 'active' : ''} onClick={() => update({ basis: 'spla' })}>SPLA monthly</button>
          <button className={costModel.basis === 'csp' ? 'active' : ''} onClick={() => update({ basis: 'csp' })}>CSP</button>
        </div>
        <div className="form-grid two-column">
          <CostInput label="Term in years" value={costModel.termYears} onChange={(value) => update({ termYears: Math.min(10, Math.max(1, Math.round(value))) })} />
          {costModel.basis === 'perpetual-sa' && <CostInput label="SA % a year (TOOL)" value={rate('softwareAssuranceAnnualRate').value * 100} step={0.1} onChange={(value) => setRate('softwareAssuranceAnnualRate', value / 100)} />}
        </div>
        {costModel.basis === 'perpetual-sa' && estimate.saMultiplier !== null && (
          <p className="small muted">SA is paid from year 1: licenses cost {estimate.saMultiplier.toFixed(2)}× their purchase price over {termLabel}. 25% is a TOOL assumption, not a Microsoft-published rate.</p>
        )}

        <h3>Editions</h3>
        <div className="form-grid two-column">
          <Field label="Windows Server">
            <select value={costModel.windowsEdition} onChange={(event) => update({ windowsEdition: event.target.value as EditionChoice })}>
              <option value="auto">Lowest cost the design allows</option>
              <option value="datacenter">Datacenter</option>
              <option value="standard">Standard</option>
            </select>
          </Field>
          <Field label="System Center">
            <select value={costModel.systemCenterEdition} onChange={(event) => update({ systemCenterEdition: event.target.value as EditionChoice })}>
              <option value="auto">Lowest cost</option>
              <option value="datacenter">Datacenter</option>
              <option value="standard">Standard</option>
            </select>
          </Field>
        </div>

        <h3>System Center and SQL Server</h3>
        <Field label="System Center licensing">
          <select value={costModel.systemCenter} onChange={(event) => update({ systemCenter: event.target.value as CostModelInputs['systemCenter'] })}>
            <option value="design">Follow the management design ({quantities.design.systemCenter ? 'needed' : 'not needed'})</option>
            <option value="include">Always include</option>
            <option value="exclude">Leave out</option>
          </select>
        </Field>
        <div className="meter-toggles">
          <CostToggle label="SQL Server licensed separately (outside System Center rights)" checked={costModel.sqlLicensing === 'separate'} onChange={(checked) => update({ sqlLicensing: checked ? 'separate' : 'system-center-rights' })} />
        </div>
        {costModel.sqlLicensing === 'separate' && (
          <CostInput label={`SQL cores (design: ${designSqlCores})`} value={costModel.sqlCores ?? designSqlCores} onChange={(value) => update({ sqlCores: Math.max(0, Math.round(value)) })} />
        )}
        <p className="small muted">SQL Server used only by System Center is included: “No additional licenses are needed for management servers or SQL Server technology used in System Center” (microsoft.com/system-center/pricing). Confirm the Product Terms limits on these rights.</p>

        <h3>Azure Arc-enabled servers</h3>
        <Field label="Arc pricing">
          <select value={costModel.arcServers} onChange={(event) => update({ arcServers: event.target.value as CostModelInputs['arcServers'] })}>
            <option value="design">Follow the management design ({quantities.design.arc ? 'Arc selected' : 'no Arc'})</option>
            <option value="include">Include</option>
            <option value="exclude">Leave out</option>
          </select>
        </Field>
        <div className="meter-toggles">
          <CostToggle label={`Update Manager · ${money(rate('updateManagerPerVmMonth').value)}/server/mo`} checked={arc.meters.updateManager} onChange={(checked) => setMeter('updateManager', checked)} />
          <CostToggle label={`Machine Configuration · ${money(rate('guestConfigPerVmMonth').value)}/server/mo`} checked={arc.meters.machineConfig} onChange={(checked) => setMeter('machineConfig', checked)} />
          <CostToggle label={`Change Tracking and Inventory · ${money(rate('changeTrackingPerVmMonth').value)}/server/mo`} checked={arc.meters.changeTracking} onChange={(checked) => setMeter('changeTracking', checked)} />
          <CostToggle label={`Defender for Servers Plan 2 · ${money(rate('defenderP2PerVmMonth').value)}/server/mo`} checked={arc.meters.defenderP2} onChange={(checked) => setMeter('defenderP2', checked)} />
          <CostToggle label={`Log Analytics · ${money(rate('logAnalyticsPerGb').value)}/GB, first 5 GB a month free`} checked={arc.meters.logAnalytics} onChange={(checked) => setMeter('logAnalytics', checked)} />
          <CostToggle label="Meter the Hyper-V hosts as Arc-enabled servers too" checked={costModel.meterArcHosts} onChange={(checked) => update({ meterArcHosts: checked })} />
        </div>
        <CostInput label="Log Analytics GB / server / month" value={costModel.logAnalyticsGbPerServerMonth} step={0.1} onChange={(value) => update({ logAnalyticsGbPerServerMonth: Math.max(0, value) })} />
        {costModel.arcMeters && <button type="button" className="btn ghost small" onClick={() => update({ arcMeters: null })}><RotateCcw size={13} /> Follow the management design</button>}

        <h4>Entitlements that waive Update Manager, Machine Configuration and Change Tracking</h4>
        <p className="small muted">Off until you confirm them. Each applies per Windows server; Linux is covered only by Defender for Servers Plan 2.</p>
        <div className="meter-toggles">
          <CostToggle label="Windows Server Software Assurance or subscription, attested per server" checked={costModel.entitlements.windowsSaOrSubscription} onChange={(checked) => update({ entitlements: { ...costModel.entitlements, windowsSaOrSubscription: checked } })} />
          <CostToggle label="Windows Server pay-as-you-go enabled by Azure Arc" checked={costModel.entitlements.windowsPayg} onChange={(checked) => update({ entitlements: { ...costModel.entitlements, windowsPayg: checked } })} />
          <CostToggle label="Extended Security Updates enabled by Azure Arc" checked={costModel.entitlements.esu} onChange={(checked) => update({ entitlements: { ...costModel.entitlements, esu: checked } })} />
        </div>

        <h3>Access licenses</h3>
        <div className="form-grid two-column">
          <CostInput label="Windows Server CALs" value={costModel.windowsCals.count} onChange={(value) => update({ windowsCals: { ...costModel.windowsCals, count: Math.max(0, Math.round(value)) } })} />
          <Field label="CAL type">
            <select value={costModel.windowsCals.kind} onChange={(event) => update({ windowsCals: { ...costModel.windowsCals, kind: event.target.value as 'user' | 'device' } })}>
              <option value="user">User CALs</option>
              <option value="device">Device CALs</option>
            </select>
          </Field>
        </div>
        <div className="meter-toggles">
          <CostToggle label="Remote Desktop Services is in scope" checked={costModel.rds.inScope} onChange={(checked) => update({ rds: { ...costModel.rds, inScope: checked } })} />
        </div>
        {costModel.rds.inScope && <CostInput label={costModel.basis === 'spla' ? 'RDS subscribers (SALs)' : 'RDS users (CALs)'} value={costModel.rds.users} onChange={(value) => update({ rds: { ...costModel.rds, users: Math.max(0, Math.round(value)) } })} />}

        {isCommercial && (
          <>
            <h3>Customer and delivery economics</h3>
            <div className="form-grid two-column">
              <CostInput label="Customer tenants" value={commercial.tenantCount} onChange={(value) => setCommercialNumber('tenantCount', value)} />
              <CostInput label="Microsoft discount %" value={commercial.microsoftDiscountPct} step={0.1} onChange={(value) => setCommercialNumber('microsoftDiscountPct', value)} />
              <CostInput label="Target gross margin %" value={commercial.targetGrossMarginPct} step={0.1} onChange={(value) => setCommercialNumber('targetGrossMarginPct', value)} />
              <CostInput label="Onboarding cost / tenant" value={commercial.onboardingDeliveryCostPerTenant} onChange={(value) => setCommercialNumber('onboardingDeliveryCostPerTenant', value)} />
              <CostInput label="Onboarding fee / tenant" value={commercial.onboardingFeePerTenant} onChange={(value) => setCommercialNumber('onboardingFeePerTenant', value)} />
              <CostInput label="Platform fee / tenant / mo" value={commercial.monthlyPlatformFeePerTenant} onChange={(value) => setCommercialNumber('monthlyPlatformFeePerTenant', value)} />
              <CostInput label="Managed service / VM / mo" value={commercial.monthlyManagedFeePerVm} onChange={(value) => setCommercialNumber('monthlyManagedFeePerVm', value)} />
              <CostInput label="Operations cost / VM / mo" value={commercial.monthlyOpsCostPerVm} onChange={(value) => setCommercialNumber('monthlyOpsCostPerVm', value)} />
              <CostInput label="Shared operations cost / mo" value={commercial.monthlySharedOpsCost} onChange={(value) => setCommercialNumber('monthlySharedOpsCost', value)} />
              {commercial.motion === 'csp' && <CostInput label="License resale markup %" value={commercial.licenseMarkupPct} step={0.1} onChange={(value) => setCommercialNumber('licenseMarkupPct', value)} />}
              {commercial.motion === 'csp' && <CostInput label="Azure resale markup %" value={commercial.azureMarkupPct} step={0.1} onChange={(value) => setCommercialNumber('azureMarkupPct', value)} />}
            </div>
            {commercial.motion === 'csp' && (
              <div className="meter-toggles commercial-controls">
                <CostToggle label="Use Azure Lighthouse delegated administration" checked={commercial.useLighthouse} onChange={(checked) => update({ commercial: { ...commercial, useLighthouse: checked } })} />
              </div>
            )}
          </>
        )}

        <details className="rate-card-details">
          <summary>Editable rate card <b>Prices checked {PRICES_CHECKED}</b></summary>
          <div className="rate-card-body">
            <p>Each rate shows whether it is a verified list price, an unverified starting value, or your rate. Replace unverified values with your written quote.</p>
            <div className="form-grid two-column">
              {rateCardKeys.map((key) => (
                <label className="field" key={key}>
                  <span>{PRICE_ENTRIES[key].label} <small className="muted">({PRICE_ENTRIES[key].unit}; {confidenceTag(key)})</small></span>
                  <input type="number" value={rate(key).value} min={0} step={0.01} onChange={(event) => setRate(key, Number(event.target.value) || 0)} />
                </label>
              ))}
            </div>
            {Object.keys(costModel.rateOverrides).length > 0 && <button type="button" className="btn ghost small" onClick={() => update({ rateOverrides: {} })}><RotateCcw size={13} /> Reset all rates</button>}
          </div>
        </details>

        <div className="note warn">
          <strong>Planning estimate only</strong>
          SPLA and CSP values, discounts and Azure consumption vary by agreement, region, enabled services and date. Get written pricing before you quote.
        </div>
      </section>

      <section className="panel cost-results">
        <div className="panel-heading-row">
          <div>
            <h2>Quantities from your design</h2>
            <p className="small muted">{quantities.label}. Hosts, cores and VMs come from the design; change them on the design pages.</p>
          </div>
          <Calculator size={22} />
        </div>
        {quantities.validationNote && <div className="note warn"><strong>Current licensing not validated</strong>{quantities.validationNote}</div>}
        {notCalculated ? (
          <div className="note warn"><strong>Not calculated</strong>{quantities.reason}</div>
        ) : (
          <table className="library-table">
            <thead><tr><th>Scope</th><th>Hosts</th><th>Host spec</th><th>Licensable cores / host</th><th>Licensable cores</th><th>Spares</th><th>VMs (Windows / Linux / unknown)</th><th>Priced</th></tr></thead>
            <tbody>
              {quantities.scopes.map((item) => (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td>{item.hosts.toLocaleString()}</td>
                  <td>{item.hostLines.map((line) => `${line.hosts} × ${line.label}`).join('; ')}</td>
                  <td>{item.hostLines.map((line) => line.licensableCoresPerHost).join(' / ')}</td>
                  <td>{item.licensableCores.toLocaleString()}</td>
                  <td>{item.spareHosts}</td>
                  <td>{item.role === 'addition' ? `${item.windowsVmsPerHost} per host` : `${item.vms.windows} / ${item.vms.linux} / ${item.vms.unknown}`}</td>
                  <td>{item.priced ? 'Yes' : 'Reference only'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!notCalculated && (
          <>
            <div className="commercial-kpis">
              <article><span>{isCommercial ? 'Customer contract value' : 'Term licensing and Azure cost'}</span><strong>{money(isCommercial ? economics.totalRevenue : estimate.total)}</strong><small>{termLabel}</small></article>
              <article><span>Your cost (COGS)</span><strong>{money(economics.totalProviderCost)}</strong><small>software + Azure + access + delivery</small></article>
              <article><span>Per workload VM / month</span><strong>{estimate.perVmMonth === null ? '—' : money(estimate.perVmMonth)}</strong><small>{estimate.realVms.toLocaleString()} real VMs</small></article>
              <article className={isCommercial && economics.grossProfit < 0 ? 'negative' : ''}><span>Gross profit</span><strong>{isCommercial ? money(economics.grossProfit) : '—'}</strong><small>before tax and financing</small></article>
              <article className={isCommercial && economics.grossMarginPct < commercial.targetGrossMarginPct / 100 ? 'negative' : 'positive'}><span>Gross margin</span><strong>{isCommercial ? `${(economics.grossMarginPct * 100).toFixed(1)}%` : '—'}</strong><small>{commercial.targetGrossMarginPct}% target</small></article>
              <article><span>Customer / tenant / month</span><strong>{isCommercial ? money(economics.customerPerTenantMonth) : '—'}</strong><small>{commercial.tenantCount} tenant{commercial.tenantCount === 1 ? '' : 's'}</small></article>
            </div>

            <h3>Licensing lines · {basisLabel(estimate.basis)} · {termLabel}</h3>
            <table className="library-table">
              <thead><tr><th>Product</th><th>Scope</th><th>Quantity</th><th>Unit price</th><th>Basis</th><th>Year 1</th><th>Term</th></tr></thead>
              <tbody>
                {estimate.lines.map((line) => (
                  <tr key={line.id} title={line.note}>
                    <td>{line.product}</td>
                    <td>{line.scope}</td>
                    <td>{line.quantity}</td>
                    <td>{line.unitPrice === null ? 'Quote required' : `${money(line.unitPrice)} ${line.unitLabel}`}</td>
                    <td>{line.quoteRequired ? 'Quote required in the report' : line.confidence === 'verified' ? 'Verified' : line.confidence === 'entered' ? 'Your rate' : line.confidence === 'tool' ? 'TOOL' : 'Included'}</td>
                    <td>{money(line.years[0] ?? 0)}</td>
                    <td>{money(line.total)}</td>
                  </tr>
                ))}
                <tr><td colSpan={5}><strong>Total, by year: {estimate.perYear.map((value, index) => `Y${index + 1} ${money(value)}`).join(' · ')}</strong></td><td /><td><strong>{money(estimate.total)}</strong></td></tr>
              </tbody>
            </table>

            <h3>Edition and why</h3>
            <ul className="small">
              {estimate.editions.flatMap((item) => [
                item.windows ? <li key={`${item.scopeId}-w`}><strong>{item.scope}, Windows Server {item.windows.edition === 'datacenter' ? 'Datacenter' : 'Standard'}:</strong> {item.windows.reason}</li> : null,
                item.systemCenter ? <li key={`${item.scopeId}-s`}><strong>{item.scope}, System Center {item.systemCenter.edition === 'datacenter' ? 'Datacenter' : 'Standard'}:</strong> {item.systemCenter.reason}</li> : null,
              ])}
            </ul>

            {estimate.warnings.map((warning) => <div className="note warn" key={warning}><strong>Check this</strong>{warning}</div>)}

            {estimate.eligibility.length > 0 && (
              <>
                <h3>Azure Arc eligibility</h3>
                <ul className="small">{estimate.eligibility.map((row) => <li key={row.meter}><strong>{row.meter}:</strong> {row.charged} charged of {row.servers}. {row.rule}</li>)}</ul>
              </>
            )}

            <div className="economics-grid">
              <div className="economics-bridge">
                <h3>Cost and revenue bridge</h3>
                <div><span>Microsoft software</span><strong>{money(economics.softwareCost)}</strong></div>
                <div><span>Azure consumption</span><strong>{money(economics.azureCost)}</strong></div>
                <div><span>RDS access</span><strong>{money(economics.accessLicensingCost)}</strong></div>
                <div><span>Delivery and operations</span><strong>{money(economics.deliveryCost)}</strong></div>
                <div className="bridge-total"><span>Total cost</span><strong>{money(economics.totalProviderCost)}</strong></div>
                {isCommercial && <div><span>License resale revenue</span><strong>{money(economics.licenseRevenue)}</strong></div>}
                {isCommercial && <div><span>Azure resale revenue</span><strong>{money(economics.azureRevenue)}</strong></div>}
                {isCommercial && <div><span>Managed service revenue</span><strong>{money(economics.serviceRevenue)}</strong></div>}
                {isCommercial && <div className="bridge-total"><span>Total customer revenue</span><strong>{money(economics.totalRevenue)}</strong></div>}
                {isCommercial && economics.revenueGap > 0 && <div className="bridge-gap"><span>Revenue needed for target margin</span><strong>+{money(economics.revenueGap)}</strong></div>}
              </div>
              <div className="commercial-recommendations">
                <h3>Recommendations</h3>
                <div className="recommendation-stack">
                  {economics.recommendations.map((recommendation) => (
                    <article className={`commercial-recommendation ${recommendation.tone}`} key={`${recommendation.title}-${recommendation.detail}`}>
                      <strong>{recommendation.title}</strong>
                      <p>{recommendation.detail}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>

            <div className="comparison-heading">
              <div>
                <h2>Management-plane comparison</h2>
                <p className="small muted">Same quantities, priced for each plane. Select one to use it above.</p>
              </div>
            </div>
            <div className="cost-card-grid">
              {planeEstimates.map(({ plane, estimate: planeEstimate }) => (
                <article className={`cost-card ${plane.id === selectedPlane ? 'selected' : ''}`} key={plane.id}>
                  {plane.id === selectedPlane && <span className="recommended-tag">{plane.id === quantities.design.plane ? 'Your design' : 'Selected'}</span>}
                  <h3>{plane.shortName}</h3>
                  <strong className="cost-total">{money(planeEstimate.total)}</strong>
                  <span>over {termLabel}</span>
                  <div className="cost-breakdown">
                    <div><span>System Center</span><strong>{planeEstimate.systemCenterIncluded ? 'Included' : 'Not needed'}</strong></div>
                    <div><span>Per VM / month</span><strong>{planeEstimate.perVmMonth === null ? '—' : money(planeEstimate.perVmMonth)}</strong></div>
                  </div>
                  <button className="cost-card-select" onClick={() => update({ selectedPlane: plane.id === quantities.design.plane ? null : plane.id })}>{plane.id === selectedPlane ? 'Selected for pricing' : 'Use for pricing'}</button>
                </article>
              ))}
            </div>

            {estimate.alternatives.length > 0 && (
              <div className="alternative-costs">
                <h3>Alternatives, not in the totals</h3>
                {estimate.alternatives.map((item) => <div key={item.label}><span>{item.label}</span><strong>{money(item.total)}</strong><small>{item.detail}</small></div>)}
              </div>
            )}
            <div className="note">
              <strong>Assumptions</strong>
              <ul className="small">{estimate.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function CostInput({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (value: number) => void; step?: number }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} min={0} step={step} onChange={(event) => onChange(Number(event.target.value) || 0)} />
    </label>
  )
}

function CostToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="cost-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 100 ? 2 : 0,
  }).format(value)
}
