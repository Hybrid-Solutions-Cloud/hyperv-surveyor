import { useMemo } from 'react'
import type { ArchitectureOption } from '../engine/solve'
import {
  assessStorageDecision,
  STORAGE_DECISION_QUESTIONS,
  STORAGE_FAMILY_LABELS,
  STORAGE_FAMILY_OPTION_KEY,
  type StorageDecisionAnswers,
  type StorageFamily,
} from '../engine/storageDecision'

interface Props {
  answers: StorageDecisionAnswers
  setAnswers: (answers: StorageDecisionAnswers) => void
  options: ArchitectureOption[]
  chosenKey: string
  setChosenKey: (key: string) => void
}

const FAMILIES: StorageFamily[] = ['san', 's2d', 'hybrid']

export function StorageDecisionPanel({ answers, setAnswers, options, chosenKey, setChosenKey }: Props) {
  const guide = useMemo(() => assessStorageDecision(answers, options), [answers, options])
  const setAnswer = (id: string, value: boolean | undefined) => setAnswers({ ...answers, [id]: value })

  return (
    <div className="panel">
      <details className="capacity-policy-details" open={guide.answered === 0 ? undefined : true}>
        <summary>
          <span>Not sure between SAN, S2D, and hybrid? Answer a few questions</span>
          <b>{guide.answered} of {guide.total} answered · guidance only</b>
        </summary>
        <div className="capacity-policy-body">
          <p className="small muted">
            Node count alone will not settle this. These questions cover how you run and buy storage.
            Nothing changes until you select an option, and the weighting is a tool judgment, not vendor guidance.
          </p>
          <div className="storage-decision-questions">
            {STORAGE_DECISION_QUESTIONS.map((question) => (
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
            {guide.excluded.length > 0 && <div>Ruled out by your answers: {guide.excluded.map((family) => STORAGE_FAMILY_LABELS[family]).join(', ')}.</div>}
            {guide.evidence.map((item) => <div key={item}>{item}</div>)}
          </div>
          <div className="row">
            {FAMILIES.map((family) => {
              const key = STORAGE_FAMILY_OPTION_KEY[family]
              const selected = family === 's2d' ? chosenKey.startsWith('s2d') : chosenKey === key
              return (
                <button
                  className={`btn ${selected ? '' : 'ghost'}`}
                  type="button"
                  key={family}
                  disabled={guide.excluded.includes(family)}
                  onClick={() => setChosenKey(key)}
                >
                  {selected ? 'Selected: ' : 'Use '}{STORAGE_FAMILY_LABELS[family]}
                </button>
              )
            })}
          </div>
        </div>
      </details>
    </div>
  )
}
