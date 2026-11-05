/** Validation. Errors block a design; warnings annotate it. */
import { LIMITS, RESILIENCY, SRC } from './rules'
import { cacheRatio, rawPerServerTB, usesCacheTier } from './capacity'
import { licensableCores, s2dMetadataRamGiB, totalCores, usableCoresPerHost, usableRamPerHost } from './compute'
import { assessPerformanceData } from './performance'
import { cached } from './solveCache'
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

/** A VM larger than one host. No node count fixes this, because a VM runs on one host at a time. */
export const VM_LARGER_THAN_HOST = 'VM_LARGER_THAN_HOST'

/** Hardware values that make every result meaningless. Names match the labels on the input forms. */
export function hardwareInputProblems(cfg: ClusterConfig): string[] {
  const problems: string[] = []
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'
  const { sockets, coresPerSocket, ramGiB, capacityDrivesPerNode, capacityDriveTB } = cfg.node
  if (!(sockets >= 1)) problems.push('Sockets must be at least 1.')
  if (!(coresPerSocket >= 1)) problems.push('Cores / socket must be at least 1.')
  if (!(ramGiB > 0)) problems.push('RAM per server must be above 0 GiB.')
  if (sockets >= 1 && coresPerSocket >= 1 && usableCoresPerHost(cfg.node, cfg) <= 0) problems.push('The CPU reserve leaves no usable cores on each server.')
  if (ramGiB > 0 && usableRamPerHost(cfg.node, cfg) <= 0) problems.push('The RAM reserve leaves no usable memory on each server.')
  if (usesS2d && (!(capacityDrivesPerNode > 0) || !(capacityDriveTB > 0))) problems.push('S2D needs a capacity drive count and drive size above 0.')
  if ((cfg.architecture === 'san' || cfg.architecture === 'hybrid') && cfg.sanSizingMode !== 'calculated' && !(cfg.san.usableTiB > 0)) problems.push('Array usable capacity must be above 0 TiB.')
  return problems
}

