/**
 * The options matrix for a new platform: every storage option, every reference server size plus your
 * own, and for S2D every drive layout in a declared catalog. Each combination is sized by the same
 * solver as the rest of the app (sizeVariant -> solveForward), inside one solve-cache scope so the
 * per-VM work runs once for the whole matrix.
 *
 * Nothing here selects or splits anything. The matrix lists what fits, what does not and why; the
 * shortlist ranks viable options by stated criteria; a person's click applies one.
 */
import { ARCHITECTURE_VARIANTS, REFERENCE_SERVER_PROFILES, TWO_NODE_ONLY_KEYS, TWO_WAY_MIRROR_REASON, sizeVariant } from './solve'
import { withSolveCache } from './solveCache'
import { hardwareInputProblems } from './validate'
import { LIMITS, RESILIENCY, SRC } from './rules'
import { licensableCores, usableCoresPerHost, usableRamPerHost } from './compute'
import { overLimitAdvice } from './advice'
import {
  assessStorageDecision,
  familyOfOptionKey,
  STORAGE_FAMILY_LABELS,
  type StorageDecisionAnswers,
  type StorageDecisionGuide,
  type StorageFamily,
} from './storageDecision'
import type { ClusterConfig, NodeSpec, SizingResult, TierId, TierPolicy, Vm } from './types'

/**
 * Drive layouts compared for S2D. [TOOL] A bounded planning catalog, not a vendor list: all-flash NVMe
 * capacity drives with no cache tier (storage bus caching is not required for all-flash), in three
 * common sizes and 4 to 24 drives per node. Every layout stays under Microsoft's 400 TB raw per server
 * (24 x 15.36 TB = 368.64 TB), and any design whose pool would pass 4 PB fails validation.
 * Sources: SRC.s2dHardware (minimum 4 capacity drives, 400 TB per server, 4 PB per pool).
 */
export const DRIVE_CATALOG = {
  basis: 'TOOL' as const,
  media: 'all-flash' as const,
  description: 'All-flash NVMe capacity drives, no cache tier',
  sizesTB: [3.84, 7.68, 15.36] as const,
  drivesPerNode: [4, 6, 8, 10, 12, 16, 20, 24] as const,
  source: SRC.s2dHardware,
}

export interface DriveLayout {
  key: string
  label: string
  drivesPerNode: number
  driveTB: number
  /** True for the layout entered under Refine assumptions. */
  own: boolean
  cacheDrivesPerNode: number
  cacheDriveTB: number
  media: NodeSpec['media']
  rawPerServerTB: number
}

export interface ServerSize {
  key: string
  label: string
  sockets: number
  coresPerSocket: number
  ramGiB: number
  own: boolean
}

export function catalogDriveLayouts(): DriveLayout[] {
  const layouts: DriveLayout[] = []
  for (const driveTB of DRIVE_CATALOG.sizesTB) {
    for (const drivesPerNode of DRIVE_CATALOG.drivesPerNode) {
      const rawPerServerTB = drivesPerNode * driveTB
      if (rawPerServerTB > LIMITS.S2D_MAX_RAW_PER_SERVER_TB) continue
      layouts.push({
        key: `${drivesPerNode}x${driveTB}`,
        label: `${drivesPerNode} × ${driveTB} TB NVMe`,
        drivesPerNode,
        driveTB,
        own: false,
        cacheDrivesPerNode: 0,
        cacheDriveTB: 0,
        media: 'all-flash',
        rawPerServerTB,
      })
    }
  }
  return layouts
}

const sameLayout = (layout: DriveLayout, node: NodeSpec) =>
  layout.drivesPerNode === node.capacityDrivesPerNode && layout.driveTB === node.capacityDriveTB
  && node.cacheDrivesPerNode * node.cacheDriveTB === 0 && node.media === 'all-flash'

