/**
 * Provider economics for the Cost Model tab: COGS, revenue and margin on top of the licensing
 * estimate (src/engine/licensing.ts). Sell prices, margins and MSP economics stay in the tab; the
 * solution report never shows them.
 */
import type { PlaneId } from '../data/managementPlane'
import type { CommercialInputs, CostModelInputs, LicensingEstimate } from './licensing'

export type { CommercialInputs, CommercialMotion } from './licensing'
export type RecommendationTone = 'good' | 'warn' | 'action'

export interface CommercialRecommendation {
  tone: RecommendationTone
  title: string
  detail: string
}

export interface ProviderEconomics {
  softwareCost: number
  azureCost: number
  accessLicensingCost: number
  deliveryCost: number
  totalProviderCost: number
  licenseRevenue: number
  azureRevenue: number
  serviceRevenue: number
  totalRevenue: number
  grossProfit: number
  grossMarginPct: number
  targetRevenue: number
  revenueGap: number
  requiredMonthlyPerVmIncrease: number
  customerPerTenantMonth: number
  customerPerVmMonth: number
  recommendations: CommercialRecommendation[]
}

export function calculateProviderEconomics(
  plane: PlaneId,
  estimate: LicensingEstimate,
  inputs: CostModelInputs,
): ProviderEconomics {
  const commercial = inputs.commercial
  const months = estimate.months
  const tenants = Math.max(1, commercial.tenantCount)
  const managedVms = Math.max(1, estimate.realVms)
  const discount = Math.min(toRate(commercial.microsoftDiscountPct), 1)
  const licenseMarkup = toRate(commercial.licenseMarkupPct)
  const azureMarkup = toRate(commercial.azureMarkupPct)
  const targetMargin = Math.min(toRate(commercial.targetGrossMarginPct), 0.95)
  const sum = (categories: string[]) => estimate.lines.filter((line) => categories.includes(line.category)).reduce((total, line) => total + line.total, 0)

  const softwareCost = sum(['windows', 'system-center', 'sql', 'sa', 'cal']) * (1 - discount)
  const azureCost = sum(['arc']) * (1 - discount)
  const accessLicensingCost = sum(['rds']) * (1 - discount)
  const deliveryCost = (
    Math.max(0, commercial.monthlyOpsCostPerVm) * managedVms * months
    + Math.max(0, commercial.monthlySharedOpsCost) * months
    + Math.max(0, commercial.onboardingDeliveryCostPerTenant) * tenants
  )
  const totalProviderCost = softwareCost + azureCost + accessLicensingCost + deliveryCost

  const isCommercial = commercial.motion !== 'internal'
  const isCsp = commercial.motion === 'csp'
  const licenseRevenue = isCsp ? (softwareCost + accessLicensingCost) * (1 + licenseMarkup) : 0
  const azureRevenue = isCsp ? azureCost * (1 + azureMarkup) : 0
  const serviceRevenue = isCommercial ? (
    Math.max(0, commercial.onboardingFeePerTenant) * tenants
    + Math.max(0, commercial.monthlyPlatformFeePerTenant) * tenants * months
    + Math.max(0, commercial.monthlyManagedFeePerVm) * managedVms * months
  ) : 0
  const totalRevenue = licenseRevenue + azureRevenue + serviceRevenue
  const grossProfit = totalRevenue - totalProviderCost
  const grossMarginPct = totalRevenue > 0 ? grossProfit / totalRevenue : 0
  const targetRevenue = totalProviderCost / Math.max(0.05, 1 - targetMargin)
  const revenueGap = Math.max(0, targetRevenue - totalRevenue)
  const requiredMonthlyPerVmIncrease = revenueGap / managedVms / months

  return {
    softwareCost,
    azureCost,
    accessLicensingCost,
    deliveryCost,
    totalProviderCost,
    licenseRevenue,
    azureRevenue,
    serviceRevenue,
    totalRevenue,
    grossProfit,
    grossMarginPct,
    targetRevenue,
    revenueGap,
    requiredMonthlyPerVmIncrease,
    customerPerTenantMonth: totalRevenue / tenants / months,
    customerPerVmMonth: totalRevenue / managedVms / months,
    recommendations: buildCommercialRecommendations(plane, estimate, inputs, grossMarginPct, targetMargin, revenueGap, requiredMonthlyPerVmIncrease),
  }
}

