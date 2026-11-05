import React, { useMemo, useRef, useState } from 'react'
import { describeStorageSources, type ImportReport, type ImportSummary } from '../io/rvtools'
import { downloadInventoryTemplate, parseInventoryFile } from '../io/genericInventory'
import { attachPerformanceFile, downloadPerformanceTemplate, type PerformanceAttachResult } from '../io/performance'
import { assessPerformanceData } from '../engine/performance'
import { storageOutlierFinding } from '../engine/dataQuality'
import { blankVm, bulkVms } from '../state/defaults'
import { TIER_IDS } from '../engine/rules'
import { giBToTiB } from '../engine/compute'
import type { PowerState, TierId, TierPolicy, Vm } from '../engine/types'
import { Field, NumberInput, fmt0, fmt1 } from './Shared'

interface Props {
  vms: Vm[]
  setVms: (v: Vm[]) => void
  tiers: Record<TierId, TierPolicy>
  report: ImportSummary | null
  /** Replace the inventory with an import, or add the import to it. */
  onImport: (mode: 'replace' | 'add', report: ImportReport, fileName: string) => void
  onClearAll: () => void
  onLoadDemo: () => void
  onPerformanceSource?: (source: { kind: 'performance'; fileName: string; rows: number }) => void
}

const SHOW_ALL_ROWS_UP_TO = 1000
const DEFAULT_ROWS_PER_PAGE = 200
const NAMES_SHOWN = 25

