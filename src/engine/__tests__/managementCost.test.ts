import { describe, expect, it } from 'vitest'
import { calculatePlaneCost, type ManagementCostInputs } from '../managementCost'

const base: ManagementCostInputs = {
  hosts: 8,
  sockets: 2,
  coresPerSocket: 32,
  vms: 320,
  spareHosts: 1,
  termYears: 3,
  sqlCores: 4,
  azurePerVmMonth: 19.2,
  model: 'perpetual',
}

describe('management-plane cost parity', () => {
  it('matches the reference perpetual scenario', () => {
    expect(calculatePlaneCost('classic', base).total).toBeCloseTo(325_009.92, 2)
    expect(calculatePlaneCost('scvmm', base).total).toBeCloseTo(526_627.92, 2)
    expect(calculatePlaneCost('arc-scvmm', base).total).toBeCloseTo(747_811.92, 2)
  })

  it('matches the reference SPLA scenario', () => {
    const spla = { ...base, model: 'spla' as const }
    expect(calculatePlaneCost('classic', spla).total).toBeCloseTo(230_400, 2)
    expect(calculatePlaneCost('scvmm', spla).total).toBeCloseTo(431_372, 2)
    expect(calculatePlaneCost('arc-scvmm', spla).total).toBeCloseTo(652_556, 2)
  })

  it('applies Microsoft core licensing floors', () => {
    const smallHost = { ...base, sockets: 1, coresPerSocket: 4, hosts: 1, vms: 10, termYears: 1 }
    expect(calculatePlaneCost('classic', smallHost).total).toBeCloseTo(8 * 846.38, 2)
  })
})
