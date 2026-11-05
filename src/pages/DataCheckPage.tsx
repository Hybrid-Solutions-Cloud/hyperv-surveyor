import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { NewPlatformHeader, NewPlatformNav } from '../components/NewPlatformStep'
import { NumberInput } from '../components/Shared'
import { OUTLIER_CHOICE_LABELS, summarizeDataCheck, type DataCheckOutlierRow } from '../engine/dataQuality'
import { useSurveyorStore } from '../state/store'

const gib = (value: number) => value >= 1024 ? `${(value / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} TiB` : `${value.toLocaleString('en-US', { maximumFractionDigits: 0 })} GiB`

function OutlierRow({ row, onChoose }: { row: DataCheckOutlierRow; onChoose: (choice: 'keep' | 'cap' | 'exclude' | 'undo', capGiB?: number) => void }) {
  const [cap, setCap] = useState<number>(row.decision?.capGiB ?? Math.round(row.originalStorageGiB / 4))
  return (
    <tr>
      <td><strong>{row.vmName}</strong>{row.hasSharedDisk && <div className="small muted">Has shared disks</div>}</td>
      <td className="num">{gib(row.originalStorageGiB)}</td>
      <td className="num">{row.sharePct === null ? '—' : `${row.sharePct.toFixed(1)}%`}</td>
      <td className="num">{row.timesMedian === null ? '—' : `${row.timesMedian.toFixed(0)}×`}</td>
      <td>
        {row.decision
          ? <span className="pill info">{row.decision.choice === 'cap' ? `${OUTLIER_CHOICE_LABELS.cap} at ${gib(row.decision.capGiB ?? 0)}` : OUTLIER_CHOICE_LABELS[row.decision.choice]}</span>
          : <span className="pill warn">Not decided: counted as imported</span>}
      </td>
      <td className="num">{row.countedStorageGiB === 0 && row.decision?.choice === 'exclude' ? 'Not counted' : gib(row.countedStorageGiB)}</td>
      <td>
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn ghost compact" type="button" onClick={() => onChoose('keep')}>Count as is</button>
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <NumberInput value={cap} min={0} max={row.originalStorageGiB} step={100} onChange={(value) => setCap(value)} />
            <button className="btn ghost compact" type="button" onClick={() => onChoose('cap', cap)}>Cap at GiB</button>
          </span>
          <button className="btn ghost compact" type="button" onClick={() => onChoose('exclude')}>Exclude</button>
          {row.decision && <button className="btn ghost compact" type="button" onClick={() => onChoose('undo')}>Undo</button>}
        </div>
      </td>
    </tr>
  )
}

