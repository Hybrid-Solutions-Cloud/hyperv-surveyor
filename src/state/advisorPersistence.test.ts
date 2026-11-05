/**
 * Advisor answers are saved in the store, in project files and in saved scenarios (audit D1), and
 * older saves are brought up to date (D2). Synthetic data only.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { migratePersistedState, payloadFromState, useSurveyorStore } from './store'
import { createProject, normalizeManagementInputs, parseProject, PROJECT_SCHEMA_VERSION } from './project'
import { deploymentInputsFromStack } from '../engine/managementDeployment'

const answers = { monitoring: true, gaRequired: true, managementHa: false }

describe('advisor answers in saved state', () => {
  beforeEach(() => useSurveyorStore.getState().resetScenario())

  it('keeps answers in the store and makes an unassessed decision a design', () => {
    useSurveyorStore.getState().setManagementAdvisorAnswers({ ...answers, unknownQuestion: true })
    const state = useSurveyorStore.getState()
    expect(state.managementAdvisorAnswers).toEqual(answers)
    expect(state.managementDecision).toBe('design')
  })

  it('does not override an explicit existing or deferred decision', () => {
    useSurveyorStore.getState().setManagementDecision('deferred')
    useSurveyorStore.getState().setManagementAdvisorAnswers(answers)
    expect(useSurveyorStore.getState().managementDecision).toBe('deferred')
  })

  it('round-trips answers through a project file and saved scenarios', () => {
    useSurveyorStore.getState().setManagementAdvisorAnswers(answers)
    useSurveyorStore.getState().saveNamedScenario('With answers')
    const state = useSurveyorStore.getState()
    const text = JSON.stringify(createProject(payloadFromState(state), state.savedScenarios))
    const reopened = parseProject(text)
    expect(reopened.schemaVersion).toBe(PROJECT_SCHEMA_VERSION)
    expect(reopened.payload.managementAdvisorAnswers).toEqual(answers)
    expect(reopened.savedScenarios?.[0].managementAdvisorAnswers).toEqual(answers)

    useSurveyorStore.getState().resetScenario()
    useSurveyorStore.getState().loadProject(reopened.payload, reopened.savedScenarios)
    expect(useSurveyorStore.getState().managementAdvisorAnswers).toEqual(answers)
    useSurveyorStore.getState().setManagementAdvisorAnswers({})
    useSurveyorStore.getState().loadNamedScenario(useSurveyorStore.getState().savedScenarios[0].id)
    expect(useSurveyorStore.getState().managementAdvisorAnswers).toEqual(answers)
  })

  it('opens older project files with no answers', () => {
    const payload = payloadFromState(useSurveyorStore.getState())
    const { managementAdvisorAnswers: _omitted, ...older } = payload
    const reopened = parseProject(JSON.stringify({ kind: 'hyperv-surveyor-project', schemaVersion: 5, engineVersion: '1.2.0', exportedAt: '', payload: older }))
    expect(reopened.payload.managementAdvisorAnswers).toEqual({})
  })

  it('normalizes answers in older browser saves', () => {
    const migrated = migratePersistedState({ managementAdvisorAnswers: { monitoring: true, managementHa: 'yes' } })
    expect(migrated.managementAdvisorAnswers).toEqual({ monitoring: true })
    expect(migratePersistedState({}).managementAdvisorAnswers).toEqual({})
  })
})

describe('older saved management inputs', () => {
  const legacy = () => {
    const { stackSource: _omitted, ...rest } = deploymentInputsFromStack(['scvmm', 'wac-admin'], 0, 0, { monitoring: 'scom' })
    return rest
  }

  it('treats the saved stack as the user\'s choice', () => {
    expect(normalizeManagementInputs(legacy())?.stackSource).toBe('user')
    expect(normalizeManagementInputs({ ...legacy(), stackSource: 'advisor' })?.stackSource).toBe('advisor')
  })

  it('drops the frozen automatic SCOM daily data so it follows the estate again', () => {
    // Management-only inputs were created at 0 VMs, which froze the value at 1 GiB/day.
    expect(normalizeManagementInputs({ ...legacy(), managedVms: 5_000, scomDailyDataGiB: 1 })?.scomDailyDataGiB).toBeUndefined()
    expect(normalizeManagementInputs({ ...legacy(), managedVms: 5_000, scomDailyDataGiB: 10 })?.scomDailyDataGiB).toBeUndefined()
    // Any other value was typed by the user and is kept.
    expect(normalizeManagementInputs({ ...legacy(), managedVms: 5_000, scomDailyDataGiB: 4.5 })?.scomDailyDataGiB).toBe(4.5)
    // New saves mark user-set values by keeping them, whatever they are.
    expect(normalizeManagementInputs({ ...legacy(), stackSource: 'user', scomDailyDataGiB: 1 })?.scomDailyDataGiB).toBe(1)
  })

  it('migrates browser saves the same way', () => {
    const migrated = migratePersistedState({ managementDeploymentInputs: { ...legacy(), managedVms: 2_000, scomDailyDataGiB: 1 } })
    expect(migrated.managementDeploymentInputs?.stackSource).toBe('user')
    expect(migrated.managementDeploymentInputs?.scomDailyDataGiB).toBeUndefined()
  })
})