/** The catalog, plus the layout you entered when it is not already in the catalog. */
export function matrixDriveLayouts(node: NodeSpec): DriveLayout[] {
  const catalog = catalogDriveLayouts()
  if (catalog.some((layout) => sameLayout(layout, node))) return catalog
  return [...catalog, {
    key: 'own',
    label: `Your entry: ${node.capacityDrivesPerNode} × ${node.capacityDriveTB} TB${node.cacheDrivesPerNode > 0 ? ` + ${node.cacheDrivesPerNode} × ${node.cacheDriveTB} TB cache` : ''} (${node.media === 'hybrid' ? 'HDD capacity' : 'flash'})`,
    drivesPerNode: node.capacityDrivesPerNode,
    driveTB: node.capacityDriveTB,
    own: true,
    cacheDrivesPerNode: node.cacheDrivesPerNode,
    cacheDriveTB: node.cacheDriveTB,
    media: node.media,
    rawPerServerTB: node.capacityDrivesPerNode * node.capacityDriveTB,
  }]
}

/** The four reference sizes, plus the server you entered when it differs from all of them. */
export function matrixServerSizes(node: NodeSpec): ServerSize[] {
  const sizes: ServerSize[] = REFERENCE_SERVER_PROFILES.map((profile) => ({ ...profile, own: false }))
  const matches = sizes.some((size) => size.sockets === node.sockets && size.coresPerSocket === node.coresPerSocket && size.ramGiB === node.ramGiB)
  if (!matches) sizes.push({ key: 'own', label: 'Your entry', sockets: node.sockets, coresPerSocket: node.coresPerSocket, ramGiB: node.ramGiB, own: true })
  return sizes
}

export interface MatrixOption {
  id: string
  storageKey: string
  storageLabel: string
  family: StorageFamily
  server: ServerSize
  /** Null for SAN, which has no local capacity drives. */
  drives: DriveLayout | null
  cfg: ClusterConfig
  result: SizingResult
  fitsOneCluster: boolean
  /** Design nodes when it fits; otherwise the nodes it would need in one cluster, or null. */
  nodes: number | null
  workloadNodes: number | null
  binding: string
  /** S2D usable capacity (S2D and hybrid). Null for SAN or when it does not fit. */
  s2dUsableTiB: number | null
  /** Usable SAN capacity to buy (SAN and hybrid, calculated array). */
  sanToBuyUsableTiB: number | null
  licensableCores: number | null
  /** Smallest remaining headroom across CPU, memory and S2D capacity, in percent. */
  headroomPct: number | null
  rejected: boolean
  rejectionReasons: string[]
  /** Hardware-input problems for this option only (C14). */
  problems: string[]
  /** True when the only reason it is rejected is the one-cluster node limit, so a split could place it. */
  splitCandidate: boolean
}

export interface ShortlistEntry {
  rank: number
  option: MatrixOption
  rationale: string[]
  tradeoffs: string[]
  /** Set when the storage guide answers moved this entry up. */
  guideNote: string | null
}

export interface OptionsMatrix {
  rows: MatrixOption[]
  viable: MatrixOption[]
  shortlist: ShortlistEntry[]
  /** The best over-limit option per storage type, for the "If you choose to split" view. Never applied without a click. */
  splitCandidates: MatrixOption[]
  guide: StorageDecisionGuide
  servers: ServerSize[]
  driveLayouts: DriveLayout[]
  rankingCriteria: string[]
}

export const RANKING_CRITERIA = [
  'Fits one cluster first (designs that need a split are listed separately).',
  'Then the fewest licensable cores.',
  'Then the fewest nodes.',
  'Then the most headroom at the tightest resource (CPU, memory or S2D capacity).',
  'Then the least raw drive capacity to buy.',
  'One entry per storage option, so the shortlist compares different designs.',
]

