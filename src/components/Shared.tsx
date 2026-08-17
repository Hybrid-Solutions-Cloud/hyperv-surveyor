import React from 'react'
import type { Finding } from '../engine/types'

export function PageHeader(props: {
  eyebrow?: string
  title: string
  description: string
  actions?: React.ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        {props.eyebrow && <div className="eyebrow">{props.eyebrow}</div>}
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
    </header>
  )
}

export function Field(props: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
      {props.hint && <span className="small muted" style={{ marginTop: 3, fontWeight: 400 }}>{props.hint}</span>}
    </label>
  )
}

export function NumberInput(props: {
  value: number
  onChange: (n: number) => void
  step?: number
  min?: number
  max?: number
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(props.value) ? props.value : 0}
      step={props.step ?? 1}
      min={props.min}
      max={props.max}
      onChange={e => props.onChange(parseFloat(e.target.value) || 0)}
    />
  )
}

export function Card(props: { k: string; v: React.ReactNode; s?: React.ReactNode }) {
  return (
    <div className="card">
      <div className="k">{props.k}</div>
      <div className="v">{props.v}</div>
      {props.s && <div className="s">{props.s}</div>}
    </div>
  )
}

export function BasisPill({ basis }: { basis: Finding['basis'] }) {
  const cls = basis === 'MS' ? 'ms' : basis === 'MS-REC' ? 'msrec' : 'tool'
  return <span className={`pill ${cls}`}>{basis}</span>
}

export function SeverityPill({ severity }: { severity: Finding['severity'] }) {
  const cls = severity === 'error' ? 'err' : severity === 'warning' ? 'warn' : 'info'
  return <span className={`pill ${cls}`}>{severity}</span>
}

export function FindingsList({ findings }: { findings: Finding[] }) {
  const order = { error: 0, warning: 1, info: 2 } as const
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity])
  if (sorted.length === 0) return <p className="muted small">No findings.</p>
  return (
    <div>
      {sorted.map((f, i) => (
        <div className="finding" key={`${f.code}-${i}`}>
          <div><SeverityPill severity={f.severity} /></div>
          <div><BasisPill basis={f.basis} /></div>
          <div>
            {f.message}
            {f.source && (
              <div><a href={f.source} target="_blank" rel="noreferrer">{f.source}</a></div>
            )}
          </div>
        </div>
      ))}
      <div className="legend">
        <span><span className="pill ms">MS</span> Microsoft hard rule — enforced</span>
        <span><span className="pill msrec">MS-REC</span> Microsoft recommendation</span>
        <span><span className="pill tool">TOOL</span> our assumption, not vendor guidance</span>
      </div>
    </div>
  )
}

export function Meter({ label, pct }: { label: string; pct: number }) {
  const clamped = Math.max(0, Math.min(1.2, pct))
  const cls = pct >= 1 ? 'hot' : pct >= 0.85 ? 'warm' : ''
  return (
    <div style={{ marginBottom: 9 }}>
      <div className="small" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span className="mono">{(pct * 100).toFixed(1)}%</span>
      </div>
      <div className="bar"><i className={cls} style={{ width: `${Math.min(100, clamped * 100)}%` }} /></div>
    </div>
  )
}

export const fmt1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '—')
export const fmt0 = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : '—')
