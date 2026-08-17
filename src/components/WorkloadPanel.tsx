import React, { useMemo, useRef, useState } from 'react'
import { parseRvTools, type ImportReport } from '../io/rvtools'
import { bulkVms, demoFleet, newVm } from '../state/defaults'
import { TIER_IDS } from '../engine/rules'
import { giBToTiB } from '../engine/compute'
import type { TierId, TierPolicy, Vm } from '../engine/types'
import { Field, NumberInput, fmt0, fmt1 } from './Shared'

interface Props {
  vms: Vm[]
  setVms: (v: Vm[]) => void
  tiers: Record<TierId, TierPolicy>
}

export function WorkloadPanel({ vms, setVms, tiers }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [filter, setFilter] = useState('')
  const [tierFilter, setTierFilter] = useState<'all' | TierId>('all')
  const [bulk, setBulk] = useState({ count: 100, tier: 'general' as TierId, vCpu: 4, ramGiB: 16, storageGiB: 200, prefix: 'VM' })

  async function handleFile(file: File) {
    setError(null)
    try {
      const buf = await file.arrayBuffer()
      const rep = parseRvTools(buf)
      setReport(rep)
      setVms(rep.vms)
    } catch (e: any) {
      setError(e?.message ?? 'Could not read that file.')
      setReport(null)
    }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return vms.filter(v =>
      (tierFilter === 'all' || v.tier === tierFilter) &&
      (q === '' || v.name.toLowerCase().includes(q) || (v.guestOs ?? '').toLowerCase().includes(q)),
    )
  }, [vms, filter, tierFilter])

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

  const patch = (id: string, p: Partial<Vm>) =>
    setVms(vms.map(v => (v.id === id ? { ...v, ...p } : v)))

  return (
    <div className="stack">
      <div className="panel">
        <h2>Import</h2>
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={e => {
            e.preventDefault(); setOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) handleFile(f)
          }}
        >
          <strong>Drop an RVTools export here</strong>
          <div className="small muted" style={{ marginTop: 4 }}>
            .xlsx · reads vInfo, vPartition and vHost · nothing leaves this browser
          </div>
        </div>
        <input
          ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn ghost" onClick={() => setVms(demoFleet())}>
            Generate randomized demo fleet (400 VMs)
          </button>
          <button className="btn ghost" onClick={() => setVms([])} disabled={vms.length === 0}>
            Clear all
          </button>
        </div>

        {error && <div className="note err" style={{ marginTop: 12 }}><strong>Import failed</strong>{error}</div>}

        {report && (
          <div style={{ marginTop: 12 }}>
            <div className="note ok">
              <strong>Imported {report.vms.length} VMs from {report.totalRows} rows</strong>
              Excluded: {report.excludedTemplates} templates · {report.excludedSrmPlaceholders} SRM placeholders · {report.excludedVcls} vCLS.
              {report.usedPartitionData
                ? ' Consumed storage taken from vPartition (in-guest actual).'
                : ' No vPartition tab — consumed storage taken from vInfo In Use.'}
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
      </div>

      <div className="panel">
        <h2>Add workloads by hand</h2>
        <p className="small muted" style={{ marginTop: -6 }}>
          Manual rows and imported rows are the same object. Everything below is editable after import.
        </p>
        <div className="row">
          <Field label="Count"><NumberInput value={bulk.count} min={1} onChange={n => setBulk({ ...bulk, count: n })} /></Field>
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
          <button className="btn ghost" onClick={() => setVms([...vms, newVm()])}>Add one blank row</button>
        </div>
      </div>

      <div className="panel">
        <h2>Inventory — {fmt0(totals.count)} of {fmt0(totals.all)} included</h2>
        <div className="grid cards" style={{ marginBottom: 12 }}>
          <div className="card"><div className="k">Allocated vCPU</div><div className="v">{fmt0(totals.vCpu)}</div></div>
          <div className="card"><div className="k">Allocated RAM</div><div className="v">{fmt0(totals.ram / 1024)}<span style={{ fontSize: 15 }}> TiB</span></div></div>
          <div className="card"><div className="k">Consumed storage</div><div className="v">{fmt1(giBToTiB(totals.sto))}<span style={{ fontSize: 15 }}> TiB</span></div></div>
          <div className="card">
            <div className="k">Provisioned storage</div>
            <div className="v">{fmt1(giBToTiB(totals.prov))}<span style={{ fontSize: 15 }}> TiB</span></div>
            <div className="s">Thin gap {fmt1(giBToTiB(totals.prov - totals.sto))} TiB</div>
          </div>
        </div>

        <div className="row" style={{ marginBottom: 10 }}>
          <Field label="Search"><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="name or guest OS" /></Field>
          <Field label="Tier">
            <select value={tierFilter} onChange={e => setTierFilter(e.target.value as any)}>
              <option value="all">All tiers</option>
              {TIER_IDS.map(t => <option key={t} value={t}>{tiers[t].label}</option>)}
            </select>
          </Field>
          <div style={{ flex: 2 }} />
        </div>

        {vms.length === 0 ? (
          <p className="muted">No workloads yet. Import an RVTools export, add rows by hand, or load the demo fleet.</p>
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
                  <th className="num" style={{ width: 104 }}>Prov GiB</th>
                  <th style={{ width: 88 }}>Power</th>
                  <th style={{ width: 46 }} />
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 400).map(v => (
                  <tr key={v.id}>
                    <td><input type="checkbox" checked={v.include} onChange={e => patch(v.id, { include: e.target.checked })} /></td>
                    <td>
                      <input value={v.name} onChange={e => patch(v.id, { name: e.target.value })} />
                      {v.autoClassified && <span className="pill tool" style={{ marginTop: 3, display: 'inline-block' }}>auto-classified — review</span>}
                    </td>
                    <td>
                      <select value={v.tier} onChange={e => patch(v.id, { tier: e.target.value as TierId, autoClassified: false })}>
                        {TIER_IDS.map(t => <option key={t} value={t}>{tiers[t].label}</option>)}
                      </select>
                    </td>
                    <td><NumberInput value={v.vCpu} min={1} onChange={n => patch(v.id, { vCpu: n })} /></td>
                    <td><NumberInput value={v.ramGiB} min={0} step={0.5} onChange={n => patch(v.id, { ramGiB: n })} /></td>
                    <td><NumberInput value={v.storageGiB} min={0} onChange={n => patch(v.id, { storageGiB: n })} /></td>
                    <td><NumberInput value={v.provisionedGiB} min={0} onChange={n => patch(v.id, { provisionedGiB: n })} /></td>
                    <td className="small muted nowrap">{v.powerState.replace('powered', '')}</td>
                    <td>
                      <button className="btn danger" style={{ padding: '3px 7px' }}
                        onClick={() => setVms(vms.filter(x => x.id !== v.id))}>x</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {shown.length > 400 && (
          <p className="small muted" style={{ marginTop: 8 }}>
            Showing the first 400 of {fmt0(shown.length)} matching rows. Filter to narrow. All {fmt0(vms.length)} are included in the maths.
          </p>
        )}
      </div>
    </div>
  )
}
