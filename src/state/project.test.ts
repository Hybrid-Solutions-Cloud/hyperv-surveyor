import { describe, expect, it } from 'vitest'
import { createProject, normalizeConfig, parseProject, type ProjectPayload } from './project'
import { DEFAULT_CONFIG, defaultTiers, newVm } from './defaults'
import { DEFAULT_PLACEMENT_INPUTS } from '../engine/deploymentPlanning'
import { DEFAULT_NETWORK_INPUTS } from '../engine/networkDesign'
import { DEFAULT_DR_INPUTS } from '../engine/drDesign'
import { DEFAULT_REPORT_METADATA } from './project'

const payload: ProjectPayload = {
  engagementMode: 'fit-gap',
  managementDecision: 'design',
  customerName: 'Contoso',
  vms: [newVm({ name: 'APP01' })],
  cfg: structuredClone(DEFAULT_CONFIG),
  tiers: defaultTiers(),
  chosenKey: 'san',
  existingCapacityCfg: structuredClone(DEFAULT_CONFIG),
  existingCapacityTiers: defaultTiers(),
  existingCapacityNodes: 8,
  managementDeploymentInputs: null,
  includeManagementInSizing: true,
  placementInputs: structuredClone(DEFAULT_PLACEMENT_INPUTS),
  networkDesignInputs: structuredClone(DEFAULT_NETWORK_INPUTS),
  drDesignInputs: structuredClone(DEFAULT_DR_INPUTS),
  reportMetadata: structuredClone(DEFAULT_REPORT_METADATA),
  dataSources: [],
}

describe('project files', () => {
  it('round-trips a complete project through versioned JSON', () => {
    const project = createProject(payload)
    const reopened = parseProject(JSON.stringify(project))
    expect(reopened.payload.customerName).toBe('Contoso')
    expect(reopened.payload.vms[0].name).toBe('APP01')
    expect(reopened.schemaVersion).toBe(4)
    expect(reopened.payload.engagementMode).toBe('fit-gap')
    expect(reopened.payload.managementDecision).toBe('design')
  })

  it('fills newly introduced configuration fields for legacy data', () => {
    const config = normalizeConfig({ architecture: 'san', node: { ramGiB: 512 } })
    expect(config.node.ramGiB).toBe(512)
    expect(config.node.cpuVendor).toBe('amd')
    expect(config.sizingBasis).toBe('allocation')
  })

  it('migrates a legacy workload project into the new-platform journey', () => {
    const project = { kind: 'hyperv-surveyor-project', schemaVersion: 3, engineVersion: '1.0.0', exportedAt: new Date().toISOString(), payload: { ...payload, engagementMode: undefined, managementDecision: undefined } }
    const reopened = parseProject(JSON.stringify(project))
    expect(reopened.payload.engagementMode).toBe('new-platform')
    expect(reopened.payload.managementDecision).toBe('unassessed')
  })

  it('rejects report JSON that is not a reopenable project', () => {
    expect(() => parseProject('{"schemaVersion":2,"sections":[]}')).toThrow(/not a Hyper-V Surveyor project/i)
  })
})
