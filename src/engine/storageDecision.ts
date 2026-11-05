/**
 * Guidance for choosing SAN, S2D, or hybrid on a new design.
 *
 * This informs the choice and never makes it: the selected architecture only changes when the user
 * selects one. The Datacenter rule is a Microsoft requirement. The weights are TOOL judgment, and
 * no vendor publishes them.
 */
import type { ArchitectureOption } from './solve'

export type StorageFamily = 'san' | 's2d' | 'hybrid'

export type StorageDecisionAnswers = Record<string, boolean | undefined>

type Effect = Partial<Record<StorageFamily, number>>

export interface StorageDecisionQuestion {
  id: string
  question: string
  why: string
  yes: Effect
  no: Effect
  /** Answering no rules these out. Reserved for documented requirements. */
  noExcludes?: StorageFamily[]
}

export const STORAGE_DECISION_QUESTIONS: StorageDecisionQuestion[] = [
  {
    id: 'datacenter',
    question: 'Will every host run Windows Server Datacenter edition?',
    why: 'Storage Spaces Direct requires Datacenter edition. Standard edition rules out S2D and hybrid.',
    yes: {},
    no: {},
    noExcludes: ['s2d', 'hybrid'],
  },
  {
    id: 'existingArray',
    question: 'Do you already own, or plan to standardize on, an external storage array?',
    why: 'An array you are keeping changes the cost comparison and favors SAN.',
    yes: { san: 2, hybrid: 1 },
    no: { s2d: 1 },
  },
  {
    id: 'storageTeam',
    question: 'Do you have a team and process that run storage fabrics and arrays today?',
    why: 'SAN adds fabric and array operations. S2D moves storage operations to the people who run the hosts.',
    yes: { san: 1 },
    no: { s2d: 1 },
  },
  {
    id: 'arrayFeatures',
    question: 'Do you rely on array features such as array snapshots, array replication, or offloaded copy?',
    why: 'These are array capabilities. An S2D design has to meet the same needs another way.',
    yes: { san: 2, hybrid: 1 },
    no: { s2d: 1 },
  },
  {
    id: 'independentScale',
    question: 'Will compute and storage need to grow at different rates?',
    why: 'On SAN you can add hosts and capacity separately. On S2D every node adds both.',
    yes: { san: 2 },
    no: { s2d: 1 },
  },
  {
    id: 'hostNetwork',
    question: 'Can the host network provide fast, RDMA-capable connectivity between hosts?',
    why: 'S2D sends storage traffic between hosts, so its performance depends on this network.',
    yes: { s2d: 1, hybrid: 1 },
    no: { s2d: -2, hybrid: -2 },
  },
  {
    id: 'singlePlatform',
    question: 'Do you want to buy compute and storage together as one server platform?',
    why: 'S2D uses drives inside the hosts, so there is no separate array to buy and support.',
    yes: { s2d: 2 },
    no: {},
  },
  {
    id: 'mixedWorkloads',
    question: 'Do some workloads need local high-performance storage while others fit a shared array?',
    why: 'Hybrid only pays off when workloads really do need both storage types, because you run both.',
    yes: { hybrid: 3 },
    no: { hybrid: -1 },
  },
]

export interface StorageDecisionGuide {
  answered: number
  total: number
  scores: Record<StorageFamily, number>
  excluded: StorageFamily[]
  /** Null until a question is answered, or when the top options are tied. */
  leaning: StorageFamily | null
  headline: string
  /** Facts from this workload's sizing results. */
  evidence: string[]
}

export const STORAGE_FAMILY_LABELS: Record<StorageFamily, string> = {
  san: 'SAN',
  s2d: 'Storage Spaces Direct',
  hybrid: 'Hybrid S2D + SAN',
}

/** The architecture option selected when the user chooses a family. */
export const STORAGE_FAMILY_OPTION_KEY: Record<StorageFamily, string> = {
  san: 'san',
  s2d: 's2d-3wm',
  hybrid: 'hybrid',
}

const FAMILIES: StorageFamily[] = ['san', 's2d', 'hybrid']

export function assessStorageDecision(answers: StorageDecisionAnswers, options: ArchitectureOption[] = []): StorageDecisionGuide {
  const scores: Record<StorageFamily, number> = { san: 0, s2d: 0, hybrid: 0 }
  const excluded = new Set<StorageFamily>()
  let answered = 0
  for (const question of STORAGE_DECISION_QUESTIONS) {
    const answer = answers[question.id]
    if (answer === undefined) continue
    answered += 1
    const effect = answer ? question.yes : question.no
    for (const family of FAMILIES) scores[family] += effect[family] ?? 0
    if (answer === false) question.noExcludes?.forEach((family) => excluded.add(family))
  }

  const eligible = FAMILIES.filter((family) => !excluded.has(family))
  const best = Math.max(...eligible.map((family) => scores[family]))
  const leaders = eligible.filter((family) => scores[family] === best)
  const leaning = answered > 0 && leaders.length === 1 ? leaders[0] : null

  const headline = answered === 0
    ? 'Answer these questions to see which storage design fits how you operate.'
    : leaning
      ? `Your answers lean toward ${STORAGE_FAMILY_LABELS[leaning]}.`
      : `Your answers do not separate ${leaders.map((family) => STORAGE_FAMILY_LABELS[family]).join(' and ')}.`

  const evidence: string[] = []
  const san = options.find((option) => option.key === 'san')?.result
  const s2d = options.find((option) => option.key === 's2d-3wm')?.result
  if (san && s2d && san.nodesNeeded !== null && s2d.nodesNeeded !== null) {
    evidence.push(`For this workload, SAN needs ${san.nodesNeeded} node${san.nodesNeeded === 1 ? '' : 's'} and S2D three-way mirror needs ${s2d.nodesNeeded}.`)
    if (s2d.nodesNeeded > s2d.clusterNodeLimit) {
      evidence.push(`One S2D cluster can have ${s2d.clusterNodeLimit} nodes, so S2D at this size needs larger servers or a split you choose.`)
    }
    if (san.nodesNeeded > san.clusterNodeLimit) {
      evidence.push(`One SAN cluster can have ${san.clusterNodeLimit} nodes, so SAN at this size also needs larger servers or a split you choose.`)
    }
  }
  if (san?.sanSizing) {
    evidence.push(`SAN would need about ${san.sanSizing.usableToBuyTiB.toFixed(1)} TiB of usable array capacity at ${san.sanSizing.drr}:1 data reduction.`)
  }

  return { answered, total: STORAGE_DECISION_QUESTIONS.length, scores, excluded: [...excluded], leaning, headline, evidence }
}
