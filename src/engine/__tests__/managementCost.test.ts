import { describe, expect, it } from 'vitest'
import {
  calculatePlaneCost,
  calculateProviderEconomics,
  DEFAULT_MANAGEMENT_RATE_CARD,
  type CommercialInputs,
  type ManagementCostInputs,
} from '../managementCost'

const base: ManagementCostInputs = {
  hosts: 8,
  sockets: 2,
  coresPerSocket: 32,
  vms: 320,
  spareHosts: 1,
  termYears: 3,
  sqlCores: 4,
  waiveUpdateAndGuest: true,
  includeUpdateManager: true,
  includeDefenderP2: true,
  includeGuestConfig: true,
  includeLogAnalytics: true,
  logAnalyticsGbPerVm: 2,
  model: 'perpetual',
}

describe('management-plane cost parity', () => {
  it('includes System Center and SQL when SCOM is selected without SCVMM', () => {
    const classic = calculatePlaneCost('classic', { ...base, includeScom: true })
    expect(classic.systemCenter).toBeGreaterThan(0)
    expect(classic.sql).toBeGreaterThan(0)
  })

  it('matches the reference perpetual scenario', () => {
    expect(calculatePlaneCost('classic', base).total).toBeCloseTo(325_009.92, 2)
    expect(calculatePlaneCost('scvmm', base).total).toBeCloseTo(526_627.92, 2)
    expect(calculatePlaneCost('arc-scvmm', base).total).toBeCloseTo(747_811.92, 2)
    expect(calculatePlaneCost('classic', base).perVmMonth).toBeCloseTo(32.24, 2)
    expect(calculatePlaneCost('arc-scvmm', base).azurePerVmMonth).toBeCloseTo(19.2, 2)
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

  it('accepts an editable rate card without changing the default workbook result', () => {
    const custom = { ...DEFAULT_MANAGEMENT_RATE_CARD, windowsPerTwoCorePack: 1_000 }
    expect(calculatePlaneCost('classic', base).total).toBeCloseTo(325_009.92, 2)
    expect(calculatePlaneCost('classic', base, custom).total).toBeCloseTo(384_000, 2)
  })
})

const commercial: CommercialInputs = {
  motion: 'csp',
  tenantCount: 2,
  rdsUsers: 10,
  microsoftDiscountPct: 10,
  licenseMarkupPct: 10,
  azureMarkupPct: 8,
  onboardingDeliveryCostPerTenant: 1_000,
  onboardingFeePerTenant: 5_000,
  monthlyPlatformFeePerTenant: 1_000,
  monthlyManagedFeePerVm: 20,
  monthlyOpsCostPerVm: 5,
  monthlySharedOpsCost: 500,
  targetGrossMarginPct: 30,
  useLighthouse: true,
}

describe('CSP and MSP provider economics', () => {
  it('models CSP discounts, resale markups, service revenue, and Lighthouse guidance', () => {
    const spla = { ...base, model: 'spla' as const }
    const plane = calculatePlaneCost('classic', spla)
    const result = calculateProviderEconomics('classic', plane, spla, commercial)

    expect(result.softwareCost).toBeCloseTo(207_360, 2)
    expect(result.accessLicensingCost).toBeCloseTo(2_106, 2)
    expect(result.licenseRevenue).toBeCloseTo(230_412.6, 2)
    expect(result.serviceRevenue).toBeCloseTo(312_400, 2)
    expect(result.recommendations.some((item) => item.title.includes('Lighthouse'))).toBe(true)
    expect(result.recommendations.some((item) => item.title.includes('channel and licensing'))).toBe(true)
  })

  it('shows when MSP service pricing does not recover provider COGS at target margin', () => {
    const spla = { ...base, model: 'spla' as const }
    const plane = calculatePlaneCost('scvmm', spla)
    const result = calculateProviderEconomics('scvmm', plane, spla, { ...commercial, motion: 'msp' })

    expect(result.licenseRevenue).toBe(0)
    expect(result.totalProviderCost).toBeGreaterThan(result.totalRevenue)
    expect(result.revenueGap).toBeGreaterThan(0)
    expect(result.requiredMonthlyPerVmIncrease).toBeGreaterThan(0)
    expect(result.recommendations.some((item) => item.title.includes('below the target'))).toBe(true)
  })

  it('switches RDS access from one-time CALs to monthly SPLA SALs', () => {
    const perpetualPlane = calculatePlaneCost('classic', base)
    const perpetual = calculateProviderEconomics('classic', perpetualPlane, base, { ...commercial, microsoftDiscountPct: 0 })
    const splaInputs = { ...base, model: 'spla' as const }
    const splaPlane = calculatePlaneCost('classic', splaInputs)
    const spla = calculateProviderEconomics('classic', splaPlane, splaInputs, { ...commercial, microsoftDiscountPct: 0 })

    expect(perpetual.accessLicensingCost).toBeCloseTo(10 * 129.99, 2)
    expect(spla.accessLicensingCost).toBeCloseTo(10 * 6.5 * 36, 2)
  })

  it('flags perpetual licensing for a provider-hosted MSP service', () => {
    const plane = calculatePlaneCost('scvmm', base)
    const result = calculateProviderEconomics('scvmm', plane, base, { ...commercial, motion: 'msp' })
    expect(result.recommendations.some((item) => item.title.includes('hosted licensing'))).toBe(true)
  })
})