export function validateDesign(
  cfg: ClusterConfig,
  nodes: number,
  vms: Vm[],
  tiers: Record<TierId, TierPolicy>,
  csvPlans: CsvPlan[],
  /** VM count after growth. Defaults to the included VMs. */
  plannedVmCount?: number,
  /** Identifies this VM list inside a solve cache scope, so per-VM checks run once per server size. */
  vmSetKey?: string,
): Finding[] {
  const f: Finding[] = []
  const node = cfg.node
  const usesS2d = cfg.architecture === 's2d' || cfg.architecture === 'hybrid'
  const cores = totalCores(node)
  const performance = vmSetKey === undefined
    ? assessPerformanceData(vms, cfg)
    : cached(() => `perf|${vmSetKey}|${cfg.sizingBasis}`, () => assessPerformanceData(vms, cfg))

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
    if (cfg.resiliency === 'two-way-mirror' && nodes > 2) {
      f.push(warn('TWO_WAY_MIRROR_ABOVE_2_NODES',
        `Two-way mirror tolerates one failure. With ${nodes} servers, Microsoft recommends three-way mirror instead.`,
        'MS-REC', SRC.faultTolerance))
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
    if (usesCacheTier(node) && node.cacheDriveTB * 1000 < LIMITS.MIN_CACHE_DRIVE_GIB) {
      f.push(err('MIN_CACHE_DRIVE_SIZE',
        `Cache drives of ${(node.cacheDriveTB * 1000).toFixed(0)} GB are below the ${LIMITS.MIN_CACHE_DRIVE_GIB} GB minimum for a cache device.`,
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
          'MS-REC', SRC.chooseDrives))
      }
      if (node.capacityDrivesPerNode % node.cacheDrivesPerNode !== 0) {
        f.push(warn('CACHE_BINDING',
          `Capacity drives (${node.capacityDrivesPerNode}) should be a whole multiple of cache drives (${node.cacheDrivesPerNode}) for even cache binding.`,
          'MS-REC', SRC.s2dHardware))
      }
      f.push(info('CACHE_ENDURANCE',
        `Microsoft recommends cache drives with at least ${LIMITS.MIN_CACHE_DWPD} DWPD endurance. Cache contributes zero usable capacity.`,
        'MS-REC', SRC.s2dHardware))
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
  if (usesS2d && cfg.witnessType === 'disk') {
    f.push(err('DISK_WITNESS_ON_S2D',
      'A disk witness is not supported with Storage Spaces Direct. Use a cloud witness or a file share witness.',
      'MS', SRC.quorum))
  }
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
      f.push(p.domain === 's2d'
        ? warn('CSV_SIZE',
          `${p.tier} S2D volumes at ${p.sizeTiB.toFixed(1)} TiB exceed Microsoft's recommended ${LIMITS.MAX_CSV_SIZE_TIB} TB volume limit, which Surveyor applies as TiB.`,
          'MS-REC', SRC.planVolumes)
        : warn('CSV_SIZE',
          `${p.tier} SAN CSVs at ${p.sizeTiB.toFixed(1)} TiB, including free space, exceed the ${LIMITS.MAX_CSV_SIZE_TIB} TiB planning cap. This is a Surveyor assumption; check the array vendor's limits.`,
          'TOOL'))
    }
    if (cfg.backupMethod === 'vss-volsnap' && p.sizeTiB > LIMITS.VSS_CSV_LIMIT_TIB) {
      f.push(warn('CSV_VSS_SIZE',
        `${p.tier} CSVs at ${p.sizeTiB.toFixed(1)} TiB exceed the ${LIMITS.VSS_CSV_LIMIT_TIB} TB Microsoft suggests for reliable VSS/volsnap-based backup, which Surveyor applies as TiB.`,
        'MS-REC', SRC.planVolumes))
    }
  }
  const s2dCsvs = csvPlans.filter((plan) => plan.domain === 's2d').reduce((sum, plan) => sum + plan.count, 0)
  if (s2dCsvs > 0 && s2dCsvs < nodes) {
    f.push(warn('CSV_NODE_FLOOR',
      `The S2D domain has ${s2dCsvs} volumes across ${nodes} nodes. Plan at least one volume per node so coordinator ownership can distribute across the cluster.`,
      'MS-REC', SRC.planVolumes))
  }
  const sanPlans = csvPlans.filter((plan) => plan.domain === 'san')
  const sanCsvs = sanPlans.reduce((sum, plan) => sum + plan.count, 0)
  const granularSanAlternative = sanPlans.reduce((sum, plan) => sum + plan.granularAdvisoryCount, 0)
  if (cfg.architecture === 'san' && (cfg.sanCsvLayoutMode ?? 'balanced') === 'custom' && sanCsvs < nodes) {
    f.push(warn('SAN_CUSTOM_NODE_FLOOR',
      `The custom SAN target produces ${sanCsvs} CSV/LUNs across ${nodes} nodes. Microsoft recommends at least one CSV per node; keep the override only with a documented operational reason.`,
      'MS-REC', SRC.csv))
  }
  if ((cfg.sanCsvLayoutMode ?? 'balanced') === 'custom' && sanCsvs > Math.max(1, Math.round(cfg.sanCustomCsvCount ?? 1))) {
    f.push(warn('SAN_CUSTOM_RAISED',
      `The requested SAN total was raised to ${sanCsvs} CSV/LUNs because the capacity and backup size limits require more storage objects.`,
      'MS', SRC.csv))
  }
  if (sanPlans.length > 0 && !(sanPlans[0].recoveryGroupingApplied) && granularSanAlternative > sanCsvs) {
    f.push(info('SAN_GRANULAR_ALTERNATIVE',
      `The selected SAN layout uses ${sanCsvs} CSV/LUNs. Enforcing the editable tier recovery targets would use ${granularSanAlternative}; that alternative remains available under Refine assumptions.`,
      'TOOL'))
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
  const licensable = licensableCores(node)
  if (cores < licensable) {
    f.push(warn('LICENSE_FLOOR',
      `Hosts have ${cores} physical cores, but Windows Server Datacenter bills at least ${LIMITS.LICENSE_MIN_CORES_PER_SOCKET} cores per socket and ${LIMITS.LICENSE_MIN_CORES_PER_SERVER} per server, so each host is licensed for ${licensable}. You pay for ${licensable - cores} unused cores per node.`,
      'MS'))
  }
  if (node.coresPerSocket < LIMITS.LICENSE_MIN_CORES_PER_SOCKET) {
    f.push(warn('LICENSE_SOCKET_FLOOR',
      `${node.coresPerSocket} cores per socket is below the 8-core-per-socket licensing minimum.`, 'MS'))
  }

  // ---- Host limit ----------------------------------------------------------
  const logicalProcessors = cores * cfg.smtFactor
  if (logicalProcessors > LIMITS.MAX_LOGICAL_PROCESSORS) {
    f.push(err('HOST_LOGICAL_PROCESSORS',
      `Hosts have ${logicalProcessors.toLocaleString()} logical processors, above the ${LIMITS.MAX_LOGICAL_PROCESSORS.toLocaleString()} Hyper-V supports per host.`,
      'MS', SRC.maxScale))
  }

  // ---- Per-VM checks -------------------------------------------------------
  // A VM runs on one host, so demand adding up across hosts does not make it placeable. This uses
  // the allocation: a VM needs its configured vCPU and memory to start, whatever its P95 is.
  const hostRamGiB = usableRamPerHost(node, cfg)
  f.push(...(vmSetKey === undefined
    ? perVmFindings(vms, node, logicalProcessors, hostRamGiB)
    : cached(() => `vmfit|${vmSetKey}|${logicalProcessors}|${hostRamGiB}|${node.coresPerSocket}`, () => perVmFindings(vms, node, logicalProcessors, hostRamGiB))))
  const dbDynamic = Object.values(tiers).find(t => t.id === 'database' && t.allowDynamicMemory)
  if (dbDynamic) {
    f.push(warn('DYNAMIC_MEMORY_DB',
      'Dynamic Memory is enabled on the Database tier. Surveyor assumes fixed memory for databases, because Dynamic Memory and virtual NUMA cannot be used together: a VM with Dynamic Memory has one virtual NUMA node.',
      'TOOL', SRC.numa))
  }
  const includedVms = plannedVmCount ?? vms.filter(v => v.include).length
  if (includedVms > LIMITS.MAX_VMS_PER_CLUSTER) {
    f.push(err('VMS_PER_CLUSTER',
      `${includedVms} VMs exceeds the ${LIMITS.MAX_VMS_PER_CLUSTER} running VMs per cluster maximum.`,
      'MS', SRC.maxScale))
  }
  const workloadNodes = nodes - cfg.spareNodes
  if (workloadNodes > 0 && includedVms / workloadNodes > LIMITS.MAX_VMS_PER_HOST) {
    f.push(err('VMS_PER_HOST',
      `${includedVms} VMs across ${workloadNodes} workload hosts is above the ${LIMITS.MAX_VMS_PER_HOST} running VMs per host maximum.`,
      'MS', SRC.maxScale))
  }

  // ---- Always-on reminders -------------------------------------------------
  f.push(info('LBFO',
    'LBFO NIC teaming is not supported for Hyper-V virtual switch binding from Windows Server 2022 onward. Use Switch Embedded Teaming (SET), maximum 8 adapters.',
    'MS', SRC.removedFeatures))

  return f
}