export function WorkloadPanel({ vms, setVms, tiers, report, onImport, onClearAll, onLoadDemo, onPerformanceSource }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const performanceFileRef = useRef<HTMLInputElement>(null)
  // The latest inventory, read after a file finishes loading so edits made meanwhile survive.
  const vmsRef = useRef(vms)
  vmsRef.current = vms
  const [performanceReport, setPerformanceReport] = useState<PerformanceAttachResult | null>(null)
  const [pendingImport, setPendingImport] = useState<{ report: ImportReport; fileName: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [filter, setFilter] = useState('')
  const [tierFilter, setTierFilter] = useState<'all' | TierId>('all')
  const [powerFilter, setPowerFilter] = useState<'all' | PowerState>('all')
  const [reviewOnly, setReviewOnly] = useState(false)
  const [page, setPage] = useState(0)
  // Null means automatic: show the whole list unless it is too long to render smoothly.
  const [rowsPerPage, setRowsPerPage] = useState<number | null>(null)
  const [bulkTier, setBulkTier] = useState<TierId>('general')
  const [bulk, setBulk] = useState({ count: 100, tier: 'general' as TierId, vCpu: 4, ramGiB: 16, storageGiB: 200, prefix: 'VM' })

  function applyImport(mode: 'replace' | 'add', imported: ImportReport, fileName: string) {
    onImport(mode, imported, fileName)
    setPendingImport(null)
    // Match counts describe the previous inventory.
    setPerformanceReport(null)
  }

  async function handleFile(file: File) {
    setError(null)
    try {
      const imported = parseInventoryFile(await file.arrayBuffer())
      // A second file never replaces the inventory silently: the user chooses.
      if (vmsRef.current.length > 0) setPendingImport({ report: imported, fileName: file.name })
      else applyImport('replace', imported, file.name)
    } catch (e: any) {
      setError(e?.message ?? 'Could not read that file.')
    }
  }

  async function handlePerformanceFile(file: File) {
    setError(null)
    try {
      const attached = await attachPerformanceFile(file, () => vmsRef.current)
      setVms(attached.vms)
      setPerformanceReport(attached)
      onPerformanceSource?.({ kind: 'performance', fileName: file.name, rows: attached.rows })
    } catch (e: any) {
      setError(e?.message ?? 'Could not read the performance file.')
      setPerformanceReport(null)
    }
  }

  function loadDemo() {
    if (vms.length > 0 && !window.confirm(`Replace all ${vms.length.toLocaleString()} workloads with a randomized 400-VM demo fleet? Your current workloads, edits and import details are removed.`)) return
    setPendingImport(null)
    setPerformanceReport(null)
    onLoadDemo()
  }

  function clearAll() {
    if (!window.confirm(`Remove all ${vms.length.toLocaleString()} workloads from this project?`)) return
    setPendingImport(null)
    setPerformanceReport(null)
    onClearAll()
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return vms.filter(v =>
      (tierFilter === 'all' || v.tier === tierFilter) &&
      (powerFilter === 'all' || v.powerState === powerFilter) &&
      (!reviewOnly || v.autoClassified || v.sizeReview) &&
      (q === '' || v.name.toLowerCase().includes(q) || (v.guestOs ?? '').toLowerCase().includes(q)),
    )
  }, [vms, filter, tierFilter, powerFilter, reviewOnly])

  const totals = useMemo(() => {
    const inc = vms.filter(v => v.include)
    return {
      count: inc.length,
      all: vms.length,
      vCpu: inc.reduce((s, v) => s + v.vCpu, 0),
      ram: inc.reduce((s, v) => s + v.ramGiB, 0),
      sto: inc.reduce((s, v) => s + v.storageGiB, 0),
      prov: inc.reduce((s, v) => s + v.provisionedGiB, 0),
    }
  }, [vms])
  const performance = useMemo(() => assessPerformanceData(vms), [vms])
  const outlierFinding = useMemo(() => storageOutlierFinding(vms), [vms])
  const stopped = useMemo(() => {
    const list = vms.filter(v => v.powerState !== 'poweredOn')
    return {
      list,
      off: list.filter(v => v.powerState === 'poweredOff').length,
      suspended: list.filter(v => v.powerState === 'suspended').length,
      included: list.filter(v => v.include).length,
      vCpu: list.reduce((s, v) => s + v.vCpu, 0),
      ram: list.reduce((s, v) => s + v.ramGiB, 0),
      sto: list.reduce((s, v) => s + v.storageGiB, 0),
    }
  }, [vms])
  const setStoppedIncluded = (include: boolean) => setVms(vms.map(v => v.powerState === 'poweredOn' ? v : { ...v, include }))
  const pageSize = Math.max(1, rowsPerPage === null
    ? shown.length <= SHOW_ALL_ROWS_UP_TO ? shown.length : DEFAULT_ROWS_PER_PAGE
    : rowsPerPage === 0 ? shown.length : rowsPerPage)
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const visibleRows = shown.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const shownIds = useMemo(() => new Set(shown.map((vm) => vm.id)), [shown])
  const patchShown = (change: Partial<Vm>) => setVms(vms.map((vm) => shownIds.has(vm.id) ? { ...vm, ...change } : vm))

  const patch = (id: string, p: Partial<Vm>) =>
    setVms(vms.map(v => (v.id === id ? { ...v, ...p } : v)))

  return (
    <div className="stack">
      <div className="panel">
        <h2>Import</h2>
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Import an RVTools export or inventory template"
          onClick={() => fileRef.current?.click()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
          onDragOver={e => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={e => {
            e.preventDefault(); setOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) handleFile(f)
          }}
        >
          <strong>Drop an RVTools export or a Surveyor inventory template here</strong>
          <div className="small muted" style={{ marginTop: 4 }}>
            .xlsx, .xls or .csv · an RVTools workbook (reads vInfo, vPartition, vDisk, vSnapshot and vHost), the RVTools vInfo tab saved as CSV, or the inventory template below · nothing leaves this browser
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            Hyper-V, SCVMM, Azure Migrate and other exports are not read directly: copy their columns into the inventory template.
          </div>
        </div>
        <input
          ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
        />

        {pendingImport && (
          <div className="note warn" style={{ marginTop: 12 }} role="alertdialog" aria-label="Choose how to import">
            <strong>{pendingImport.fileName} has {pendingImport.report.vms.length.toLocaleString()} VMs. The inventory already has {vms.length.toLocaleString()}.</strong>
            Add keeps every current row with its edits and measured performance, and skips an incoming VM only when its name and vCenter both match one already here.
            Replace removes all current workloads, edits and measured performance, then loads this file.
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" type="button" onClick={() => applyImport('add', pendingImport.report, pendingImport.fileName)}>Add to current inventory</button>
              <button className="btn ghost" type="button" onClick={() => applyImport('replace', pendingImport.report, pendingImport.fileName)}>Replace current inventory</button>
              <button className="btn ghost" type="button" onClick={() => setPendingImport(null)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn ghost" onClick={() => downloadInventoryTemplate('xlsx')}>
            Download inventory template (XLSX)
          </button>
          <button className="btn ghost" onClick={() => downloadInventoryTemplate('csv')}>
            Download inventory template (CSV)
          </button>
          <button className="btn ghost" onClick={() => performanceFileRef.current?.click()} disabled={vms.length === 0}>
            Attach measured performance
          </button>
          <button className="btn ghost" onClick={() => downloadPerformanceTemplate(vms)} disabled={vms.length === 0}>
            Download performance template
          </button>
          <button className="btn ghost" onClick={loadDemo}>
            Generate randomized demo fleet (400 VMs)
          </button>
          <button className="btn ghost" onClick={clearAll} disabled={vms.length === 0}>
            Clear all
          </button>
        </div>
        <input
          ref={performanceFileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
          onChange={e => { const file = e.target.files?.[0]; if (file) handlePerformanceFile(file); e.target.value = '' }}
        />
        {vms.length > 0 && <p className="small muted" style={{ marginTop: 8 }}>Performance files match on VM UUID or VM name and accept CSV/XLSX columns for CPU P95 %, Memory P95 %, IOPS P95, throughput, latency, network, observation days, and source. A blank cell never erases a value already attached.</p>}

        {error && <div className="note err" style={{ marginTop: 12 }}><strong>Import failed</strong>{error}</div>}

        {report && (
          <div style={{ marginTop: 12 }}>
            <div className="note ok">
              <strong>Imported {report.importedVms} VMs from {report.totalRows} rows in {report.fileName}</strong>
              {report.importedVms - report.poweredOff - report.suspended} powered on · {report.poweredOff} powered off · {report.suspended} suspended.{' '}
              {report.format !== 'inventory-template' && <>Not imported: {report.excludedTemplates} templates · {report.excludedSrmPlaceholders} SRM placeholders · {report.excludedVcls} vCLS.{' '}</>}
              {describeStorageSources(report)}
            </div>
            {report.warnings.map((w, i) => (
              <div className="note warn" key={i}>{w}</div>
            ))}
            {report.hostSummary && (
              <div className="note">
                <strong>Existing estate (vHost)</strong>
                {report.hostSummary.hosts} hosts · {fmt0(report.hostSummary.totalPhysicalCores)} physical cores ·{' '}
                {fmt0(report.hostSummary.totalRamGiB)} GiB RAM · clusters: {report.hostSummary.clusters.join(', ') || 'n/a'}
                {report.hostSummary.cpuModels.length > 0 && (
                  <div className="small muted" style={{ marginTop: 4 }}>{report.hostSummary.cpuModels.join(' · ')}</div>
                )}
              </div>
            )}
          </div>
        )}
        {stopped.list.length > 0 && (
          <div className="note warn" style={{ marginTop: 12 }}>
            <strong>{stopped.off} powered-off and {stopped.suspended} suspended VMs: should they count in sizing?</strong>
            They are listed in the inventory below and are {stopped.included === 0 ? 'currently excluded' : stopped.included === stopped.list.length ? 'currently included' : `partly included (${stopped.included} of ${stopped.list.length})`}.
            Together they would add {fmt0(stopped.vCpu)} vCPU, {fmt0(stopped.ram)} GiB of RAM, and {fmt1(giBToTiB(stopped.sto))} TiB of storage. Include them if they are DR, seasonal, or otherwise still needed.
            <div className="row" style={{ marginTop: 8 }}>
              <button className={`btn ${stopped.included === stopped.list.length ? '' : 'ghost'}`} type="button" onClick={() => setStoppedIncluded(true)}>Include them in sizing</button>
              <button className={`btn ${stopped.included === 0 ? '' : 'ghost'}`} type="button" onClick={() => setStoppedIncluded(false)}>Keep them excluded</button>
              <button className="btn ghost" type="button" onClick={() => { setPowerFilter('poweredOff'); setPage(0) }}>Show powered-off VMs</button>
            </div>
          </div>
        )}
        {performanceReport && (
          <div className={`note ${performanceReport.matched > 0 ? 'ok' : 'warn'}`} style={{ marginTop: 12 }}>
            <strong>Attached performance data to {performanceReport.matched.toLocaleString()} of {vms.length.toLocaleString()} inventory VMs</strong>
            Read {performanceReport.rows.toLocaleString()} measurement rows from sheet "{performanceReport.sheetName}". Recognised columns: {performanceReport.recognizedColumns.join(', ')}.
            {performanceReport.unmatchedNames.length > 0 && ` ${performanceReport.unmatchedNames.length.toLocaleString()} name(s) did not match the inventory${performanceReport.unmatchedNames.length > NAMES_SHOWN ? ` (first ${NAMES_SHOWN})` : ''}: ${performanceReport.unmatchedNames.slice(0, NAMES_SHOWN).join(', ')}.`}
            {performanceReport.ambiguousNames.length > 0 && ` ${performanceReport.ambiguousNames.length.toLocaleString()} name(s) fit more than one inventory VM, so nothing was attached to them: ${performanceReport.ambiguousNames.slice(0, NAMES_SHOWN).join(', ')}. Add a VM UUID or Cluster column to tell them apart.`}
            {performanceReport.duplicateNames.length > 0 && ` ${performanceReport.duplicateNames.length.toLocaleString()} name(s) appeared on more than one row; their values were combined, later rows filling or updating each field.`}
            {performanceReport.warnings.map((warning) => <div key={warning} style={{ marginTop: 4 }}>{warning}</div>)}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Add workloads by hand</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          Manual rows and imported rows are the same object. Everything below is editable after import.
        </p>
        <div className="row">
          <Field label="Count"><NumberInput value={bulk.count} min={1} onChange={n => setBulk({ ...bulk, count: Math.max(1, Math.floor(n)) })} /></Field>
          <Field label="Tier">
            <select value={bulk.tier} onChange={e => setBulk({ ...bulk, tier: e.target.value as TierId })}>
              {TIER_IDS.map(t => <option key={t} value={t}>{tiers[t].label}</option>)}
            </select>
          </Field>
          <Field label="vCPU"><NumberInput value={bulk.vCpu} min={1} onChange={n => setBulk({ ...bulk, vCpu: n })} /></Field>
          <Field label="RAM GiB"><NumberInput value={bulk.ramGiB} min={1} onChange={n => setBulk({ ...bulk, ramGiB: n })} /></Field>
          <Field label="Storage GiB"><NumberInput value={bulk.storageGiB} min={1} onChange={n => setBulk({ ...bulk, storageGiB: n })} /></Field>
          <Field label="Prefix"><input value={bulk.prefix} onChange={e => setBulk({ ...bulk, prefix: e.target.value })} /></Field>
        </div>
        <div className="row">
          <button className="btn" onClick={() =>
            setVms([...vms, ...bulkVms(bulk.count, bulk.tier, bulk.vCpu, bulk.ramGiB, bulk.storageGiB, bulk.prefix)])}>
            Add {bulk.count} VMs
          </button>
          <button className="btn ghost" onClick={() => setVms([...vms, blankVm()])}>Add one blank row</button>
        </div>
      </div>

      <div className="panel">
        <h2>Inventory — {fmt0(totals.count)} of {fmt0(totals.all)} included</h2>
        {stopped.list.length > 0 && <p className="small muted" style={{ marginTop: -6 }}>{fmt0(totals.all - stopped.list.length)} powered on · {fmt0(stopped.off)} powered off · {fmt0(stopped.suspended)} suspended. The totals below count included VMs only.</p>}
        <div className={`note ${performance.confidence === 'high' ? 'ok' : performance.measuredVms > 0 ? 'warn' : ''}`}>
          <strong>Performance data: {performance.confidence.replace('-', ' ')} · confidence score {performance.score}/100</strong>
          CPU P95 coverage {performance.cpuCoveragePct.toFixed(0)}% · memory P95 {performance.memoryCoveragePct.toFixed(0)}% · storage performance {performance.storagePerformanceCoveragePct.toFixed(0)}% · 7+ day history {performance.observationCoveragePct.toFixed(0)}%.
        </div>
        <div className="grid cards" style={{ marginBottom: 12 }}>
          <div className="card"><div className="k">Allocated vCPU</div><div className="v">{fmt0(totals.vCpu)}</div></div>
          <div className="card"><div className="k">Allocated RAM</div><div className="v">{fmt0(totals.ram / 1024)}<span style={{ fontSize: 15 }}> TiB</span></div></div>
          <div className="card"><div className="k">Consumed storage</div><div className="v">{fmt1(giBToTiB(totals.sto))}<span style={{ fontSize: 15 }}> TiB</span></div></div>
          <div className="card">
            <div className="k">Provisioned storage</div>
            <div className="v">{fmt1(giBToTiB(totals.prov))}<span style={{ fontSize: 15 }}> TiB</span></div>
            <div className="s">Thin gap {fmt1(giBToTiB(totals.prov - totals.sto))} TiB · not used for sizing</div>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: -4 }}>Storage is sized on consumed (Used) GiB. Provisioned GiB is shown and exported so the thin-provisioning gap is visible; it does not change the sizing.</p>
        {outlierFinding && (
          <div className="note warn">
            <strong>Data quality: storage outliers</strong>
            {outlierFinding.message}
            <div className="small" style={{ marginTop: 4 }}>{outlierFinding.outliers.slice(0, NAMES_SHOWN).map((item) => `${item.vmName} (${fmt1(giBToTiB(item.storageGiB))} TiB, ${item.sharePct.toFixed(0)}%)`).join(' · ')}</div>
          </div>
        )}

        <div className="row" style={{ marginBottom: 10 }}>
          <Field label="Search"><input value={filter} onChange={e => { setFilter(e.target.value); setPage(0) }} placeholder="name or guest OS" /></Field>
          <Field label="Tier">
            <select value={tierFilter} onChange={e => { setTierFilter(e.target.value as any); setPage(0) }}>
              <option value="all">All tiers</option>
              {TIER_IDS.map(t => <option key={t} value={t}>{tiers[t].label}</option>)}
            </select>
          </Field>
          <Field label="Power state">
            <select value={powerFilter} onChange={e => { setPowerFilter(e.target.value as 'all' | PowerState); setPage(0) }}>
              <option value="all">All power states</option>
              <option value="poweredOn">Powered on</option>
              <option value="poweredOff">Powered off</option>
              <option value="suspended">Suspended</option>
            </select>
          </Field>
          <Field label="Rows shown">
            <select value={rowsPerPage === null ? (shown.length <= SHOW_ALL_ROWS_UP_TO ? 0 : DEFAULT_ROWS_PER_PAGE) : rowsPerPage} onChange={e => { setRowsPerPage(Number(e.target.value)); setPage(0) }}>
              <option value={0}>All</option>
              <option value={200}>200 per page</option>
              <option value={500}>500 per page</option>
            </select>
          </Field>
          <Field label="Tier review">
            <select value={reviewOnly ? 'review' : 'all'} onChange={e => { setReviewOnly(e.target.value === 'review'); setPage(0) }}>
              <option value="all">All VMs</option>
              <option value="review">Needs review</option>
            </select>
          </Field>
        </div>
        {shown.length > 0 && (
          <div className="row" style={{ marginBottom: 10 }}>
            <button className="btn ghost" onClick={() => patchShown({ include: true })}>Include filtered</button>
            <button className="btn ghost" onClick={() => patchShown({ include: false })}>Exclude filtered</button>
            <button className="btn ghost" onClick={() => patchShown({ autoClassified: false, sizeReview: false })}>Mark filtered reviewed</button>
            <Field label="Set filtered tier">
              <select value={bulkTier} onChange={(event) => setBulkTier(event.target.value as TierId)}>{TIER_IDS.map((id) => <option value={id} key={id}>{tiers[id].label}</option>)}</select>
            </Field>
            <button className="btn ghost" onClick={() => patchShown({ tier: bulkTier, autoClassified: false, sizeReview: false })}>Apply tier</button>
          </div>
        )}

        {vms.length > 0 && (
          <p className="small muted" style={{ marginBottom: 6 }}>
            {shown.length === 0
              ? `No VMs match these filters, out of ${vms.length.toLocaleString()} in the inventory.`
              : `Showing rows ${(currentPage * pageSize + 1).toLocaleString()}–${Math.min((currentPage + 1) * pageSize, shown.length).toLocaleString()} of ${shown.length.toLocaleString()}${shown.length < vms.length ? ` matching VMs, out of ${vms.length.toLocaleString()} in the inventory` : ' VMs'}. Scroll the list to see them all.`}
          </p>
        )}
        {vms.length === 0 ? (
          <p className="muted">No workloads yet. Import an RVTools export or the inventory template, add rows by hand, or load the demo fleet.</p>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>Inc</th>
                  <th>Name</th>
                  <th style={{ width: 150 }}>Tier</th>
                  <th className="num" style={{ width: 74 }}>vCPU</th>
                  <th className="num" style={{ width: 92 }}>RAM GiB</th>
                  <th className="num" style={{ width: 104 }}>Used GiB</th>
                  <th className="num" style={{ width: 104 }} title="Provisioned size. Shown for the thin-provisioning gap; storage is sized on Used GiB.">Prov GiB (not sized)</th>
                  <th style={{ width: 88 }}>Power</th>
                  <th style={{ width: 46 }} />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(v => (
                  <tr key={v.id}>
                    <td><input type="checkbox" checked={v.include} onChange={e => patch(v.id, { include: e.target.checked })} /></td>
                    <td>
                      <input value={v.name} onChange={e => patch(v.id, { name: e.target.value })} />
                      {v.autoClassified && <span className="pill tool" style={{ marginTop: 3, display: 'inline-block' }}>auto-classified — review</span>}
                      {v.sizeReview && <span className="pill tool" style={{ marginTop: 3, display: 'inline-block' }}>large VM — confirm tier</span>}
                      {v.hasSharedDisk && <span className="pill warn" style={{ marginTop: 3, display: 'inline-block' }} title={v.sharedStorageDedupedGiB ? `${fmt0(v.sharedStorageDedupedGiB)} GiB of shared space is counted on another VM in its group.` : 'Shared space could not be de-duplicated; storage may be counted more than once.'}>shared disk</span>}
                      {v.hasRdm && <span className="pill warn" style={{ marginTop: 3, display: 'inline-block' }}>RDM</span>}
                      {!v.include && (v.vCpu <= 0 || v.ramGiB <= 0) && <span className="pill tool" style={{ marginTop: 3, display: 'inline-block' }}>enter vCPU and RAM, then tick Inc</span>}
                    </td>
                    <td>
                      <select value={v.tier} onChange={e => patch(v.id, { tier: e.target.value as TierId, autoClassified: false, sizeReview: false })}>
                        {TIER_IDS.map(t => <option key={t} value={t}>{tiers[t].label}</option>)}
                      </select>
                    </td>
                    <td><NumberInput value={v.vCpu} min={1} onChange={n => patch(v.id, { vCpu: n })} /></td>
                    <td><NumberInput value={v.ramGiB} min={0} step={0.5} onChange={n => patch(v.id, { ramGiB: n })} /></td>
                    <td><NumberInput value={v.storageGiB} min={0} onChange={n => patch(v.id, { storageGiB: n })} /></td>
                    <td><NumberInput value={v.provisionedGiB} min={0} onChange={n => patch(v.id, { provisionedGiB: n })} /></td>
                    <td className="small muted nowrap">{v.powerState.replace('powered', '')}</td>
                    <td>
                      <button className="btn danger" style={{ padding: '3px 7px' }} aria-label={`Delete ${v.name}`}
                        onClick={() => setVms(vms.filter(x => x.id !== v.id))}>x</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {shown.length > pageSize && (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn ghost" disabled={currentPage === 0} onClick={() => setPage(Math.max(0, currentPage - 1))}>Previous</button>
            <span className="small muted">Page {currentPage + 1} of {pageCount} · rows {(currentPage * pageSize + 1).toLocaleString()}–{Math.min((currentPage + 1) * pageSize, shown.length).toLocaleString()} of {shown.length.toLocaleString()}</span>
            <button className="btn ghost" disabled={currentPage >= pageCount - 1} onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}
