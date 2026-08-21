import { DEFAULT_TIERS } from '../engine/rules'
import type { ClusterConfig, TierId, TierPolicy, Vm } from '../engine/types'

export const DEFAULT_CONFIG: ClusterConfig = {
  architecture: 'san',
  // N+2 is the service-provider default, not N+1: patching a node and losing a node must be survivable
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
  annualGrowthPct: 0,
  growthHorizonYears: 3,
  growthStrategy: 'phased',
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

interface DemoProfile {
  weight: number
  vCpu: number
  ramGiB: number
  storageGiB: number
  provisionedRatio: [number, number]
}

const GENERAL_DEMO_PROFILES: DemoProfile[] = [
  { weight: 25, vCpu: 2, ramGiB: 8, storageGiB: 100, provisionedRatio: [1.3, 2.8] },
  { weight: 40, vCpu: 4, ramGiB: 16, storageGiB: 250, provisionedRatio: [1.3, 2.6] },
  { weight: 22, vCpu: 8, ramGiB: 32, storageGiB: 500, provisionedRatio: [1.25, 2.3] },
  { weight: 10, vCpu: 12, ramGiB: 64, storageGiB: 850, provisionedRatio: [1.2, 2.0] },
  { weight: 3, vCpu: 16, ramGiB: 128, storageGiB: 1500, provisionedRatio: [1.15, 1.8] },
]

const DATABASE_DEMO_PROFILES: DemoProfile[] = [
  { weight: 15, vCpu: 8, ramGiB: 64, storageGiB: 500, provisionedRatio: [1.1, 1.7] },
  { weight: 35, vCpu: 12, ramGiB: 96, storageGiB: 1200, provisionedRatio: [1.1, 1.6] },
  { weight: 30, vCpu: 16, ramGiB: 128, storageGiB: 2200, provisionedRatio: [1.08, 1.5] },
  { weight: 15, vCpu: 24, ramGiB: 256, storageGiB: 4000, provisionedRatio: [1.08, 1.4] },
  { weight: 5, vCpu: 32, ramGiB: 512, storageGiB: 6500, provisionedRatio: [1.05, 1.3] },
]

function weightedProfile(profiles: DemoProfile[], random: () => number): DemoProfile {
  const total = profiles.reduce((sum, profile) => sum + profile.weight, 0)
  let cursor = random() * total
  for (const profile of profiles) {
    cursor -= profile.weight
    if (cursor < 0) return profile
  }
  return profiles[profiles.length - 1]
}

function randomizedDemoVm(
  index: number,
  tier: TierId,
  prefix: string,
  profiles: DemoProfile[],
  random: () => number,
): Vm {
  const profile = weightedProfile(profiles, random)
  // Storage varies within each correlated CPU/RAM profile so the demo resembles an
  // inventory instead of five repeated template sizes.
  const storageFactor = 0.65 + random() * 0.7
  const storageGiB = Math.max(20, Math.round(profile.storageGiB * storageFactor / 10) * 10)
  const [minRatio, maxRatio] = profile.provisionedRatio
  const provisionedRatio = minRatio + random() * (maxRatio - minRatio)
  const provisionedGiB = Math.max(storageGiB, Math.round(storageGiB * provisionedRatio / 10) * 10)

  return newVm({
    name: `${prefix}${String(index).padStart(3, '0')}`,
    tier,
    vCpu: profile.vCpu,
    ramGiB: profile.ramGiB,
    storageGiB,
    provisionedGiB,
  })
}

/**
 * Generate a realistic 400-VM demo fleet while preserving the worked example's
 * 90% general / 10% database mix. Each invocation creates a different blend of
 * correlated small, medium, large, and database VM profiles.
 */
export function demoFleet(random: () => number = Math.random): Vm[] {
  return [
    ...Array.from({ length: 360 }, (_, index) =>
      randomizedDemoVm(index + 1, 'general', 'APP', GENERAL_DEMO_PROFILES, random)),
    ...Array.from({ length: 40 }, (_, index) =>
      randomizedDemoVm(index + 1, 'database', 'SQL', DATABASE_DEMO_PROFILES, random)),
  ]
}
