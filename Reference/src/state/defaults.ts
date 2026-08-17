import { DEFAULT_TIERS } from '../engine/rules'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'

export const DEFAULT_CONFIG: ClusterConfig = {
  architecture: 'san',
  // N+2 is the HAAS default, not N+1: patching a node and losing a node must be survivable
  // concurrently. Microsoft's Azure Local guidance notes resiliency is temporarily reduced
  // while nodes are drained and restarted one by one.
  spareNodes: 2,
  resiliency: 'three-way-mirror',
  nestedMapMirrorPct: 0.1,
  backupMethod: 'rct',
  // Representative modern 2U node — dual 48-core EPYC class, 1.5 TiB RAM, all-NVMe.
  // Not a Dell BOM: the tool derives a reference architecture from the workload rather than
  // picking from a catalogue, because customers frequently reuse hardware they already own.
  node: {
    sockets: 2,
    coresPerSocket: 48,
    ramGiB: 1536,
    capacityDrivesPerNode: 8,
    capacityDriveTB: 7.68,
    cacheDrivesPerNode: 2,
    cacheDriveTB: 3.2,
    media: 'all-flash',
  },
  san: {
    usableTiB: 500,
    // Conservative against Pure/Everpure's blended 5:1 marketing average. NEVER use the
    // "10:1 including thin provisioning" figure — that is not data reduction.
    drr: 2.5,
    thinProvisioningSavings: 0,
  },
  hybridS2dShare: 0.3,
  growthFactor: 1.0,
  smtFactor: 1.0,
  hostCoreReservePct: 0.04,
  hostRamReserveGiB: 32,
  hostRamReservePct: 0.12,
}

export function defaultTiers(): Record<TierId, TierPolicy> {
  return JSON.parse(JSON.stringify(DEFAULT_TIERS))
}

let idSeq = 0
export function newVm(partial: Partial<Vm> = {}): Vm {
  idSeq += 1
  return {
    id: `m-${Date.now()}-${idSeq}`,
    name: partial.name ?? `VM-${idSeq}`,
    tier: 'general',
    vCpu: 4,
    ramGiB: 16,
    storageGiB: 200,
    provisionedGiB: 400,
    powerState: 'poweredOn',
    include: true,
    ...partial,
  }
}

/** Bulk add: "120 x 4 vCPU / 16 GiB / 200 GiB" as one action. */
export function bulkVms(
  count: number, tier: TierId, vCpu: number, ramGiB: number, storageGiB: number, prefix: string,
): Vm[] {
  const out: Vm[] = []
  for (let i = 1; i <= count; i++) {
    out.push(newVm({
      name: `${prefix}${String(i).padStart(3, '0')}`,
      tier, vCpu, ramGiB, storageGiB, provisionedGiB: storageGiB * 2,
    }))
  }
  return out
}

/**
 * Demo fleet matching the spec's worked example: 400 VMs, 90% general / 10% database.
 * The 10% are deliberately the hard hitters — 16 vCPU at 1:1, 128 GiB fixed, and a lot of
 * storage — because that mix is what makes the SAN-vs-S2D node counts diverge.
 */
export function demoFleet(): Vm[] {
  return [
    ...bulkVms(360, 'general', 4, 16, 550, 'APP'),
    ...bulkVms(40, 'database', 16, 128, 2200, 'SQL'),
  ]
}
