import { NewPlatformHeader, NewPlatformNav } from '../components/NewPlatformStep'
import { PlanningPolicyPanel } from '../components/ConfigPanel'
import { StorageDecisionPanel } from '../components/StorageDecisionPanel'
import { useSurveyorStore } from '../state/store'

/** Planning policy only. No server or drive inputs: those come after the options, under Refine assumptions. */
export default function GoalsPage() {
  const cfg = useSurveyorStore((state) => state.cfg)
  const setCfg = useSurveyorStore((state) => state.setCfg)
  const answers = useSurveyorStore((state) => state.storageDecisionAnswers)
  const setAnswers = useSurveyorStore((state) => state.setStorageDecisionAnswers)
  return (
    <>
      <NewPlatformHeader
        route="/goals"
        description="Tell Surveyor how much resilience and growth you want and how you want to run storage. You do not need to know your hardware: the next page shows every option your workload allows."
      />
      <div className="stack">
        <PlanningPolicyPanel cfg={cfg} setCfg={setCfg} />
        <StorageDecisionPanel answers={answers} setAnswers={setAnswers} />
      </div>
      <NewPlatformNav route="/goals" nextDescription="Every storage type, server size and drive layout, with what fits and why." />
    </>
  )
}