function buildCommercialRecommendations(
  plane: PlaneId,
  estimate: LicensingEstimate,
  inputs: CostModelInputs,
  grossMargin: number,
  targetMargin: number,
  revenueGap: number,
  requiredMonthlyPerVmIncrease: number,
): CommercialRecommendation[] {
  const commercial = inputs.commercial
  const recommendations: CommercialRecommendation[] = estimate.warnings.map((warning) => ({ tone: 'warn' as const, title: 'Check the licensing basis', detail: warning }))

  if (commercial.motion === 'csp') {
    recommendations.push(commercial.useLighthouse
      ? { tone: 'good', title: 'Lighthouse is included as a no-license-cost operating control', detail: 'Use Azure Lighthouse delegation for cross-tenant administration, then price the managed service work separately. Arc and Azure consumption remain billable.' }
      : { tone: 'action', title: 'Add Azure Lighthouse for cross-tenant operations', detail: 'Lighthouse does not replace CSP billing, Arc or your management platform, but it reduces credential sharing and supports delegated multi-customer operations.' })
  }
  if (commercial.tenantCount > 1 && ['classic', 'wac-admin', 'wac-virtual'].includes(plane)) {
    recommendations.push({ tone: 'action', title: 'Use a centralized fabric plane for multi-tenant operations', detail: 'SCVMM provides placement, templates, logical networking, delegation and fabric-wide control that host-by-host tooling does not provide.' })
  }
  if (plane === 'wac-virtual') {
    recommendations.push({ tone: 'warn', title: 'Treat WAC virtual-mode capability as preview-sensitive', detail: 'Confirm the current support statement and required build before making it the production operating model; keep a supported fallback.' })
  }
  if (estimate.quoteRequired.length > 0) {
    recommendations.push({ tone: 'action', title: 'Get quotes for the unverified rates', detail: `${estimate.quoteRequired.length} line${estimate.quoteRequired.length === 1 ? ' uses' : 's use'} an unverified or missing price: ${estimate.quoteRequired.map((line) => line.product).join(', ')}.` })
  }
  if (commercial.microsoftDiscountPct === 0 && commercial.motion !== 'internal') {
    recommendations.push({ tone: 'action', title: 'Replace list estimates with your channel quote', detail: 'Enter the effective Partner Center or distributor discount. CSP, SPLA, incentives, region and agreement terms can change provider COGS materially.' })
  }
  if (commercial.motion !== 'internal') {
    recommendations.push(revenueGap > 0
      ? { tone: 'warn', title: 'Pricing is below the target gross margin', detail: `Add at least ${formatCurrency(requiredMonthlyPerVmIncrease)} per managed VM per month, or an equivalent tenant or platform fee, to reach the ${(targetMargin * 100).toFixed(0)}% target.` }
      : { tone: 'good', title: 'The modelled price clears the margin target', detail: `Modelled gross margin is ${(grossMargin * 100).toFixed(1)}% against a ${(targetMargin * 100).toFixed(0)}% target. Validate utilization, support effort, bad debt and taxes before quoting.` })
  }
  if (commercial.motion === 'csp' && plane === 'scvmm') {
    recommendations.push({ tone: 'warn', title: 'Do not substitute System Center Standard CSP reference pricing', detail: 'The CSP references are System Center Standard, which manages two OSEs per license. Dense virtualization usually needs Datacenter, and CSP availability must be confirmed.' })
  }
  return recommendations
}

function toRate(value: number) {
  return Math.max(0, value / 100)
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}
