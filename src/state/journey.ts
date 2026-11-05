export type EngagementMode = 'new-platform' | 'existing-capacity' | 'fit-gap' | 'management-only'

export type ManagementDecision = 'unassessed' | 'design' | 'existing' | 'deferred'

export const ENGAGEMENT_LABELS: Record<EngagementMode, string> = {
  'new-platform': 'Design a new platform',
  'existing-capacity': 'Assess existing capacity',
  'fit-gap': 'Fit workloads to existing hardware',
  'management-only': 'Management solution only',
}

export function normalizeEngagementMode(value: unknown, fallback: EngagementMode | null = null): EngagementMode | null {
  return value === 'new-platform' || value === 'existing-capacity' || value === 'fit-gap' || value === 'management-only'
    ? value
    : fallback
}

export function normalizeManagementDecision(value: unknown): ManagementDecision {
  return value === 'design' || value === 'existing' || value === 'deferred' ? value : 'unassessed'
}

export function journeyStartRoute(mode: EngagementMode): string {
  if (mode === 'existing-capacity') return '/capacity'
  if (mode === 'management-only') return '/management-plane'
  return '/workloads'
}

export function journeyResumeRoute(mode: EngagementMode, workloadCount: number): string {
  if (mode === 'new-platform') return workloadCount > 0 ? '/results' : '/workloads'
  if (mode === 'existing-capacity') return '/capacity'
  if (mode === 'fit-gap') return workloadCount > 0 ? '/capacity' : '/workloads'
  return '/management-plane'
}

/**
 * The new-platform walkthrough, in order. You do not need to know your hardware: the questions that
 * assume known hardware come last, under Refine assumptions.
 */
export const NEW_PLATFORM_STEPS = [
  { to: '/workloads', label: 'Workloads', title: 'Workload inventory' },
  { to: '/data-check', label: 'Data check', title: 'Check the data before sizing' },
  { to: '/goals', label: 'Goals', title: 'Planning goals' },
  { to: '/results', label: 'Options', title: 'Every option your workload allows' },
  { to: '/shortlist', label: 'Shortlist', title: 'Recommended starting points' },
  { to: '/what-to-buy', label: 'What to buy', title: 'What to buy' },
  { to: '/configuration', label: 'Refine assumptions', title: 'Refine assumptions' },
] as const

export type NewPlatformRoute = typeof NEW_PLATFORM_STEPS[number]['to']

/** Step position, previous and next for a new-platform page. After the last step comes Management. */
export function newPlatformStep(route: NewPlatformRoute) {
  const index = NEW_PLATFORM_STEPS.findIndex((step) => step.to === route)
  const step = NEW_PLATFORM_STEPS[index]
  const previous = index > 0 ? NEW_PLATFORM_STEPS[index - 1] : { to: '/', label: 'Choose planning path', title: '' }
  const next = index < NEW_PLATFORM_STEPS.length - 1 ? NEW_PLATFORM_STEPS[index + 1] : { to: '/management-plane', label: 'Management Plane Advisor', title: '' }
  return {
    number: index + 1,
    total: NEW_PLATFORM_STEPS.length,
    step,
    previous,
    next,
    eyebrow: `New platform · Step ${index + 1} of ${NEW_PLATFORM_STEPS.length} · ${step.label}`,
  }
}
