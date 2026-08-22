/** Validation. Errors block a design; warnings annotate it. */
import { LIMITS, RESILIENCY, SRC } from './rules'
import { cacheRatio, rawPerServerTB, usesCacheTier } from './capacity'
import { s2dMetadataRamGiB, totalCores } from './compute'
import { assessPerformanceData } from './performance'
import type { ClusterConfig, CsvPlan, Finding, TierId, TierPolicy, Vm } from './types'

const err = (code: string, message: string, basis: Finding['basis'], source?: string): Finding => ({
  severity: 'error', code, message, basis, source,
})
const warn = (code: string, message: string, basis: Finding['basis'], source?: string): Finding => ({
  severity: 'warning', code, message, basis, source,
})
const info = (code: string, message: string, basis: Finding['basis'], source?: string): Finding => ({
  severity: 'info', code, message, basis, source,
})

export function validateDesign(
  cfg: ClusterConfig,
  nodes: number,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
  csvPlans: CsvPlan[],
): Finding[] {
  const f: Finding[] = []
  const node = cfg.node
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'
  const cores = totalCores(node)
  const performance = assessPerformanceData(vms, cfg)

  if ((cfg.sizingBasis ?? 'allocation') === 'measured-p95') {
    const benchmarkFactor = Math.max(0.1, cfg.cpuPerformanceFactor ?? 1)
    f.push(info('CPU_BENCHMARK_FACTOR',
      `A ${benchmarkFactor.toFixed(2)}x target/source per-core benchmark factor is applied to CPU demand. Validate it with comparable source and target benchmark evidence; clock speed alone is not sufficient.`,
      'TOOL'))
    if (performance.measuredVms === 0) {
      f.push(warn('PERFORMANCE_DATA_MISSING',
        'Measured P95 sizing is selected, but no VM performance measurements matched the inventory. CPU and memory fall back to allocation.',
        'TOOL'))
    } else if (performance.confidence !== 'high') {
      f.push(warn('PERFORMANCE_DATA_COVERAGE',
        `Measured-data confidence is ${performance.confidence} (${performance.score}/100). ${performance.fallbackVms} VM(s) use allocation fallback; review coverage before approving the design.`,
        'TOOL'))
    } else {
      f.push(info('PERFORMANCE_DATA_HIGH_CONFIDENCE',
        `Measured-data confidence is high (${performance.score}/100) with ${performance.observationDaysMedian ?? 0} median observation days.`,
        'TOOL'))
    }
    if ((Object.values(tiers) as TierPolicy[]).some((tier) => tier.rightSizingFactor !== 1)) {
      f.push(info('MEASURED_RIGHT_SIZING_PRECEDENCE',
        'For each measured resource, P95 plus the comfort factor replaces the tier right-sizing factor. The tier factor applies only where that CPU or memory measurement is missing, preventing double discounting.',
        'TOOL'))
    }
  }

  // ---- Node count ceilings -------------------------------------------------
  if (usesS2d && nodes > LIMITS.S2D_MAX_NODES) {
    f.push(err('S2D_MAX_NODES',
      `${nodes} nodes exceeds the ${LIMITS.S2D_MAX_NODES}-node Storage Spaces Direct ceiling. This is NOT the 64-node failover cluster limit — that stops applying the moment S2D is enabled. Split into multiple clusters.`,
      'MS', SRC.s2dOverview))
  }
  if (!usesS2d && nodes > LIMITS.CLUSTER_MAX_NODES) {
    f.push(err('CLUSTER_MAX_NODES',
      `${nodes} nodes exceeds the ${LIMITS.CLUSTER_MAX_NODES}-node failover cluster maximum.`,
      'MS', SRC.maxScale))
  }

  // ---- Resiliency vs node count -------------------------------------------
  if (usesS2d) {
    const def = RESILIENCY[cfg.resiliency]
    if (nodes < def.minNodes) {
      f.push(err('RESILIENCY_MIN_NODES',
        `${def.label} requires a minimum of ${def.minNodes} nodes; this design has ${nodes}.`,
        'MS', SRC.faultTolerance))
    }
    if (nodes > def.maxNodes) {
      f.push(err('RESILIENCY_MAX_NODES',
        `${def.label} is only valid up to ${def.maxNodes} nodes.`, 'MS', SRC.nestedResiliency))
    }
    f.push(info('S2D_FAILURE_CAP',
      `S2D dynamic quorum tolerates a maximum of ${LIMITS.S2D_MAX_SIMULTANEOUS_FAILURES} simultaneous node failures regardless of cluster size.`,
      'MS', SRC.quorum))
  }

  // ---- Drives --------------------------------------------------------------
  if (usesS2d) {
    if (node.capacityDrivesPerNode < LIMITS.MIN_CAPACITY_DRIVES) {
      f.push(err('MIN_CAPACITY_DRIVES',
        `${node.capacityDrivesPerNode} capacity drives per node is below the Windows Server minimum of ${LIMITS.MIN_CAPACITY_DRIVES}.`,
        'MS', SRC.s2dHardware))
    }
    if (usesCacheTier(node) && node.cacheDrivesPerNode < LIMITS.MIN_CACHE_DRIVES) {
      f.push(err('MIN_CACHE_DRIVES',
        `A cache tier requires a minimum of ${LIMITS.MIN_CACHE_DRIVES} cache drives per node for redundancy.`,
        'MS', SRC.s2dHardware))
    }
    if (node.media === 'hybrid' && !usesCacheTier(node)) {
      f.push(err('HDD_NEEDS_CACHE',
        'A hybrid (HDD capacity) configuration requires a cache tier. HDD-only is not supported.',
        'MS', SRC.s2dHardware))
    }
    if (usesCacheTier(node)) {
      const ratio = cacheRatio(node)
      const target = node.media === 'hybrid' ? LIMITS.CACHE_RATIO_HYBRID : LIMITS.CACHE_RATIO_ALLFLASH
      if (ratio < target) {
        f.push(warn('CACHE_RATIO',
          `Cache is ${(ratio * 100).toFixed(1)}% of capacity, below the ${(target * 100).toFixed(0)}% starting recommendation for ${node.media === 'hybrid' ? 'hybrid' : 'all-flash'}. Note Azure Local imposes a hard ${(LIMITS.CACHE_RATIO_AZURE_LOCAL_HYBRID * 100).toFixed(0)}% floor for hybrid.`,
          'MS-REC', SRC.s2dHardware))
      }
      if (node.capacityDrivesPerNode % node.cacheDrivesPerNode !== 0) {
        f.push(warn('CACHE_BINDING',
          `Capacity drives (${node.capacityDrivesPerNode}) should be a whole multiple of cache drives (${node.cacheDrivesPerNode}) for even cache binding.`,
          'MS-REC', SRC.s2dHardware))
      }
      f.push(info('CACHE_ENDURANCE',
        `Cache drives require at least ${LIMITS.MIN_CACHE_DWPD} DWPD endurance. Cache contributes zero usable capacity.`,
        'MS', SRC.s2dHardware))
    }
    const perServer = rawPerServerTB(node)
    if (perServer > LIMITS.S2D_MAX_RAW_PER_SERVER_TB) {
      f.push(warn('RAW_PER_SERVER',
        `${perServer.toFixed(0)} TB raw per server exceeds the ${LIMITS.S2D_MAX_RAW_PER_SERVER_TB} TB recommendation. Resync after a failure will take proportionally longer.`,
        'MS-REC', SRC.s2dHardware))
    }
    if (perServer * nodes > LIMITS.S2D_MAX_POOL_TB) {
      f.push(err('POOL_MAX',
        `Pool raw capacity exceeds the ${LIMITS.S2D_MAX_POOL_TB} TB maximum.`, 'MS', SRC.s2dHardware))
    }
    const metaRam = s2dMetadataRamGiB(node, true)
    if (metaRam >= node.ramGiB) {
      f.push(err('S2D_METADATA_RAM',
        `S2D pool metadata needs ${metaRam.toFixed(0)} GiB per node (4 GiB per TB of cache), which exceeds the ${node.ramGiB} GiB installed.`,
        'MS', SRC.s2dHardware))
    } else if (metaRam > 0) {
      f.push(info('S2D_METADATA_RAM_OK',
        `S2D pool metadata reserves ${metaRam.toFixed(0)} GiB of host RAM per node (4 GiB per TB of cache). Deducted from usable memory.`,
        'MS', SRC.s2dHardware))
    }
  }

  // ---- Quorum --------------------------------------------------------------
  if (nodes === 2 && (cfg.witnessType ?? 'cloud') === 'none') {
    f.push(err('WITNESS_REQUIRED',
      'A 2-node cluster requires a witness. Without one, dynamic quorum zeroes a node vote and an unexpected failure of the surviving voter takes the cluster down. Use a cloud witness or a file share witness.',
      'MS', SRC.quorum))
  } else if ((nodes === 3 || nodes === 4) && (cfg.witnessType ?? 'cloud') === 'none') {
    f.push(warn('WITNESS_RECOMMENDED',
      `A ${nodes}-node cluster should have a witness — it is what allows a second sequential failure to be survived.`,
      'MS-REC', SRC.quorum))
  } else if (nodes >= 5) {
    f.push(info('WITNESS_UNNEEDED',
      'At 5+ nodes a witness adds no additional resiliency.', 'MS-REC', SRC.quorum))
  }

  // ---- CSV layout ----------------------------------------------------------
  const totalCsvs = csvPlans.reduce((n, p) => n + p.count, 0)
  if (totalCsvs > LIMITS.MAX_CSVS_PER_CLUSTER) {
    f.push(warn('CSV_COUNT',
      `${totalCsvs} logical storage objects exceeds the recommended maximum of ${LIMITS.MAX_CSVS_PER_CLUSTER} per cluster. Increase the recovery-unit size or target VMs per recovery unit, or split the cluster.`,
      'MS-REC', SRC.planVolumes))
  }
  for (const p of csvPlans) {
    if (p.sizeTiB > LIMITS.MAX_CSV_SIZE_TIB) {
      f.push(warn('CSV_SIZE',
        `${p.tier} ${p.domain.toUpperCase()} CSVs at ${p.sizeTiB.toFixed(1)} TiB exceed the ${LIMITS.MAX_CSV_SIZE_TIB} TiB recommendation.`,
        'MS-REC', SRC.planVolumes))
    }
    if (cfg.backupMethod === 'vss-volsnap' && p.sizeTiB > LIMITS.VSS_CSV_LIMIT_TIB) {
      f.push(warn('CSV_VSS_SIZE',
        `${p.tier} CSVs at ${p.sizeTiB.toFixed(1)} TiB exceed the ${LIMITS.VSS_CSV_LIMIT_TIB} TiB limit for VSS/volsnap-based backup.`,
        'MS', SRC.planVolumes))
    }
  }
  const s2dCsvs = csvPlans.filter((plan) => plan.domain === 's2d').reduce((sum, plan) => sum + plan.count, 0)
  if (s2dCsvs > 0 && (s2dCsvs < nodes || s2dCsvs % nodes !== 0)) {
    f.push(warn('CSV_MULTIPLE',
      `The S2D domain has ${s2dCsvs} volumes across ${nodes} nodes. Plan at least one volume per node and use a total that is a node-count multiple for even coordinator ownership.`,
      'MS-REC', SRC.planVolumes))
  }

  // ---- Hybrid-specific -----------------------------------------------------
  if (cfg.architecture === 'hybrid') {
    f.push(info('HYBRID_SUPPORTED',
      'Hyperconverged with SAN storage is a supported architecture since Windows Server 2022. The two storage sources coexist but remain separate.',
      'MS', SRC.storageArchitectures))
    f.push(warn('HYBRID_POOL_ISOLATION',
      'SAN LUNs must NEVER be added to the S2D pool. The "SAN not supported" language in the S2D hardware requirements scopes to pool membership, not to the cluster.',
      'MS', SRC.storageArchitectures))
    f.push(warn('HYBRID_FILESYSTEM',
      'SAN-backed CSVs must be NTFS. ReFS is not supported on SAN-backed volumes in this configuration. S2D volumes remain ReFS.',
      'MS', SRC.storageArchitectures))
    f.push(warn('HYBRID_NETWORK',
      'Isolate S2D east-west RDMA replication from the SAN fabric. Heavy SAN I/O must not congest S2D resync traffic.',
      'MS-REC', SRC.storageArchitectures))
    f.push(info('HYBRID_NODE_CEILING',
      `Node ceiling remains ${LIMITS.S2D_MAX_NODES} because S2D is present. Adding SAN does not lift it.`,
      'MS', SRC.s2dOverview))
  }

  // ---- Licensing -----------------------------------------------------------
  if (cores < LIMITS.LICENSE_MIN_CORES_PER_SERVER) {
    f.push(warn('LICENSE_FLOOR',
      `Hosts have ${cores} physical cores but Windows Server Datacenter bills a minimum of ${LIMITS.LICENSE_MIN_CORES_PER_SERVER} cores per server. You pay for ${LIMITS.LICENSE_MIN_CORES_PER_SERVER - cores} unused cores per node.`,
      'MS'))
  }
  if (node.coresPerSocket < LIMITS.LICENSE_MIN_CORES_PER_SOCKET) {
    f.push(warn('LICENSE_SOCKET_FLOOR',
      `${node.coresPerSocket} cores per socket is below the 8-core-per-socket licensing minimum.`, 'MS'))
  }

  // ---- Per-VM checks -------------------------------------------------------
  const spanning = vms.filter(v => v.include && v.vCpu > node.coresPerSocket)
  if (spanning.length > 0) {
    f.push(warn('NUMA_SPANNING',
      `${spanning.length} VM(s) have more vCPUs than one NUMA node has cores (${node.coresPerSocket}). From Windows Server 2025 these will NOT START unless NUMA spanning is explicitly enabled on both host and VM — earlier versions started them with degraded performance.`,
      'MS', SRC.numa))
  }
  const oversizedVCpu = vms.filter(v => v.include && v.vCpu > LIMITS.MAX_VCPU_PER_VM)
  if (oversizedVCpu.length > 0) {
    f.push(err('VM_VCPU_MAX',
      `${oversizedVCpu.length} VM(s) exceed the ${LIMITS.MAX_VCPU_PER_VM} vCPU per-VM maximum.`, 'MS', SRC.maxScale))
  }
  const dbDynamic = Object.values(tiers).find(t => t.id === 'database' && t.allowDynamicMemory)
  if (dbDynamic) {
    f.push(warn('DYNAMIC_MEMORY_DB',
      'Dynamic Memory is enabled on the Database tier. Microsoft advises fixed memory for SQL Server, and Dynamic Memory is mutually exclusive with virtual NUMA — a VM using it has exactly one virtual NUMA node.',
      'MS', SRC.sqlBestPractice))
  }
  const includedVms = vms.filter(v => v.include).length
  if (includedVms > LIMITS.MAX_VMS_PER_CLUSTER) {
    f.push(err('VMS_PER_CLUSTER',
      `${includedVms} VMs exceeds the ${LIMITS.MAX_VMS_PER_CLUSTER} running VMs per cluster maximum.`,
      'MS', SRC.maxScale))
  }

  // ---- Always-on reminders -------------------------------------------------
  f.push(info('LBFO',
    'LBFO NIC teaming is not supported for Hyper-V virtual switch binding from Windows Server 2022 onward. Use Switch Embedded Teaming (SET), maximum 8 adapters.',
    'MS', SRC.removedFeatures))

  return f
}

export function hasErrors(findings: Finding[]): boolean {
  return findings.some(f => f.severity === 'error')
}