/** Plain trade-offs for each storage option. [TOOL] wording; facts cited in rules.ts. */
export const STORAGE_TRADEOFFS: Record<string, string> = {
  san: 'A separate array to buy, support and operate; compute and storage scale independently. Array connectivity (Fibre Channel or iSCSI, MPIO) is planned separately.',
  's2d-3wm': 'Highest performance and the simplest S2D layout; 33% capacity efficiency, so it needs the most raw drive capacity.',
  's2d-map': 'Better capacity efficiency than mirror. Writes land in the mirror tier and move to parity, so validate heavy random-write workloads. Needs 4 or more nodes and ReFS.',
  's2d-dp': 'Best capacity efficiency, with the highest write latency and CPU use. Suits capacity-oriented workloads.',
  's2d-2wm': 'Two nodes only and tolerates one failure. Microsoft recommends nested resiliency for two-node production.',
  's2d-nested-2wm': 'Two nodes, tolerates two failures at once (a server and a drive). 25% capacity efficiency.',
  's2d-nested-map': 'Two nodes, tolerates two failures at once, about 35 to 40% capacity efficiency with more write overhead.',
  hybrid: 'Runs both S2D and an array: performance tiers on S2D, the rest on SAN. Two storage systems to operate, and the S2D node limit still applies.',
}

function headroom(cfg: ClusterConfig, result: SizingResult): number | null {
  if (!result.feasible || result.workloadNodes <= 0) return null
  const cores = result.workloadNodes * usableCoresPerHost(cfg.node, cfg)
  const ram = result.workloadNodes * usableRamPerHost(cfg.node, cfg)
  const shares: number[] = []
  if (cores > 0) shares.push(1 - result.demand.requiredPCores / cores)
  if (ram > 0) shares.push(1 - result.demand.requiredRamGiB / ram)
  if (result.capacity && result.capacity.usableTiB > 0 && result.requiredS2dTiB > 0) shares.push(1 - result.requiredS2dTiB / result.capacity.usableTiB)
  return shares.length ? Math.min(...shares) * 100 : null
}

function nodeConfig(base: ClusterConfig, server: ServerSize, drives: DriveLayout | null): ClusterConfig {
  const node: NodeSpec = { ...base.node, sockets: server.sockets, coresPerSocket: server.coresPerSocket, ramGiB: server.ramGiB }
  if (drives) {
    node.capacityDrivesPerNode = drives.drivesPerNode
    node.capacityDriveTB = drives.driveTB
    node.cacheDrivesPerNode = drives.cacheDrivesPerNode
    node.cacheDriveTB = drives.cacheDriveTB
    node.media = drives.media
  }
  return { ...base, node }
}

function rejectionFromResult(option: { result: SizingResult; cfg: ClusterConfig; storageKey: string }): string | null {
  const r = option.result
  if (r.feasible) return null
  if (TWO_NODE_ONLY_KEYS.has(option.storageKey) && r.nodesNeeded !== null && r.nodesNeeded > 2) {
    return option.storageKey === 's2d-2wm'
      ? `${TWO_WAY_MIRROR_REASON} This workload needs ${r.nodesNeeded} nodes.`
      : `Nested resiliency needs exactly two nodes; this workload needs ${r.nodesNeeded}.`
  }
  if (r.nodesNeeded !== null && r.nodesNeeded > r.clusterNodeLimit) {
    return `Needs ${r.nodesNeeded} nodes in one cluster; the limit is ${r.clusterNodeLimit}. ${overLimitAdvice(r, option.cfg)}`
  }
  const errors = r.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.message)
  return errors.length ? errors.join(' ') : r.bindingExplanation
}

export interface OptionsMatrixInputs {
  cfg: ClusterConfig
  vms: Vm[]
  tiers: Record<TierId, TierPolicy>
  /** Management VMs counted on the workload cluster, as in the resolved design. */
  fixedVms?: Vm[]
  answers?: StorageDecisionAnswers
}

