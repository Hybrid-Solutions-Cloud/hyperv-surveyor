import React from 'react'
import { PageHeader } from './Shared'
import { JourneyBar } from './JourneyBar'
import { WorkflowNav } from './WorkflowNav'
import { useSurveyorStore } from '../state/store'
import { ENGAGEMENT_LABELS, newPlatformStep, type EngagementMode, type NewPlatformRoute } from '../state/journey'

/**
 * What a new-platform page means on another path. On Management solution only, the server and host
 * reserves (Refine assumptions) and the spare nodes (Goals) still size a dedicated management cluster.
 */
export function offPathNotice(mode: EngagementMode, route: NewPlatformRoute): string {
  const current = `Your current path is ${ENGAGEMENT_LABELS[mode]}.`
  if (mode === 'management-only' && (route === '/configuration' || route === '/goals')) {
    const used = route === '/goals' ? 'the spare nodes' : 'the server and host reserves'
    return `${current} One thing here still applies to it: ${used} size a dedicated management cluster, when you place the management VMs on one. Nothing else on this page changes your results.`
  }
  return `${current} The report, Implementation plan and Management page use that path, not this page.`
}

/** Header for a new-platform walkthrough page: step eyebrow, and a notice when opened from another path. */
export function NewPlatformHeader({ route, title, description, actions }: { route: NewPlatformRoute; title?: string; description: string; actions?: React.ReactNode }) {
  const engagementMode = useSurveyorStore((state) => state.engagementMode)
  const step = newPlatformStep(route)
  const offPath = engagementMode !== null && engagementMode !== 'new-platform'
  return (
    <>
      <PageHeader
        eyebrow={offPath ? `Not part of your path (${ENGAGEMENT_LABELS[engagementMode!]}) · ${step.step.label}` : step.eyebrow}
        title={title ?? step.step.title}
        description={description}
        actions={actions}
      />
      <JourneyBar />
      {offPath && (
        <div className="note warn" style={{ marginBottom: 16 }}>
          <strong>This page is for the new-platform path</strong>
          {offPathNotice(engagementMode!, route)}
        </div>
      )}
    </>
  )
}

/** Previous and next for a walkthrough page, in the fixed step order. */
export function NewPlatformNav({ route, nextDescription, nextOverride }: { route: NewPlatformRoute; nextDescription?: string; nextOverride?: { to: string; label: string; description?: string } }) {
  const step = newPlatformStep(route)
  return (
    <WorkflowNav
      previous={{ to: step.previous.to, label: step.previous.label }}
      next={[nextOverride ?? { to: step.next.to, label: step.next.label, description: nextDescription }]}
    />
  )
}
