# Hyper-V Surveyor — Sizing Engine Specification

**Version 0.1 · 17 August 2026 · For review before build starts**

The companion to the Azure Local Surveyor, for Windows Server 2025 Hyper-V. Client-side React,
no backend, embeddable in the existing Docusaurus site.

Every rule below is tagged:

- **[MS]** — Microsoft-documented hard rule. The engine enforces it and refuses invalid designs.
- **[MS-REC]** — Microsoft recommendation. The engine defaults to it and warns if overridden.
- **[TOOL]** — our assumption. No vendor publishes it. Exposed in the UI as an editable default with the reasoning shown.

Anything **[TOOL]** must be visibly labelled in the output. An SE handing a customer a number that
looks like vendor guidance but isn't will get caught, once, expensively.

---

## 1. What the tool answers

Two directions, one engine:

| Mode | Given | Solve for |
|---|---|---|
| **Forward** | A workload inventory | Minimum node count and node spec, per storage architecture |
| **Reverse** | A fixed set of hardware | How much workload fits, and **which constraint binds first** |

The headline output of Forward mode is deliberately plural:

> 400 VMs → **8 nodes on Pure SAN** · **11 nodes on S2D (3-way mirror)** · **9 nodes on S2D (mirror-accelerated parity)** · **8 nodes hybrid**

Different answers because **on SAN, node count is driven only by compute. On S2D, node count is
driven by compute *and* capacity simultaneously** — every node you add is also storage. That single
insight is the reason this tool exists rather than a spreadsheet.

---

## 2. Workload model

### 2.1 Input paths — all three, and they compose

1. **RVTools import** (`.xlsx`)
2. **Manual entry** — add a VM or a bulk row ("120 × 4 vCPU / 16 GB / 200 GB")
3. **Edit after import** — every imported VM is fully editable, and rows can be added or deleted post-import

These are not separate flows. Import populates a grid; the grid is always editable; manual rows and
imported rows are the same object.

### 2.2 The RVTools problem, stated plainly

**RVTools contains no historical utilisation data.** `vInfo`, `vCPU` and `vMemory` are *allocation*
only. The `CPU Usage %` and `Memory Usage %` columns on `vHost` are a point-in-time snapshot at the
moment RVTools connected to vCenter, and the tool must not treat them as an average.

Consequence: **a pure RVTools import can only size on allocation, which oversizes** — often by a lot,
because VMware estates are typically over-provisioned at the vCPU level.

The engine handles this with an explicit, visible **Right-Sizing Factor** per workload tier
**[TOOL]**, defaulted to 1.0 (size on allocation, conservative) with presets the SE can apply, and a
banner stating that the factor is an assumption until real utilisation data is supplied. The tool
should also accept a **Live Optics** or **Aria Operations** export as an optional second file to
replace the assumption with measured percentile data — Live Optics does collect time-series
utilisation, RVTools does not.

### 2.3 Parser rules

| Item | Rule |
|---|---|
| Tabs consumed | `vInfo` (primary), `vCPU`, `vMemory`, `vPartition`, `vDisk`, `vHost`, `vDatastore` |
| Units | Base-2 throughout. **Column headers changed from `MB` to `MiB` in RVTools 4.1.2** — the parser must accept both spellings |
| Exclude | `Template = TRUE`, `SRM Placeholder = TRUE` |
| Exclude by pattern | vCLS VMs — no flag column exists, match on name prefix `vCLS` |
| Powered-off VMs | Import, flag, and default to **excluded from sizing but shown in a separate count**. SE toggles per-VM |
| Real storage | Prefer `vPartition.Consumed MiB` (in-guest actual). Fall back to `vInfo.In Use MiB`. Show `Provisioned MiB` alongside so the thin-provisioning gap is visible |
| Thick detection | `Provisioned ≈ In Use` implies thick or fully-written thin |
| Row cap | Warn above 20,000 VM rows |

Current RVTools is **4.8.1**, owned by **Dell** since 2023. Exact column headers for `vDisk`,
`vCluster` and `vDatastore` could not be verified from an authoritative public source — **the parser
must be written against a real 4.8.x export**, not from documentation. Treat this as a build
prerequisite, not a detail.

### 2.4 Workload tiers

The 90/10 split described is the normal case, so tiering is core, not optional.