/** Sizes every combination. Pure; run it lazily, it is the most expensive call in the app. */
export function buildOptionsMatrix(input: OptionsMatrixInputs): OptionsMatrix {
  const fixedVms = input.fixedVms ?? []
  const guide = assessStorageDecision(input.answers ?? {})
  const servers = matrixServerSizes(input.cfg.node)
  const driveLayouts = matrixDriveLayouts(input.cfg.node)
  const rows: MatrixOption[] = withSolveCache(() => {
    const out: MatrixOption[] = []
    for (const variant of ARCHITECTURE_VARIANTS) {
      const family = familyOfOptionKey(variant.key)
      for (const server of servers) {
        const layouts: Array<DriveLayout | null> = family === 'san' ? [null] : driveLayouts
        for (const drives of layouts) {
          const sized = sizeVariant(nodeConfig(input.cfg, server, drives), variant, input.vms, input.tiers, fixedVms)
          const r = sized.result
          const problems = hardwareInputProblems(sized.cfg)
          const reasons: string[] = [...problems]
          if (guide.excluded.includes(family)) reasons.push(`Ruled out by your answers: ${STORAGE_FAMILY_LABELS[family]} is excluded.`)
          const resultReason = problems.length ? null : rejectionFromResult({ result: r, cfg: sized.cfg, storageKey: variant.key })
          if (resultReason) reasons.push(resultReason)
          const overLimitOnly = !r.feasible && problems.length === 0 && !guide.excluded.includes(family)
            && !TWO_NODE_ONLY_KEYS.has(variant.key)
            && r.nodesNeeded !== null && r.nodesNeeded > r.clusterNodeLimit
          const nodes = r.feasible ? r.nodes : r.nodesNeeded
          out.push({
            id: `${variant.key}|${server.key}|${drives?.key ?? 'none'}`,
            storageKey: variant.key,
            storageLabel: variant.label,
            family,
            server,
            drives,
            cfg: sized.cfg,
            result: r,
            fitsOneCluster: r.feasible,
            nodes,
            workloadNodes: r.feasible ? r.workloadNodes : null,
            binding: r.binding,
            s2dUsableTiB: r.feasible && r.capacity ? r.capacity.usableTiB : null,
            sanToBuyUsableTiB: r.feasible ? r.sanSizing?.usableToBuyTiB ?? null : null,
            licensableCores: nodes === null ? null : licensableCores(sized.cfg.node) * nodes,
            headroomPct: headroom(sized.cfg, r),
            rejected: reasons.length > 0,
            rejectionReasons: reasons,
            problems,
            splitCandidate: overLimitOnly,
          })
        }
      }
    }
    return out
  })
  const viable = rows.filter((row) => !row.rejected)
  const shortlist = rankShortlist(viable, guide)
  const splitCandidates = bestPerStorage(rows.filter((row) => row.splitCandidate), (a, b) => (a.nodes ?? Infinity) - (b.nodes ?? Infinity) || (a.licensableCores ?? Infinity) - (b.licensableCores ?? Infinity))
  return { rows, viable, shortlist, splitCandidates, guide, servers, driveLayouts, rankingCriteria: RANKING_CRITERIA }
}

/** The stated ranking: fits one cluster, fewest licensable cores, fewest nodes, most headroom, least raw drives. */
export function compareOptions(a: MatrixOption, b: MatrixOption): number {
  return Number(b.fitsOneCluster) - Number(a.fitsOneCluster)
    || (a.licensableCores ?? Infinity) - (b.licensableCores ?? Infinity)
    || (a.nodes ?? Infinity) - (b.nodes ?? Infinity)
    || (b.headroomPct ?? -Infinity) - (a.headroomPct ?? -Infinity)
    || (a.drives?.rawPerServerTB ?? 0) - (b.drives?.rawPerServerTB ?? 0)
}

function bestPerStorage(options: MatrixOption[], compare: (a: MatrixOption, b: MatrixOption) => number): MatrixOption[] {
  const best = new Map<string, MatrixOption>()
  for (const option of options) {
    const current = best.get(option.storageKey)
    if (!current || compare(option, current) < 0) best.set(option.storageKey, option)
  }
  return [...best.values()].sort(compare)
}

const fmt = (value: number, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits })

