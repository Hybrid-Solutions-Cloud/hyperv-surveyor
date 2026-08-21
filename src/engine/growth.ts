import type { ClusterConfig, GrowthStrategy } from './types'

export interface GrowthPlan {
  immediateHeadroomPct: number
  baseGrowthFactor: number
  annualGrowthPct: number
  horizonYears: number
  strategy: GrowthStrategy
  terminalGrowthFactor: number
  currentDesignGrowthFactor: number
}

export function resolveGrowthPlan(cfg: ClusterConfig): GrowthPlan {
  const baseGrowthFactor = Math.max(0.1, cfg.growthFactor || 1)
  const annualGrowthPct = Math.max(0, cfg.annualGrowthPct ?? 0)
  const horizonYears = Math.max(1, Math.min(10, Math.round(cfg.growthHorizonYears ?? 3)))
  const strategy = cfg.growthStrategy ?? 'phased'
  const terminalGrowthFactor = baseGrowthFactor * ((1 + annualGrowthPct) ** horizonYears)
  return {
    immediateHeadroomPct: Math.max(0, (baseGrowthFactor - 1) * 100),
    baseGrowthFactor,
    annualGrowthPct,
    horizonYears,
    strategy,
    terminalGrowthFactor,
    currentDesignGrowthFactor: strategy === 'build-now' ? terminalGrowthFactor : baseGrowthFactor,
  }
}

export function growthFactorForYear(plan: GrowthPlan, year: number) {
  return plan.baseGrowthFactor * ((1 + plan.annualGrowthPct) ** Math.max(0, year))
}