| Tier | vCPU:pCore **[TOOL]** | Memory | Storage placement | Notes |
|---|---|---|---|---|
| **General Server** | 4:1 | Dynamic Memory permitted | Capacity tier | The 90% |
| **Database / Heavy** | **1:1** | **Fixed, never Dynamic** | Performance tier | SQL, Oracle, SAP. Microsoft explicitly says do not use Dynamic Memory for SQL |
| **VDI** | 8:1 | Dynamic Memory | Capacity tier | |
| **Infrastructure** | 6:1 | Dynamic Memory | Capacity tier | DC, DNS, print, jump hosts |
| **Custom** | user | user | user | |

**Microsoft publishes no vCPU:pCore ratio.** The WS2025 maximums table states outright: *"Virtual
processors per logical processor — No ratio imposed by Hyper-V."* Azure Stack Hub's documentation
says Microsoft deliberately declines to give one. Every ratio above is **[TOOL]**, derived from
vendor and field consensus (Dell's own guidance is more conservative still, at 2:1). The UI must say
so where the ratio is displayed.

**Auto-classification** on import, all overridable: guest OS string, VM name matching
(`SQL|ORA|DB|MSSQL|POSTGRES`), vCPU ≥ 8, RAM ≥ 64 GB, or provisioned storage ≥ 2 TB promotes a VM out
of General Server and flags it for SE review. Auto-classification is a starting point that must be
reviewed, and the UI should say that too.

---

## 3. Compute sizing

### 3.1 CPU

```
required_pcores(tier) = Σ(vCPU × right_sizing_factor) ÷ oversubscription_ratio(tier)
required_pcores_total = Σ over tiers
```

Hyperthreading: Microsoft's maximums count **logical processors**, not physical cores. The engine
works in **physical cores** and exposes an SMT factor **[TOOL]**, defaulted to **1.0 — i.e. no credit
for hyperthreading**. Rationale shown in the UI: the **core scheduler is the default since Windows
Server 2019** and remains so in WS2025; it schedules VP pairs onto SMT sibling pairs so a physical
core is never shared between two VMs, which is a security boundary but reduces the effective
oversubscription headroom hyperthreading appears to offer. Taking SMT credit on top of a 4:1 ratio
double-counts. SEs who want it can raise the factor deliberately.

Host reserve: **Microsoft publishes no CPU reserve figure** for the root partition — it is calculated
dynamically. The engine reserves **1 physical core or 4%, whichever is greater [TOOL]**.

### 3.2 Memory

```
required_ram(tier)  = Σ(vRAM × right_sizing_factor)
usable_ram_per_host = installed_ram − host_reserve
```

Host reserve **[TOOL]**: the closest official anchor is Azure Stack Hub's published constant of
**15% of host memory**, which is Azure Stack Hub-specific rather than general Hyper-V guidance. The
engine defaults to **max(32 GB, 12%)** and cites the Azure Stack Hub figure as the reference point.

Additional reserve for S2D **[MS]**: **4 GB of host RAM per 1 TB of cache-drive capacity per server**,
for storage pool metadata. This is a real, documented requirement and is added on top for S2D and
hybrid designs. It is routinely forgotten and can be tens of gigabytes per node.

**Memory is never oversubscribed by default.** Microsoft's own hyperconverged platform, Azure Stack
Hub, permits CPU overcommit and explicitly forbids memory overcommit. Dynamic Memory is available as
a per-tier opt-in, blocked for the Database tier.

**NUMA — new behaviour in WS2025 [MS]:** a VM needing more virtual cores than one physical NUMA node
provides **will not start** unless NUMA spanning is explicitly enabled on both host and VM. Earlier
versions started it with degraded performance. The engine must flag every VM whose vCPU count exceeds
`cores_per_socket` and emit a "requires NUMA spanning" warning. Also **[MS]**: Dynamic Memory and
virtual NUMA are mutually exclusive — a VM with Dynamic Memory has exactly one virtual NUMA node.

### 3.3 N+1 and the utilisation ceiling

```
workload_hosts   = N − spare_nodes
max_utilisation  = (N − spare) ÷ N
```

| N | N+1 ceiling | Wasted | N+2 ceiling | Wasted |
|---|---|---|---|---|
| 4 | 75.0% | 25.0% | 50.0% | 50.0% |
| 6 | 83.3% | 16.7% | 66.7% | 33.3% |
| 8 | 87.5% | 12.5% | 75.0% | 25.0% |
| 12 | 91.7% | 8.3% | 83.3% | 16.7% |
| 16 | 93.8% | 6.3% | 87.5% | 12.5% |

The rule the engine enforces: **the surviving N−1 nodes must run 100% of the workload**, not merely
boot it. Microsoft publishes no general N+1 guidance for Failover Clustering, but SCVMM's
`Set-SCVMHostCluster -ClusterReserve` implements exactly this arithmetic and its documentation
confirms the semantics.

**N+2 should be the service-provider default [TOOL]**, not N+1 — because patching a node and losing a node
must be survivable concurrently, and Microsoft's own Azure Local guidance notes that cluster
resiliency is temporarily reduced while nodes are drained and restarted one by one. The tool defaults
to N+2 with a visible explanation and allows N+1.

### 3.4 The node-count tension the tool must surface

Two forces pull in opposite directions and neither vendor reconciles them:

- **More, smaller nodes** shrink the N+1 overhead percentage (25% at 4 nodes → 6.3% at 16), and on
  S2D also improve parity efficiency (50% at 4 nodes → 80% at 16 all-flash).
- **Fewer, denser nodes** reduce Windows Server licensing waste, because **every host costs a
  minimum 16 cores of Datacenter licensing whether or not it has 16 cores [MS]**.

The engine must **compute and display both curves** and let the SE choose, rather than silently
picking. The recommended node count should be presented with the licensing cost and the resiliency
overhead side by side. This connects directly to the Cost Model in the comparison workbook.

---

## 4. Storage architecture

Three modes. All three are supported Microsoft patterns.

### 4.1 SAN (Pure / Everpure FlashArray)

Note: **Pure Storage renamed itself Everpure in February 2026.** The FlashArray product names are
unchanged. Microsoft's Azure Local supported-SAN list refers to "Everpure."

Node count is driven **entirely by compute**. Array capacity is an independent input.

| Input | Rule |
|---|---|
| Capacity basis | **Usable capacity**, never "effective" |
| Data reduction | Default **2.5:1 [TOOL]**, conservative against Pure's blended 5:1 marketing average |
| Thin provisioning | Modelled **separately** from data reduction, never folded in |

**The DRR trap, encoded as a hard rule.** Pure's datasheets claim "5-to-1 average data reduction"
(dedupe + compression + pattern removal) and separately "up to 10:1 when including thin
provisioning." **The 10:1 figure is not data reduction** — it counts allocated-but-unwritten space,
which evaporates the moment guests fill their thin volumes. Everpure's own blog criticises this exact
conflation in the industry. The engine will not accept a DRR above 5:1 without an explicit
acknowledgement, and never applies thin-provisioning savings as a reduction multiplier.

Pure publishes no workload-segmented DRR table. Any per-tier ratio is **[TOOL]**.

Connectivity **[MS/vendor]**: **Fibre Channel and iSCSI only** for production Hyper-V today. **NVMe-oF
is preview-only on the Windows Server initiator side** — it requires an Insider build, needs the NVMe
admin queue size manually set to 32, and **has no multipathing yet**. The tool must not offer NVMe-TCP
as a production option.

**ODX is supported and on by default** (WS2012+ / Purity 4.10+). Array-internal token-based copy: Pure
documents 1.25 TB copied in 29 seconds with no measurable front-end impact. The tool should note that
VM deployment, cloning and storage migration on Pure should **not** be modelled against
network-copy throughput.

### 4.2 S2D

Node count is driven by **compute and capacity together**. This is the mode where the two constraints
fight, and the tool must say which one won.

**Cluster ceiling [MS]: 2–16 nodes.** Not 64. The 64-node figure is the general Failover Clustering
maximum and does not apply once S2D is enabled. A design needing more than 16 nodes of S2D needs
multiple clusters, and the tool must say so rather than quietly producing an invalid answer.

**Minimum capacity drives per server [MS]** (Windows Server, excluding boot):

| Configuration | Minimum |
|---|---|
| All-NVMe or All-SSD, no cache | 4 capacity |
| NVMe cache + SSD capacity | 2 cache + 4 capacity |
| NVMe cache + HDD capacity | 2 cache + 4 capacity |
| SSD cache + HDD capacity | 2 cache + 4 capacity |
| HDD only | **Not supported** |

Cache **[MS/MS-REC]**: mandatory with HDD capacity, optional all-flash. Minimum 2 cache drives per
server. Minimum cache device size 32 GB. Cache:capacity starting ratio **10% hybrid / 5% all-flash**
(Windows Server recommendation) — note **Azure Local imposes a hard ≥15% floor** for hybrid, which is
stricter. Cache endurance **≥3 DWPD**. Capacity-drive count should be a whole multiple of cache-drive
count. **Cache contributes zero usable capacity.**

Symmetry **[MS]**: same drive *types* and same *count* of each type in every server is required.
Same models and sizes are recommended, not required.

**Storage efficiency — the table the engine indexes on.** Two tables, because dual-parity efficiency
diverges by media type above 8 nodes:

| Resiliency | Efficiency | Min nodes | Tolerates |
|---|---|---|---|
| Two-way mirror | 50.0% | 2 | 1 failure |
| Three-way mirror | 33.3% | 3 | 2 failures |
| Nested two-way mirror | 25.0% | 2 only | 2 failures |
| Nested mirror-accelerated parity | 35.3–40.0% | 2 only | 2 failures |
| Dual parity | 50.0–80.0% | 4 | 2 failures |

Dual parity by node count:

| Nodes | Hybrid | All-flash |
|---|---|---|
| 4–6 | 50.0% (RS 2+2) | 50.0% (RS 2+2) |
| 7–8 | 66.7% (RS 4+2) | 66.7% (RS 4+2) |
| 9–11 | 66.7% (RS 4+2) | **75.0% (RS 6+2)** |
| 12–15 | 72.7% (LRC 8,2,1) | 75.0% (RS 6+2) |
| 16 | 72.7% (LRC 8,2,1) | **80.0% (LRC 12,2,1)** |

Nested MAP efficiency at 2 nodes varies with capacity-drive count and mirror ratio — 35.7% at 4
drives/10% mirror rising to 40.0% at 7+ drives/10% mirror. The engine carries the full lookup.

**Reserve capacity [MS-REC]:**

```
reserve = MIN(capacity_drive_size × node_count, capacity_drive_size × 4)
```

One capacity drive per server, **capped at 4 drives' worth total regardless of cluster size**. A
16-node cluster still reserves only 4 drives. For mixed capacity tiers, computed per drive type with
the cap applied to each. Delimited volume allocation is the exception — reserve one drive per server
with **no cap**.

**Usable capacity chain:**

```
1. raw_per_server = capacity_drives × drive_size          (cache excluded entirely)
2. raw_pool       = Σ raw_per_server                      (≤ 400 TB/server, ≤ 4 PB/pool)
3. available      = raw_pool − reserve
4. usable         = available × efficiency(resiliency, nodes, media)
```

Microsoft publishes **no filesystem-overhead percentage** beyond this. The engine does not invent one.

Also **[MS]**: **no Microsoft sizing tool exists for plain Windows Server S2D.** The only official
sizer covers Azure Local. This tool fills a genuine gap.

**New in WS2025 [MS]:** S2D campus clusters — two-rack, same-site, ≤1 ms latency, symmetric, **max 10
nodes (5+5)**, Rack Level Nested Mirror, flash-only recommended. Requires the Dec 2025 cumulative
update. Worth modelling as a topology option.

### 4.3 Hybrid — S2D **and** SAN in one cluster

**This is a first-class supported architecture, not a workaround.** Microsoft calls it
**"Hyperconverged with SAN storage"** and has supported it since Windows Server 2022:

> *"Starting with Windows Server 2022, you can combine hyperconverged Storage Spaces Direct with
> external SAN storage in the same failover cluster... The two storage sources coexist but remain
> separate."*

The confusion this resolves is worth stating explicitly, because it trips up experienced people: the
"SAN storage is NOT SUPPORTED" language in the S2D hardware requirements is a constraint on **what
may enter the S2D pool**, not on what the cluster may contain. Two different scopes.

**Hard rules [MS]:**

| Rule | Detail |
|---|---|
| Pool isolation | **SAN LUNs must never be added to the S2D pool.** Managed independently |
| Filesystem split | S2D CSVs are **ReFS**. SAN CSVs are **NTFS** — ReFS is not supported on SAN-backed volumes |
| Presentation | LUNs presented identically to every node; MPIO configured consistently |
| Node ceiling | **16 nodes**, because S2D is present. The SAN side does not lift this |
| Network | Isolate S2D east-west RDMA replication from SAN fabric traffic. Heavy SAN I/O must not congest S2D resync |

**Legitimate reasons to choose it**, which the tool should offer as presets:

1. **Performance tiering** — local NVMe S2D for hot data, Pure //C for bulk
2. **Phased migration** — production stays on SAN CSVs while S2D CSVs are built alongside, workloads moved by Storage Live Migration at will. Microsoft frames this as a documented benefit, and imposes no time limit; coexistence is a legitimate steady state, not a transitional hack
3. **Sunk investment** — existing Pure capacity has life left, new capacity goes local
4. **Feature split** — NTFS-dependent workloads on SAN, ReFS block-clone-dependent workloads on S2D

For Azure Local specifically this is **billing tier L2** — a real cost consequence the tool should
flag if Azure Local is ever added as a target.

The engine models hybrid as **one cluster with two independent storage domains**, sized separately,
sharing one compute pool. Not as two clusters — that would produce wrong node-count and licensing
maths, since Windows Server Datacenter is licensed per node regardless of how many storage domains
that node touches.

---

## 5. CSV and LUN design

The part most sizing tools skip, and the part that determines whether the design survives contact
with a restore.

### 5.1 Universal rules — apply to S2D and SAN alike

| Rule | Value | Tag |
|---|---|---|
| Minimum CSVs | **≥ 1 per node** — distributes coordinator ownership | [MS-REC] |
| Count shape | **Total CSVs should be a whole multiple of node count** — otherwise ownership distributes unevenly and performance is inconsistent | [MS-REC] |
| Maximum CSVs | **64 per cluster** | [MS-REC] |
| Maximum CSV size | **64 TB** | [MS-REC] |
| VSS/volsnap-based backup | **Limit to 10 TB** | [MS] |
| Hyper-V RCT / ReFS block clone / native SQL backup | Performs well at **32 TB and beyond** | [MS] |
| VMs per CSV | **Microsoft imposes no limit** — explicitly stated | [MS] |
| CSV cache | Up to **80% of host RAM** allocatable (WS2012 R2+). Valuable for read-heavy, e.g. pooled VDI | [MS] |

Microsoft's own worked example: *"if you have 4 servers, you will experience more consistent
performance with 4 total volumes than with 3 or 5."*

### 5.2 The blast-radius principle

Since Microsoft imposes no VMs-per-CSV limit, the real constraint is **recovery granularity**, and it
differs fundamentally between the two storage types.

**On SAN, the LUN is the restore unit.** A Pure array snapshot operates at whole-volume level. Put 60
VMs on one LUN and restoring one VM means mounting a 60-VM snapshot. Pure's own stated design
philosophy is to **align CSV boundaries to snapshot and recovery granularity** — isolate workloads
rather than consolidating onto one large volume. CSV maps 1:1 to a FlashArray volume.

**On S2D, the volume is the resiliency unit.** Restore granularity comes from the backup product, not
the array, so the driver is different: resiliency tiering (mirror vs parity), rebuild time, and
ownership distribution.

The engine therefore takes a **blast-radius input per tier [TOOL]** — maximum VMs and maximum TB an
SE is willing to have inside one restore unit — and treats it as a first-class constraint alongside
capacity.

### 5.3 The algorithm

Run **per tier, per storage domain**:

```
max_csv_size = MIN(
    64 TB,                                    # [MS-REC] hard recommendation
    10 TB  if backup_method == VSS_volsnap,   # [MS]
    blast_radius_tb                           # [TOOL] SE input
)

count_by_capacity = ceil(tier_capacity / max_csv_size)
count_by_blast    = ceil(tier_vm_count / max_vms_per_csv)     # [TOOL]
count_by_nodes    = node_count                                 # [MS-REC] ≥1 per node

csv_count = MAX(count_by_capacity, count_by_blast, count_by_nodes)
csv_count = round_up_to_multiple_of(csv_count, node_count)     # [MS-REC]

if total_csvs_across_all_tiers > 64:          # [MS-REC]
    → raise CSV size, raise blast radius, or split the cluster. Do not silently exceed.

csv_size = round_up(tier_capacity / csv_count, 1 TB)
```

### 5.4 Defaults

| Parameter | Default | Basis |
|---|---|---|
| `max_vms_per_csv` — General Server | **25** | **[TOOL]** — Microsoft states no limit; Pure publishes none publicly |
| `max_vms_per_csv` — Database / Heavy | **5** | **[TOOL]** — I/O isolation and restore granularity |
| `max_vms_per_csv` — VDI | **50** | **[TOOL]** — homogeneous, low restore value, CSV cache benefits from consolidation |
| `blast_radius_tb` — General | **16 TB** | **[TOOL]** |
| `blast_radius_tb` — Database | **8 TB** | **[TOOL]** |
| `max_csv_size` default | **32 TB**, or **10 TB** if VSS-based backup | 32 TB is Microsoft's stated comfortable ceiling for RCT/ReFS/SQL-native backup; 10 TB is the documented VSS limit |

**Every one of the VMs-per-CSV figures is ours.** Microsoft explicitly imposes no limit and Pure's
specific guidance sits behind a login-walled support portal that could not be retrieved. These
defaults are defensible field practice, not vendor guidance, and the UI must label them as such.
See §9.

### 5.5 Worked example — the 400-VM case

400 VMs, 90% General Server / 10% Database. General tier 320 VMs / 480 TB. Database tier 40 VMs /
120 TB. Backup is Hyper-V RCT (not VSS-volsnap), so the 10 TB cap does not apply.

**SAN, 8 nodes:**

| Tier | Driver | Count | Size |
|---|---|---|---|
| General | capacity 480/32 = 15; blast 320/25 = 13; nodes 8 → max 15 → round to 16 | **16 CSVs** | 30 TB each |
| Database | capacity 120/32 = 4; blast 40/5 = 8; nodes 8 → max 8 | **8 CSVs** | 15 TB each |
| | | **24 total** | Under 64 ✓ |

Database is **blast-radius-bound**, not capacity-bound — 8 LUNs where capacity alone would have said
4. That is the tool earning its keep: a 4-LUN design would put 10 database VMs in each restore unit.

**S2D, 12 nodes, mirror-accelerated parity for General and three-way mirror for Database:**

| Tier | Driver | Count | Size |
|---|---|---|---|
| General | capacity 15; blast 13; nodes 12 → max 15 → round to **24** (multiple of 12) | **24 volumes** | 20 TB each |
| Database | capacity 4; blast 8; nodes 12 → max 12 | **12 volumes** | 10 TB each |
| | | **36 total** | Under 64 ✓ |

The multiple-of-node-count rule pushes General from 15 to 24. The tool should show that jump and its
reason, because an SE will otherwise assume it is a bug.

---

## 6. The solve

### 6.1 Forward

For each storage architecture independently, find minimum N satisfying all of:

```
workload_hosts = N − spare

CPU      Σ required_pcores ≤ workload_hosts × usable_cores_per_host
RAM      Σ required_ram    ≤ workload_hosts × usable_ram_per_host
Storage  S2D:    usable_capacity(N, resiliency, drives, media) ≥ required_capacity
         SAN:    array_usable × DRR ≥ required_capacity          (independent of N)
         Hybrid: both domains satisfied independently
Ceiling  N ≤ 16 if S2D present, else N ≤ 64
CSV      total CSVs ≤ 64
```

Because S2D capacity is a function of N, the solve iterates N upward and re-evaluates capacity each
step. SAN does not.

**Every result must name the binding constraint.** "10 nodes — storage-bound: three-way mirror at
33.3% efficiency requires 3× raw. Compute alone would need 7." That sentence is the product.

### 6.2 Reverse

Fix N and the node spec. Compute headroom against each constraint, report the smallest, and express
capacity as "how many more VMs of profile X fit" — because that is the question an SE is actually
asked mid-call.

### 6.3 Always-on comparison

Every Forward result renders as a table across all viable architectures, so the trade is visible:

| Architecture | Nodes | Binding constraint | Usable capacity | CSVs | WS Datacenter cost | N+2 overhead |
|---|---|---|---|---|---|---|
| Pure SAN | 8 | Compute (RAM) | array | 24 | $ | 25.0% |
| S2D 3-way mirror | 12 | Storage | x TB | 36 | $ | 16.7% |
| S2D MAP | 9 | Storage | x TB | 27 | $ | 22.2% |
| Hybrid | 8 | Compute (RAM) | both | 28 | $ | 25.0% |

Licensing cost links to the model already built in
`HyperV_Management_Plane_Comparison.xlsx`, so the two tools agree on price.

---

## 7. Validation and warnings

The engine emits, at minimum:

- S2D requested above 16 nodes → **error**, propose multiple clusters
- Fewer than 4 capacity drives per server → **error [MS]**
- HDD-only configuration → **error [MS]**
- Cache below 10% (or 15% for Azure Local) → **warning**
- Three-way mirror below 3 nodes, dual parity or MAP below 4 nodes → **error [MS]**
- 2-node cluster without a witness → **error [MS]** — a witness is functionally mandatory
- 3–4 node cluster without a witness → **warning [MS-REC]**; 5+ nodes → witness adds nothing
- S2D cluster: dynamic quorum tolerates a maximum of **2 simultaneous node failures regardless of node count [MS]**
- Any VM with vCPU > cores per socket → **"requires NUMA spanning" [MS]**, WS2025 will not start it otherwise
- Dynamic Memory on a Database-tier VM → **warning**, Microsoft advises against for SQL
- Dynamic Memory + multi-NUMA VM → **error [MS]**, mutually exclusive
- Total CSVs > 64 → **warning [MS-REC]**
- Any CSV > 64 TB, or > 10 TB with VSS backup → **warning [MS]**
- CSV count not a multiple of node count → **warning [MS-REC]**
- Hybrid: reminder that SAN CSVs must be NTFS and must never enter the S2D pool
- LBFO teaming selected → **error [MS]**, unsupported for vSwitch since WS2022. SET only
- SET team above 8 adapters → **error [MS]**
- Node RAM below the S2D metadata requirement (4 GB per TB of cache) → **error [MS]**
- Hosts under 16 cores → **licensing warning**, you pay for 16 regardless

---

## 8. Build order

| Phase | Deliverable | Depends on |
|---|---|---|
| 0 | Rule tables as data (efficiency, minimums, limits) with source URLs beside each value | — |
| 1 | **Engine as a pure TypeScript module with unit tests. No React.** | 0 |
| 2 | Manual workload entry + tier editor + results | 1 |
| 3 | RVTools parser | Real 4.8.x file |
| 4 | Storage designer: S2D / SAN / hybrid, CSV layout output | 1 |
| 5 | Reverse mode | 1 |
| 6 | Outputs: BOM, CSV plan, licensing cost, XLSX + print | 2–5 |
| 7 | URL state serialisation, Docusaurus embed, styling to match Surveyor | 6 |

Phase 1 first and standalone. Sizing maths that cannot be tested independently of the UI is maths
nobody will trust the first time a customer disputes it — and they will. Every rule in §4 and §5 gets
a test case with the Microsoft citation in the test name.

---

## 9. Open items — resolve before Phase 4

| # | Item | Why it matters | How to close |
|---|---|---|---|
| 1 | Pure's actual Hyper-V CSV guidance — VMs per CSV, recommended LUN size | Our §5.4 defaults are **[TOOL]** placeholders | Someone with a Pure/Everpure support portal login pulls *Hyper-V Best Practices for FlashArray* and *Considerations for Deploying Hyper-V Hosts Using FlashArray*. Blocked to automated retrieval by robots.txt |
| 2 | Pure MPIO queue-depth values for Windows | Affects performance guidance in output | Same portal |
| 3 | Pure sector size (512e vs 4K) and NTFS vs ReFS recommendation | Hybrid mode forces NTFS on SAN CSVs anyway, but pure-SAN designs have a choice | Same portal |
| 4 | Pure **usable** capacity per model | Datasheets publish raw and effective, not usable. We need usable as the sizing input | Pure SE sizing tool output, or a quote |
| 5 | Real RVTools 4.8.x export | `vDisk`, `vCluster`, `vDatastore` headers unverified | One export from any customer engagement |
| 6 | Per-workload DRR evidence | Pure publishes only a blended 5:1 | Pure assessment data from real production arrays — you have the best possible source in your own fleet |
| 7 | Confirm the Surveyor's stack and styling | Consistency with the existing tool | Repo access |

Items 1–4 and 6 are all Pure-side and mostly answerable from your own environment and your Pure SE.
Item 6 in particular: if you run Pure in production today, you can derive real DRR by workload type
from your own arrays rather than using a vendor average. That would make this tool measurably better
than anything Broadcom or Microsoft ships.