function rationale(option: MatrixOption): string[] {
  const r = option.result
  const lines = [
    `Fits one cluster at ${r.nodes} nodes (${r.workloadNodes} carrying workload plus N+${option.cfg.spareNodes}).`,
    `${fmt(option.licensableCores ?? 0)} licensable cores on ${option.server.label.toLowerCase()} servers (${option.server.sockets} × ${option.server.coresPerSocket} cores, ${fmt(option.server.ramGiB)} GiB).`,
    `${r.binding === 'node-floor' ? 'The minimum node count' : `${r.binding.replace('-', ' ')}`} sets the size${option.headroomPct !== null ? `; ${fmt(option.headroomPct, 1)}% headroom remains at the tightest resource` : ''}.`,
  ]
  if (option.drives) lines.push(`${option.drives.label} per node: ${fmt(option.s2dUsableTiB ?? 0, 1)} TiB usable with ${RESILIENCY[option.cfg.resiliency].label.toLowerCase()}.`)
  if (option.sanToBuyUsableTiB !== null) lines.push(`About ${fmt(option.sanToBuyUsableTiB, 1)} TiB of usable SAN capacity to buy.`)
  return lines
}

/** Top three viable options, one per storage type, with the guide's effect shown. */
export function rankShortlist(viable: MatrixOption[], guide: StorageDecisionGuide, size = 3): ShortlistEntry[] {
  const ranked = bestPerStorage(viable, compareOptions)
  let ordered = ranked.slice(0, size)
  const notes = new Map<string, string>()
  if (guide.leaning && ordered.length > 0 && ordered[0].family !== guide.leaning) {
    const preferred = ranked.find((option) => option.family === guide.leaning)
    if (preferred) {
      ordered = [preferred, ...ordered.filter((option) => option !== preferred)].slice(0, size)
      notes.set(preferred.id, `Moved to first because your answers lean toward ${STORAGE_FAMILY_LABELS[guide.leaning]}. Without your answers it ranks ${ranked.indexOf(preferred) + 1} of ${ranked.length}.`)
    }
  }
  return ordered.map((option, index) => ({
    rank: index + 1,
    option,
    rationale: rationale(option),
    tradeoffs: [STORAGE_TRADEOFFS[option.storageKey] ?? ''].filter(Boolean),
    guideNote: notes.get(option.id) ?? null,
  }))
}

/**
 * The state change selecting an option makes. Null when the option is ruled out (C15). A split
 * candidate can only be chosen through the split view, where the user also chooses to split.
 */
export function optionSelection(option: MatrixOption, base: ClusterConfig, mode: 'one-cluster' | 'split' = 'one-cluster'): { chosenKey: string; cfg: ClusterConfig } | null {
  if (mode === 'one-cluster' ? option.rejected : !option.splitCandidate) return null
  const node: NodeSpec = { ...base.node, sockets: option.server.sockets, coresPerSocket: option.server.coresPerSocket, ramGiB: option.server.ramGiB }
  if (option.drives && !option.drives.own) {
    node.capacityDrivesPerNode = option.drives.drivesPerNode
    node.capacityDriveTB = option.drives.driveTB
    node.cacheDrivesPerNode = 0
    node.cacheDriveTB = 0
    node.media = 'all-flash'
  }
  return { chosenKey: option.storageKey, cfg: { ...base, node } }
}

/** True when the option is the one the design currently uses. */
export function isSelectedOption(option: MatrixOption, cfg: ClusterConfig, chosenKey: string): boolean {
  if (option.storageKey !== chosenKey) return false
  const n = cfg.node
  if (n.sockets !== option.server.sockets || n.coresPerSocket !== option.server.coresPerSocket || n.ramGiB !== option.server.ramGiB) return false
  if (!option.drives) return true
  return n.capacityDrivesPerNode === option.drives.drivesPerNode && n.capacityDriveTB === option.drives.driveTB
    && n.cacheDrivesPerNode === option.drives.cacheDrivesPerNode && n.cacheDriveTB === option.drives.cacheDriveTB && n.media === option.drives.media
}
