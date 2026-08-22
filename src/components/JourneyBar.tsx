import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { ENGAGEMENT_LABELS } from '../state/journey'
import { useSurveyorStore } from '../state/store'

export function JourneyBar({ detail }: { detail?: string }) {
  const mode = useSurveyorStore((state) => state.engagementMode)
  return (
    <div className={`journey-bar ${mode ? '' : 'unselected'}`}>
      <Compass size={16} />
      <div>
        <span>Planning path</span>
        <strong>{mode ? ENGAGEMENT_LABELS[mode] : 'No path selected'}</strong>
        {detail && <small>{detail}</small>}
      </div>
      <Link to="/">{mode ? 'Change path' : 'Choose a path'}</Link>
    </div>
  )
}