export default function DataCheckPage() {
  const vms = useSurveyorStore((state) => state.vms)
  const lastImport = useSurveyorStore((state) => state.lastImport)
  const setOutlierDecision = useSurveyorStore((state) => state.setOutlierDecision)
  const summary = useMemo(() => summarizeDataCheck(vms, lastImport), [vms, lastImport])
  const e = summary.excluded
  const excludedRows: Array<[string, number, string]> = [
    ['Powered off or suspended', e.poweredOff, 'Excluded by default at import. Tick Include on the Workloads page to size them.'],
    ['No vCPU or memory value', e.zeroSpec, 'Cannot be sized until corrected on the Workloads page.'],
    ['Storage outlier you excluded', e.storageOutlier, 'Your choice below.'],
    ['Excluded by hand', e.other, 'Include turned off on the Workloads page.'],
  ]
  const importRows: Array<[string, number]> = lastImport ? [
    ['Templates (not imported)', e.templates],
    ['SRM placeholders (not imported)', e.placeholders],
    ['vCLS system VMs (not imported)', e.vcls],
  ] : []

  return (
    <>
      <NewPlatformHeader
        route="/data-check"
        description="See what will be sized before anything is sized. Nothing on this page changes your data until you click a choice, and every choice can be undone."
      />
      {vms.length === 0 ? (
        <div className="panel"><p className="muted">No workloads yet. <Link to="/workloads">Import an inventory</Link> first.</p></div>
      ) : (
        <div className="stack">
          <div className="panel">
            <h2>Counted and excluded</h2>
            <div className="grid cards">
              <div className="card"><div className="k">Counted in sizing</div><div className="v">{summary.counted.toLocaleString()}</div><div className="s">of {summary.totalRecords.toLocaleString()} records</div></div>
              <div className="card"><div className="k">Excluded</div><div className="v">{summary.excludedTotal.toLocaleString()}</div><div className="s">records kept but not sized</div></div>
              <div className="card"><div className="k">Measured performance</div><div className="v">{summary.measuredVms.toLocaleString()}</div><div className="s">counted VMs with CPU or memory P95</div></div>
            </div>
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>Reason</th><th className="num">Records</th><th>Note</th></tr></thead>
              <tbody>
                {excludedRows.map(([reason, count, note]) => <tr key={reason}><td>{reason}</td><td className="num">{count.toLocaleString()}</td><td className="small muted">{note}</td></tr>)}
                {importRows.map(([reason, count]) => <tr key={reason}><td>{reason}</td><td className="num">{count.toLocaleString()}</td><td className="small muted">Skipped at import{lastImport ? ` (${lastImport.fileName})` : ''}.</td></tr>)}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h2>Storage outliers</h2>
            <p className="small muted" style={{ marginTop: -6 }}>
              VMs that hold at least 5% of counted storage and at least 10 times the median VM. A shared disk counted on several
              VMs, a wrong storage column, or a file or backup server that belongs on separate storage are common causes.
              Choose for each one: count it as imported, cap it at a figure you trust, or exclude it. Your choices are saved in
              the project and listed in the report.
            </p>
            {summary.outliers.length === 0
              ? <div className="note ok"><strong>No storage outliers</strong>No VM holds an outsized share of counted storage.</div>
              : (
                <>
                  {summary.undecidedOutliers > 0 && <div className="note warn"><strong>{summary.undecidedOutliers} outlier{summary.undecidedOutliers === 1 ? '' : 's'} not decided</strong>Until you choose, they are counted as imported.</div>}
                  <div className="scroll" style={{ maxHeight: 'none' }}>
                    <table>
                      <thead><tr><th>VM</th><th className="num">Imported storage</th><th className="num">Share</th><th className="num">× median</th><th>Your choice</th><th className="num">Counted</th><th>Choose</th></tr></thead>
                      <tbody>{summary.outliers.map((row) => <OutlierRow key={row.vmId} row={row} onChoose={(choice, capGiB) => setOutlierDecision(row.vmId, choice, capGiB)} />)}</tbody>
                    </table>
                  </div>
                </>
              )}
          </div>

          <div className="panel">
            <h2>Other things to check</h2>
            <div className={`note ${summary.sharedDiskVms ? 'warn' : 'ok'}`}>
              <strong>Shared disks: {summary.sharedDiskVms.toLocaleString()} counted VM{summary.sharedDiskVms === 1 ? '' : 's'}</strong>
              {summary.sharedDiskVms
                ? `Shared space counted once across each group${summary.sharedStorageDedupedGiB > 0 ? ` (${gib(summary.sharedStorageDedupedGiB)} removed from duplicates)` : ''}. Shared VHDX or guest clusters need their own design on Hyper-V.`
                : 'None found, or the file did not say.'}
            </div>
            <div className={`note ${summary.missingColumns.length ? 'warn' : 'ok'}`}>
              <strong>{summary.missingColumns.length ? 'Checks the file did not allow' : lastImport ? 'Every check had the columns it needs' : 'No import details'}</strong>
              {summary.missingColumns.length
                ? summary.missingColumns.map((item) => <div key={item}>{item}</div>)
                : lastImport ? null : 'These workloads were not imported from a file in this session, so column checks are not available.'}
            </div>
            <div className={`note ${summary.duplicateNames.length ? 'warn' : 'ok'}`}>
              <strong>Duplicate names: {summary.duplicateNames.length.toLocaleString()}</strong>
              {summary.duplicateNames.length
                ? `${summary.duplicateNames.slice(0, 10).map((item) => `${item.name} (${item.count})`).join(', ')}${summary.duplicateNames.length > 10 ? ` and ${summary.duplicateNames.length - 10} more` : ''}. Check that these are different VMs, for example in different vCenters, and not the same VM imported twice.`
                : 'Every VM name is unique.'}
            </div>
            {summary.importWarnings.length > 0 && (
              <div className="note warn"><strong>Import warnings</strong>{summary.importWarnings.map((warning) => <div key={warning}>{warning}</div>)}</div>
            )}
            <div className={`note ${summary.measuredVms > 0 ? 'ok' : ''}`}>
              <strong>{summary.measuredVms > 0 ? 'Measured performance attached' : 'Attach measured performance for a tighter design'}</strong>
              {summary.measuredVms > 0
                ? `${summary.measuredVms.toLocaleString()} of ${summary.counted.toLocaleString()} counted VMs have CPU or memory P95 data. Choose the measured sizing basis on the Goals page to use it.`
                : 'RVTools carries allocation only. Sizing on allocation is conservative. If you have Live Optics, Aria Operations, Azure Migrate or SCOM data, attach it on the Workloads page and choose measured sizing on the Goals page.'}
              <div style={{ marginTop: 8 }}><Link className="btn ghost compact" to="/workloads">Attach performance data</Link></div>
            </div>
          </div>
        </div>
      )}
      <NewPlatformNav route="/data-check" nextDescription="Set spare nodes, growth, the sizing basis and how you want to run storage." />
    </>
  )
}
