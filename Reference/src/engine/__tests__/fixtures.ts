import { DEFAULT_TIERS } from '../rules'
import type { ClusterConfig, NodeSpec, TierId, TierPolicy, Vm } from '../types'

export const BASE_NODE: NodeSpec = {
  sockets: 2,
  coresPerSocket: 32,
  ramGiB: 1024,
  capacityDrivesPerNode: 8,
  capacityDriveTB: 7.68,
  cacheDrivesPerNode: 2,
  cacheDriveTB: 3.2,
  media: 'all-flash',
}

export const BASE_CONFIG: ClusterConfig = {
  architecture: 's2d',
  spareNodes: 1,
  resiliency: 'three-way-mirror',
  nestedMapMirrorPct: 0.1,
  backupMethod: 'rct',
  node: BASE_NODE,
  san: { usableTiB: 500, drr: 2.5, thinProvisioningSavings: 0 },
  hybridS2dShare: 0.3,
  growthFactor: 1.0,
  smtFactor: 1.0,
  hostCoreReservePct: 0.04,
  hostRamReserveGiB: 32,
  hostRamReservePct: 0.12,
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export function makeConfig(patch: DeepPartial<ClusterConfig> = {}): ClusterConfig {
  return {
    ...BASE_CONFIG,
    ...patch,
    node: { ...BASE_NODE, ...(patch.node ?? {}) } as NodeSpec,
    san: { ...BASE_CONFIG.san, ...(patch.san ?? {}) } as ClusterConfig['san'],
  } as ClusterConfig
}

export function makeTiers(patch: Partial<Record<TierId, Partial<TierPolicy>>> = {}) {
  const out = {} as Record<TierId, TierPolicy>
  for (const k of Object.keys(DEFAULT_TIERS) as TierId[]) {
    out[k] = { ...DEFAULT_TIERS[k], ...(patch[k] ?? {}) }
  }
  return out
}

let seq = 0
export function vm(p: Partial<Vm> = {}): Vm {
  seq += 1
  return {
    id: `vm-${seq}`,
    name: p.name ?? `VM${seq}`,
    tier: 'general',
    vCpu: 4,
    ramGiB: 16,
    storageGiB: 200,
    provisionedGiB: 400,
    powerState: 'poweredOn',
    include: true,
    ...p,
  }
}

/** The scenario from the spec: 400 VMs, 90% general / 10% database. */
export function fleet400(): Vm[] {
  const out: Vm[] = []
  for (let i = 0; i < 360; i++) {
    out.push(vm({ name: `GEN${i}`, tier: 'general', vCpu: 4, ramGiB: 16, storageGiB: 1365, provisionedGiB: 2048 }))
  }
  for (let i = 0; i < 40; i++) {
    out.push(vm({ name: `SQL${i}`, tier: 'database', vCpu: 16, ramGiB: 128, storageGiB: 3072, provisionedGiB: 4096 }))
  }
  return out
}
