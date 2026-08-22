import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { assessFitGap } from '../engine/fitGap'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'
import { Card, fmt0, fmt1 } from './Shared'

export function FitGapPanel({ cfg, nodes, vms, tiers }: {
  cfg: ClusterConfig
  nodes: number
  vms: Vm[]
  tiers: Record<TierId, TierPolicy>
}) {
  const result = assessFitGap(cfg, nodes, vms, tiers)
  const headline = result.fits === null
    ? 'Workload inventory required for a fit decision'
    : result.fits
      ? 'The complete included workload fits'
      : 'The complete included workload does not fit'

  return (
    <section className="panel fit-gap-panel">
      <div className={`fit-gap-verdict ${result.fits === null ? 'pending' : result.fits ? 'pass' : 'fail'}`}>
        {result.fits ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
        <div><span>Fit-and-gap result</span><h2>{headline}</h2><p>{result.assessedVms.toLocaleString()} included VMs tested against {result.existingNodes} existing nodes using the existing-hardware assumptions below.</p></div>
      </div>
      <div className="grid cards">
        <Card k="Existing nodes" v={result.existingNodes} s="entered hardware" />
        <Card k="Required nodes" v={result.requiredNodesAtSameSpec ?? 'Not resolved'} s="same node specification" />
        <Card k="Additional nodes" v={result.additionalNodes ?? 'Not sufficient'} s={result.additionalNodes === null ? 'review non-node blockers' : 'same specification'} />
        <Card k="Binding resource" v={result.reverse.binding} s={result.reverse.bindingExplanation} />
      </div>
      {(result.deficits.physicalCores > 0 || result.deficits.ramGiB > 0 || result.deficits.s2dTiB > 0 || result.deficits.sanTiB > 0) && (
        <div className="fit-gap-deficits">
          <h3>Current deficits</h3>
          <div className="grid cards">
            {result.deficits.physicalCores > 0 && <Card k="CPU deficit" v={fmt1(result.deficits.physicalCores)} s="physical cores" />}
            {result.deficits.ramGiB > 0 && <Card k="Memory deficit" v={fmt0(result.deficits.ramGiB)} s="GiB" />}
            {result.deficits.s2dTiB > 0 && <Card k="S2D deficit" v={fmt1(result.deficits.s2dTiB)} s="usable TiB" />}
            {result.deficits.sanTiB > 0 && <Card k="SAN deficit" v={fmt1(result.deficits.sanTiB)} s="effective TiB" />}
          </div>
        </div>
      )}
      <ul className="fit-gap-recommendations">{result.recommendations.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
  )
}
