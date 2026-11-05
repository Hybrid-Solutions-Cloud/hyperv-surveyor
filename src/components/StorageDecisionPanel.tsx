import { useMemo } from 'react'
import {
  assessStorageDecision,
  STORAGE_DECISION_QUESTIONS,
  STORAGE_FAMILY_LABELS,
  type StorageDecisionAnswers,
} from '../engine/storageDecision'

interface Props {
  answers: StorageDecisionAnswers
  setAnswers: (answers: StorageDecisionAnswers) => void
}

/**
 * The SAN, S2D and hybrid guide questions, asked as planning goals. Answers never select a design:
 * they rule options out where you state a hard constraint, and reorder the shortlist, visibly.
 * Selection happens on the Options and Shortlist pages, by your click.
 */
export function StorageDecisionPanel({ answers, setAnswers }: Props) {
  const guide = useMemo(() => assessStorageDecision(answers), [answers])
  const setAnswer = (id: string, value: boolean | undefined) => setAnswers({ ...answers, [id]: value })
  const statements = STORAGE_DECISION_QUESTIONS.filter((question) => question.statement)
  const questions = STORAGE_DECISION_QUESTIONS.filter((question) => !question.statement)

  return (
    <div className="panel">
      <h2>How you want to run storage</h2>
      <p className="small muted" style={{ marginTop: -6 }}>
        Node count alone will not settle SAN, S2D or hybrid. These answers rule out options only where you state a hard
        constraint, and move the matching option up the shortlist. The weighting is a tool judgment, not vendor guidance.
        {' '}{guide.answered} of {guide.total} answered.
      </p>
      {statements.map((question) => (
        <label className="storage-decision-question" key={question.id} style={{ cursor: 'pointer' }}>
          <div>
            <strong>
              <input
                type="checkbox"
                checked={answers[question.id] === true}
                onChange={(event) => setAnswer(question.id, event.target.checked ? true : undefined)}
                style={{ marginRight: 8 }}
              />
              {question.statement}
            </strong>
            <span className="small muted">{question.why}</span>
          </div>
        </label>
      ))}
      <div className="storage-decision-questions">
        {questions.map((question) => (
          <div className="storage-decision-question" key={question.id}>
            <div>
              <strong>{question.question}</strong>
              <span className="small muted">{question.why}</span>
            </div>
            <select
              aria-label={question.question}
              value={answers[question.id] === undefined ? '' : answers[question.id] ? 'yes' : 'no'}
              onChange={(event) => setAnswer(question.id, event.target.value === '' ? undefined : event.target.value === 'yes')}
            >
              <option value="">Not answered</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        ))}
      </div>
      <div className={`note ${guide.leaning ? 'ok' : ''}`}>
        <strong>{guide.headline}</strong>
        {guide.excluded.length > 0 && <div>Ruled out by your answers: {guide.excluded.map((family) => STORAGE_FAMILY_LABELS[family]).join(', ')}. These options show as ruled out and cannot be selected.</div>}
        {guide.leaning && <div>The best {STORAGE_FAMILY_LABELS[guide.leaning]} option moves to the top of the shortlist, labelled with this reason.</div>}
      </div>
    </div>
  )
}
