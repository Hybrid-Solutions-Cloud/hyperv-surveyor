import { Link } from 'react-router-dom'
import { usePlatformDesign, useOptionsMatrix } from '../state/usePlatformDesign'
import { NewPlatformHeader, NewPlatformNav } from '../components/NewPlatformStep'
import { isSelectedOption } from '../engine/optionsMatrix'
import { STORAGE_FAMILY_LABELS } from '../engine/storageDecision'
import { useSurveyorStore } from '../state/store'

export default function ShortlistPage() {
  const { cfg, vms, chosenKey, selectDesignOption } = useSurveyorStore()
  const design = usePlatformDesign({ engagementMode: 'new-platform' })
  const matrix = useOptionsMatrix(design)
  const hasWorkloads = vms.some((vm) => vm.include)

  return (
    <>
      <NewPlatformHeader
        route="/shortlist"
        title="Recommended starting points, validate with your vendor"
        description="The top three viable options from the matrix, one per storage type, ranked by the criteria below. Selecting one sets your storage type, server and drives; nothing changes until you click."
      />
      {!hasWorkloads && <div className="panel"><p className="muted">Add workloads first. <Link to="/workloads">Import an inventory</Link>.</p></div>}
      {hasWorkloads && matrix && (
        <div className="stack">
          <div className="panel">
            <h2>How the shortlist is ranked</h2>
            <ol className="small">{matrix.rankingCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ol>
            <div className="small muted">
              Your Goals answers: {matrix.guide.answered === 0
                ? 'none yet, so the ranking above is used unchanged.'
                : `${matrix.guide.headline}${matrix.guide.excluded.length ? ` Ruled out: ${matrix.guide.excluded.map((family) => STORAGE_FAMILY_LABELS[family]).join(', ')}.` : ''}${matrix.guide.leaning ? ' The best option of that type is moved to first.' : ''}`}
              {' '}<Link to="/goals">Change answers</Link>
            </div>
          </div>
          {matrix.shortlist.length === 0 && (
            <div className="note warn">
              <strong>No option fits one cluster</strong>
              Every combination is ruled out. The Options page lists the reason for each, and the &quot;If you choose to split&quot; view shows options that a split you choose could place.
              <div style={{ marginTop: 8 }}><Link className="btn link-btn" to="/results">Open the options</Link></div>
            </div>
          )}
          {matrix.shortlist.map((entry) => {
            const option = entry.option
            const selected = isSelectedOption(option, cfg, chosenKey)
            return (
              <div className={`panel ${selected ? 'chosen' : ''}`} key={option.id}>
                <h2>{entry.rank}. {option.storageLabel} on {option.server.label.toLowerCase()} servers{option.drives ? `, ${option.drives.label} per node` : ''}</h2>
                {entry.guideNote && <div className="note ok"><strong>Moved by your answers</strong>{entry.guideNote}</div>}
                <h3>Why it ranks here</h3>
                <ul>{entry.rationale.map((line) => <li key={line}>{line}</li>)}</ul>
                <h3>Trade-offs</h3>
                <ul>{entry.tradeoffs.map((line) => <li key={line}>{line}</li>)}</ul>
                <div className="row">
                  {selected
                    ? <span className="pill ok">Selected — see What to buy</span>
                    : <button className="btn" type="button" onClick={() => selectDesignOption(option)}>Select this option</button>}
                </div>
              </div>
            )
          })}
          <p className="small muted">Recommended starting points, not a quote. Validate performance, pricing and support with your vendor.</p>
        </div>
      )}
      <NewPlatformNav route="/shortlist" nextDescription="The class-level bill of materials for the option you selected." />
    </>
  )
}
