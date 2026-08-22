import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export interface WorkflowNavAction {
  to: string
  label: string
  description?: string
  onClick?: () => void
}

export function WorkflowNav({
  previous,
  next = [],
}: {
  previous?: WorkflowNavAction
  next?: WorkflowNavAction[]
}) {
  if (!previous && next.length === 0) return null

  return (
    <nav className="workflow-footer-nav" aria-label="Workflow navigation">
      <div className="workflow-footer-previous">
        {previous && (
          <Link className="workflow-footer-back" to={previous.to} onClick={previous.onClick}>
            <ArrowLeft size={17} />
            <span><small>Previous</small><strong>{previous.label}</strong></span>
          </Link>
        )}
      </div>
      <div className="workflow-footer-actions">
        {next.map((action, index) => (
          <Link
            className={`workflow-footer-next ${index === 0 ? 'primary' : 'secondary'}`}
            to={action.to}
            onClick={action.onClick}
            key={`${action.to}-${action.label}`}
          >
            <span>
              <small>{index === 0 ? 'Continue' : 'Or go directly to'}</small>
              <strong>{action.label}</strong>
              {action.description && <em>{action.description}</em>}
            </span>
            <ArrowRight size={18} />
          </Link>
        ))}
      </div>
    </nav>
  )
}