/** Checks that depend only on the VMs and the server size, not on storage or node count. */
function perVmFindings(vms: Vm[], node: ClusterConfig['node'], logicalProcessors: number, hostRamGiB: number): Finding[] {
  const f: Finding[] = []
  const hostLoad = (vm: Vm) => Math.max(logicalProcessors > 0 ? vm.vCpu / logicalProcessors : Infinity, hostRamGiB > 0 ? vm.ramGiB / hostRamGiB : Infinity)
  const tooLarge = vms.filter((vm) => vm.include && (vm.vCpu > logicalProcessors || vm.ramGiB > hostRamGiB))
  if (tooLarge.length > 0) {
    const largest = tooLarge.reduce((a, b) => (hostLoad(b) > hostLoad(a) ? b : a))
    f.push(err(VM_LARGER_THAN_HOST,
      `${tooLarge.length} VM(s) cannot fit on a single host. The largest is ${largest.name} (${largest.vCpu} vCPU, ${largest.ramGiB.toFixed(0)} GiB) against ${logicalProcessors.toFixed(0)} cores and ${hostRamGiB.toFixed(0)} GiB of usable RAM per host. Adding hosts does not help: use a larger server or resize the VM.`,
      'TOOL'))
  }
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
  const oversizedRam = vms.filter(v => v.include && v.ramGiB > LIMITS.MAX_RAM_PER_VM_GIB)
  if (oversizedRam.length > 0) {
    f.push(err('VM_RAM_MAX',
      `${oversizedRam.length} VM(s) exceed the ${LIMITS.MAX_RAM_PER_VM_GIB / 1024} TB per-VM memory maximum.`, 'MS', SRC.maxScale))
  }
  // Disk layout is rarely known in full, so an average above the limit is a warning to check.
  const oversizedDisk = vms.filter(v => v.include
    && Math.max(v.provisionedGiB, v.storageGiB) / Math.max(1, v.diskCount ?? 1) > LIMITS.MAX_VHDX_TIB * 1024)
  if (oversizedDisk.length > 0) {
    f.push(warn('VHDX_MAX',
      `${oversizedDisk.length} VM(s) average more than the ${LIMITS.MAX_VHDX_TIB} TB VHDX maximum per disk. Split them across more virtual disks.`, 'MS', SRC.maxScale))
  }
  // A BIOS VM is Generation 1 unless it is converted to UEFI, so this is a warning and not a block.
  const overGen1 = vms.filter(v => v.include && v.firmware === 'bios'
    && (v.vCpu > LIMITS.MAX_VCPU_PER_GEN1_VM || v.ramGiB > LIMITS.MAX_RAM_PER_GEN1_VM_GIB))
  if (overGen1.length > 0) {
    f.push(warn('VM_GEN1_LIMIT',
      `${overGen1.length} BIOS VM(s) exceed the Generation 1 maximum of ${LIMITS.MAX_VCPU_PER_GEN1_VM} vCPU and 1 TB. Convert them to UEFI and Generation 2, or reduce them.`, 'MS', SRC.maxScale))
  }
  return f
}

export function hasErrors(findings: Finding[]): boolean {
  return findings.some(f => f.severity === 'error')
}
