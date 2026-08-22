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
