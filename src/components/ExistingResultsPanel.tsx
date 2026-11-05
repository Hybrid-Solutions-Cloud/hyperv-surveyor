import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import {
  additionalVmsByTier, computeHostsToAdd, exhaustionText, hostGroupLabel, RESOURCE_LABELS, usedShareText,
  type ExistingAssessment, type ExistingHardware, type VmProfileChoice,
} from '../engine/existingHardware'
import { TIER_IDS } from '../engine/rules'
import type { TierId, TierPolicy } from '../engine/types'
import { Card, Field, FindingsList, NumberInput, fmt0, fmt1 } from './Shared'

interface Props {
  assessment: ExistingAssessment
  hardware: ExistingHardware
  tiers: Record<TierId, TierPolicy>
  fitPath: boolean
  setProfile: (profile: VmProfileChoice) => void
  setAddSpec: (groupId: string | undefined) => void
  managementImpact: string
}

const amount = (value: number, unit: string) => `${Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 1 }) : '—'} ${unit}`

export function ExistingResultsPanel({ assessment, hardware, tiers, fitPath, setProfile, setAddSpec, managementImpact }: Props) {
  if (assessment.verdict === 'no-hardware') {
    return (
      <section className="panel">
        <div className="fit-gap-verdict pending">
          <AlertTriangle size={22} />
          <div><span>{fitPath ? 'Fit result' : 'Capacity result'}</span><h2>Enter your hardware</h2><p>No hosts are entered yet, so nothing is calculated. Enter your hosts above{hardware.clusters.length > 0 ? ', or use the hosts from your import' : ''}.</p></div>
        </div>
      </section>
    )
  }
  const errors = assessment.findings.some((finding) => finding.severity === 'error')
  const tone = assessment.verdict === 'fits' && !errors ? 'pass' : assessment.verdict === 'no-workload' && !errors ? 'pending' : 'fail'
  const profile = hardware.vmProfile
  const setProfileField = (patch: Partial<VmProfileChoice>) => setProfile({ ...profile, ...patch })
  const groups = hardware.clusters.flatMap((cluster) => cluster.hostGroups.filter((group) => group.count > 0 && group.sockets > 0 && group.coresPerSocket > 0 && group.ramGiB > 0).map((group) => ({ cluster, group })))
  const byTier = additionalVmsByTier(assessment)
  const remedies = assessment.remedies
  const anyRemedy = remedies.compute.length + remedies.storage.length + remedies.performance.length + remedies.unplaceable.length + remedies.blockers.length > 0
  const multi = assessment.clusters.length > 1

  return (
    <div className="stack">
      <section className="panel fit-gap-panel">
        <div className={`fit-gap-verdict ${tone}`}>
          {tone === 'pass' ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
          <div>
            <span>{fitPath ? 'Fit result' : 'Capacity result'}</span>
            <h2>{assessment.headline}</h2>
            <p>{assessment.explanation}</p>
          </div>
        </div>
        {assessment.notices.map((notice) => <div className="note warn" key={notice}><strong>Check your hardware</strong>{notice}</div>)}
        <div className="grid cards">
          <Card k="Your hosts" v={assessment.totalHosts.toLocaleString()} s={`${assessment.workloadHosts.toLocaleString()} carry workload${multi ? `, ${assessment.clusters.length} clusters` : ''}`} />
          <Card k="First to run out" v={assessment.firstToRunOut ? assessment.firstToRunOut.label : 'Nothing yet'} s={assessment.firstToRunOut ? `${usedShareText(assessment.firstToRunOut.worstPct)} used${assessment.firstToRunOut.worstCluster ? ` on ${assessment.firstToRunOut.worstCluster}` : ''}` : 'no workloads included'} />
          <Card k={`More VMs: ${assessment.profile.label}`} v={fmt0(assessment.profile.count)} s={assessment.profile.limitedBy === 'host-size' ? 'the profile is larger than a host' : assessment.profile.limitedBy ? `limited by ${RESOURCE_LABELS[assessment.profile.limitedBy]}` : 'not limited'} />
          <Card k="Workloads tested" v={assessment.includedVms.toLocaleString()} s={assessment.managementVms > 0 ? `plus ${assessment.managementVms} management VMs (${managementImpact.toLowerCase()})` : 'management VMs not counted on this hardware'} />
        </div>
        <p className="small muted">{assessment.spareRule} {assessment.placement.rule}</p>
      </section>

      <section className="panel">
        <h2>Capacity and headroom</h2>
        <p className="small muted" style={{ marginTop: -6 }}>Usable capacity after spare hosts and host reserves.{multi ? ' The used share is for the fullest cluster, because VMs do not move between clusters.' : ''} {assessment.annualGrowthPct > 0 ? `At ${(assessment.annualGrowthPct * 100).toFixed(1)}% annual growth, the last column is the year each resource runs out. ${assessment.exhaustionNote}` : 'Enter annual growth to see the year each resource runs out.'}</p>
        <div className="scroll">
          <table>
            <thead><tr><th>Resource</th><th className="num">Available</th><th className="num">Used</th><th className="num">Headroom</th><th className="num">Used share</th><th>Runs out</th></tr></thead>
            <tbody>
              {assessment.resources.map((row) => (
                <tr key={row.resource}>
                  <td><strong>{row.label}</strong></td>
                  <td className="num">{amount(row.available, row.unit)}</td>
                  <td className="num">{amount(row.used, row.unit)}</td>
                  <td className="num">{amount(row.headroom, row.unit)}</td>
                  <td className="num">{usedShareText(row.worstPct)}{row.worstCluster ? <span className="small muted"> {row.worstCluster}</span> : null}</td>
                  <td>{exhaustionText(row, assessment.annualGrowthPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>How many more VMs fit</h2>
        <p className="small muted" style={{ marginTop: -6 }}>Choose the VM you want to add more of. Storage stops at the free-space target. The answers are mutually exclusive: filling one uses the room the others would have used.</p>
        <div className="capacity-input-grid">
          <Field label="Profile">
            <select value={profile.mode} onChange={(event) => setProfileField({ mode: event.target.value as VmProfileChoice['mode'] })}>
              <option value="tier">A tier's average VM</option>
              <option value="custom">My own profile</option>
            </select>
          </Field>
          <Field label={profile.mode === 'tier' ? 'Tier' : 'Tier for the vCPU ratio'}>
            <select value={profile.tier} onChange={(event) => setProfileField({ tier: event.target.value as TierId })}>
              {TIER_IDS.map((id) => <option key={id} value={id}>{tiers[id].label}</option>)}
            </select>
          </Field>
          {profile.mode === 'custom' && <>
            <Field label="vCPU"><NumberInput value={profile.vCpu} min={1} onChange={(n) => setProfileField({ vCpu: Math.max(1, n) })} /></Field>
            <Field label="Memory (GiB)"><NumberInput value={profile.ramGiB} min={1} step={4} onChange={(n) => setProfileField({ ramGiB: Math.max(1, n) })} /></Field>
            <Field label="Storage (GiB)"><NumberInput value={profile.storageGiB} min={0} step={50} onChange={(n) => setProfileField({ storageGiB: Math.max(0, n) })} /></Field>
            <Field label="IOPS per VM" hint="0 means performance does not limit the count."><NumberInput value={profile.iops} min={0} step={50} onChange={(n) => setProfileField({ iops: Math.max(0, n) })} /></Field>
          </>}
        </div>
        <div className={`note ${assessment.profile.count > 0 ? 'ok' : 'warn'}`}>
          <strong>{fmt0(assessment.profile.count)} more VMs of {fmt1(assessment.profile.vCpu)} vCPU, {fmt0(assessment.profile.ramGiB)} GiB, {fmt0(assessment.profile.storageGiB)} GiB storage</strong>
          {assessment.profile.note} {assessment.profile.limitedBy === 'host-size' ? 'The profile is larger than a host.' : assessment.profile.limitedBy ? `${RESOURCE_LABELS[assessment.profile.limitedBy]} limits the count.` : ''}
          {multi ? ` By cluster: ${assessment.profile.perCluster.map((item) => `${item.cluster} ${fmt0(item.count)}`).join(', ')}.` : ''}
        </div>
        {assessment.includedVms > 0 && (
          <table>
            <thead><tr><th>Tier average</th><th className="num">Currently</th><th className="num">Room for</th></tr></thead>
            <tbody>{TIER_IDS.map((id) => <tr key={id}><td>{tiers[id].label}</td><td className="num">{fmt0(assessment.clusters.reduce((total, cluster) => total + [...cluster.vms, ...cluster.fixedVms].filter((vm) => vm.tier === id).length, 0))}</td><td className="num"><strong>{fmt0(byTier[id])}</strong></td></tr>)}</tbody>
          </table>
        )}
      </section>

      {multi && assessment.verdict !== 'no-workload' && (
        <section className="panel">
          <h2>By cluster</h2>
          <p className="small muted" style={{ marginTop: -6 }}>{assessment.placement.sourceMatched.toLocaleString()} VMs placed by their source cluster, {assessment.placement.firstFit.toLocaleString()} placed first-fit.</p>
          <div className="scroll">
            <table>
              <thead><tr><th>Cluster</th><th className="num">Hosts</th><th className="num">VMs placed</th><th className="num">CPU used</th><th className="num">Memory used</th><th>Result</th></tr></thead>
              <tbody>{assessment.clusters.map((cluster) => (
                <tr key={cluster.id}>
                  <td><strong>{cluster.name}</strong><div className="small muted">{cluster.hostGroups.map((group) => `${group.count} × ${hostGroupLabel(group)}`).join('; ')}</div></td>
                  <td className="num">{cluster.hosts} ({cluster.spareNodes} spare)</td>
                  <td className="num">{(cluster.vms.length + cluster.fixedVms.length).toLocaleString()}</td>
                  <td className="num">{usedShareText(cluster.reverse.availablePCores > 0 ? cluster.reverse.usedPCores / cluster.reverse.availablePCores : cluster.reverse.usedPCores > 0 ? Infinity : 0)}</td>
                  <td className="num">{usedShareText(cluster.reverse.availableRamGiB > 0 ? cluster.reverse.usedRamGiB / cluster.reverse.availableRamGiB : cluster.reverse.usedRamGiB > 0 ? Infinity : 0)}</td>
                  <td><span className={`pill ${cluster.fits === false ? 'err' : cluster.fits ? 'ok' : ''}`}>{cluster.fits === null ? 'Nothing placed' : cluster.fits ? 'Fits' : 'Does not fit'}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {assessment.verdict !== 'no-workload' && (
        <section className="panel">
          <h2>{anyRemedy ? 'What it needs' : 'Nothing to add'}</h2>
          {!anyRemedy && <p className="muted">The workload fits your hosts. No remedy is needed.</p>}
          {anyRemedy && <p className="small muted" style={{ marginTop: -6 }}>Each remedy is separate, so you can see exactly what closes each gap.</p>}
          {groups.length > 1 && remedies.compute.length > 0 && (
            <Field label="Hosts to add are of this specification" hint="The default is your most common host.">
              <select value={hardware.addSpecGroupId ?? ''} onChange={(event) => setAddSpec(event.target.value || undefined)}>
                <option value="">Most common: {assessment.addSpec ? hostGroupLabel(assessment.addSpec.group) : '—'}</option>
                {groups.map(({ cluster, group }) => <option key={group.id} value={group.id}>{hostGroupLabel(group)}{multi ? ` (${cluster.name})` : ''}</option>)}
              </select>
            </Field>
          )}
          <div className="grid cards">
            <Card k="Compute" v={remedies.compute.length > 0 ? `+${computeHostsToAdd(assessment)} hosts` : 'Enough'} s={remedies.compute.map((item) => `${item.hostsToAdd} to ${item.cluster}${item.overNodeLimit ? ' (above the node limit)' : ''}`).join(', ') || 'CPU, memory and VMs per host hold'} />
            <Card k="Storage" v={remedies.storage.length > 0 ? remedies.storage.map((item) => item.domain === 'san' ? `+${fmt1(item.sanUsableToAddTiB ?? 0)} TiB` : item.s2dDrivesPerHost != null ? `${item.s2dDrivesPerHost} drives/host` : `+${item.s2dHostsToAdd ?? '?'} hosts`).join(', ') : 'Enough'} s={remedies.storage.length > 0 ? remedies.storage.map((item) => item.scope).join(', ') : 'capacity holds'} />
            <Card k="Performance" v={remedies.performance.length > 0 ? remedies.performance.map((item) => `${fmt0(item.shortfall)} ${item.metric === 'iops' ? 'IOPS' : 'MB/s'}`).join(', ') : 'Enough or not entered'} s={remedies.performance.length > 0 ? 'short of the entered sustainable figures' : 'enter sustainable figures to check it'} />
            <Card k="VMs larger than any host" v={remedies.unplaceable.length.toLocaleString()} s={remedies.unplaceable.length > 0 ? 'larger hosts or smaller VMs' : 'every VM fits on one host'} />
          </div>
          {remedies.compute.map((item) => <div className={`note ${item.overNodeLimit ? 'warn' : ''}`} key={`c-${item.cluster}`}><strong>Compute: add {item.hostsToAdd} host{item.hostsToAdd === 1 ? '' : 's'} of {item.specLabel} to {item.cluster}</strong>{item.reason}</div>)}
          {remedies.storage.map((item) => <div className="note" key={`s-${item.scope}-${item.domain}`}><strong>Storage: {item.scope}</strong>{item.detail}</div>)}
          {remedies.performance.map((item) => <div className="note" key={`p-${item.scope}-${item.domain}-${item.metric}`}><strong>Performance: {item.scope}</strong>{item.detail}</div>)}
          {remedies.blockers.map((item) => <div className="note err" key={item}><strong>Resolve first</strong>{item}</div>)}
          {assessment.unplaced.length > 0 && (
            <>
              <h3>VMs that could not be placed</h3>
              <div className="scroll">
                <table>
                  <thead><tr><th>VM</th><th className="num">vCPU</th><th className="num">Memory (GiB)</th><th>Reason</th></tr></thead>
                  <tbody>{assessment.unplaced.map((vm) => <tr key={vm.id}><td><strong>{vm.name}</strong></td><td className="num">{vm.vCpu}</td><td className="num">{fmt0(vm.ramGiB)}</td><td>{vm.detail}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
          {assessment.whatToAdd.length > 0 && (
            <>
              <h3>What to add</h3>
              <table>
                <thead><tr><th>Area</th><th>Where</th><th className="num">Add</th><th>Item</th></tr></thead>
                <tbody>{assessment.whatToAdd.map((item, index) => <tr key={index}><td>{item.category === 'vm' ? 'VMs' : item.category[0].toUpperCase() + item.category.slice(1)}</td><td>{item.scope}</td><td className="num">{item.quantity.toLocaleString('en-US', { maximumFractionDigits: 1 })} {item.unit}</td><td>{item.item}</td></tr>)}</tbody>
              </table>
            </>
          )}
        </section>
      )}

      <section className="panel">
        <h2>Findings</h2>
        <FindingsList findings={assessment.findings} />
      </section>
    </div>
  )
}
