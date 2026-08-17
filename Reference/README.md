# HAAS Hyper-V Surveyor

Bidirectional sizing tool for Windows Server 2025 Hyper-V clusters — SAN, Storage Spaces Direct,
or both in one cluster. The Hyper-V counterpart to the Azure Local Surveyor.

100% client-side React + TypeScript. No backend, no telemetry, no upload. That is deliberate:
SEs paste customer workload inventories into this, and if nothing leaves the browser there is no
data-handling conversation to have with the customer's security team.

---

## Just open it

**`HyperV-Surveyor.html`** — double-click it. One self-contained file, no install, no server,
works offline. That's the whole tool.

> **Do not double-click `index.html`.** That's the Vite dev template; it loads TypeScript from
> `/src` and gives you a blank page. `dist/index.html` won't work by double-clicking either —
> browsers block ES modules over `file://`. `HyperV-Surveyor.html` exists precisely to solve
> this: the build emits IIFE instead of ESM, and `scripts/bundle-single.mjs` inlines the CSS and
> JS into the end of `<body>` (a classic inline script in `<head>` would run before
> `<div id="root">` exists and throw React error #299).

## Developing

```bash
npm install
npm test          # 82 engine tests
npm run dev       # http://localhost:5173
npm run build     # type-check + dist/ + HyperV-Surveyor.html
npm run single    # skip type-check, just rebuild the standalone file
```

`dist/` is a static bundle for serving over HTTP, or embed the React component in the existing
Docusaurus site.

---

## What it does

**Forward** — a workload inventory in, minimum node count out, solved independently for every
storage architecture:

```
400 VMs (90% general, 10% database)  ->  13 nodes on Pure SAN            CPU-bound
                                         16 nodes on S2D 3-way mirror    STORAGE-bound
                                         13 nodes on S2D MAP             CPU-bound
                                         13 nodes hybrid                 CPU-bound
```

**Reverse** — fixed hardware in, how much workload fits out, plus which constraint runs out first.
For the common case where the customer is not refreshing.

Both directions share one constraint model. Two separate code paths would eventually disagree with
each other, and a sizing tool that contradicts itself is worse than no tool.

### Why the architectures give different answers

On **SAN**, node count is driven by **compute alone** — the array's capacity is independent of how
many hosts attach to it.

On **S2D**, node count is driven by **compute and capacity together**, because every node you add
is also storage. Parity efficiency itself improves as nodes are added, so capacity has to be
re-evaluated at each candidate node count rather than divided once.

That is the entire reason this is a tool and not a spreadsheet.

### The binding constraint is the answer

Every result names which constraint bound, and what the other two would have needed alone:

> *16 nodes — storage-bound. 279.3 TiB required and three-way mirror yields 33.3% efficiency, so
> 838 TiB raw is needed after reserve. Compute alone would need 13 nodes.*

---

## Provenance tagging

Every rule and every number carries a basis tag, shown in the UI and in the exported workbook:

| Tag | Meaning |
|---|---|
| **MS** | Microsoft-documented hard rule. Enforced — invalid designs are errors. |
| **MS-REC** | Microsoft recommendation. Defaulted to; overrides warn. |
| **TOOL** | Our assumption. No vendor publishes it. Labelled everywhere it appears. |

This matters more than it sounds. An SE who hands a customer a number that looks like vendor
guidance but isn't gets caught once, expensively. If you change a value in `src/engine/rules.ts`,
change its source URL too — or delete the source and retag it `TOOL`.

---

## Rules enforced from Microsoft documentation

- **S2D clusters are 2–16 nodes.** Not 64 — that's the general failover-clustering maximum and
  stops applying the moment S2D is enabled. Hybrid inherits the 16-node ceiling.
- **Dual-parity efficiency diverges by media above 8 nodes.** Hybrid caps at 72.7%; all-flash
  reaches 75% at 9 nodes and 80% at 16. A single table gives wrong answers.
- **Reserve capacity is one drive per server, capped at four drives total** — a 16-node cluster
  still reserves only four.
- **Minimum 4 capacity drives per server**, 2 cache drives when a cache tier is used, HDD-only
  unsupported, cache contributes zero usable capacity.
- **S2D pool metadata needs 4 GiB host RAM per TB of cache per server.** Routinely forgotten,
  worth tens of GiB per node.
- **≥1 CSV per node, total a whole multiple of node count**, ≤64 CSVs per cluster, ≤64 TiB each,
  ≤10 TiB when backup is VSS/volsnap.
- **A 2-node cluster requires a witness.** 3–4 should have one; 5+ gains nothing.
- **Windows Server 2025 changed NUMA behaviour** — a VM needing more virtual cores than one NUMA
  node provides will not start unless NUMA spanning is explicitly enabled. Earlier versions
  started it with degraded performance.
- **Hyperconverged with SAN storage is supported** from WS2022. S2D CSVs on ReFS and SAN CSVs on
  NTFS coexist in one cluster. SAN LUNs must never enter the S2D pool — the "SAN not supported"
  wording in the S2D hardware requirements scopes to *pool membership*, not to the cluster.
- **LBFO teaming is unsupported** for the Hyper-V vSwitch from WS2022. SET only, max 8 adapters.
- **Windows Server licensing floors at 16 cores per server / 8 per socket** — undersized hosts
  still cost a full 16-core licence.

---

## CSV / LUN layout

The part most sizing tools skip, and the part that determines whether the design survives contact
with a restore.

**Microsoft imposes no limit on VMs per CSV** — it says so explicitly. The real constraint is
recovery granularity, and it differs fundamentally by storage type:

- **SAN — the LUN *is* the restore unit.** A Pure/Everpure array snapshot operates at whole-volume
  level, so 60 VMs on one LUN means restoring one VM mounts a 60-VM snapshot. Pure's own design
  philosophy is to align CSV boundaries to snapshot and recovery granularity.
- **S2D — the volume is the *resiliency* unit.** Restore granularity comes from the backup product,
  so the drivers are resiliency tiering, rebuild time, and ownership distribution.

```
max_csv_size = MIN(64 TiB [MS-REC], 10 TiB if VSS-volsnap [MS], blast_radius [TOOL])
count        = MAX(ceil(capacity/max_size), ceil(vms/max_vms_per_csv), node_count)
count        = round_up_to_multiple_of(count, node_count)     [MS-REC]
error if total across all tiers > 64                          [MS-REC]
```

Each plan reports which of the three drivers won. In the demo fleet the database tier comes out
**blast-radius-bound, not capacity-bound** — capacity alone would have put 10 database VMs in one
restore unit.

---

## The RVTools problem

**RVTools contains no utilisation history at all.** `vInfo`, `vCPU` and `vMemory` are *allocation*
only. The `CPU Usage %` and `Memory Usage %` columns on `vHost` are a point-in-time snapshot taken
when RVTools connected to vCenter — not an average.

A sizing built purely from an RVTools import therefore sizes on allocation and **will oversize**,
often substantially, because VMware estates are typically over-provisioned at the vCPU level.

The per-tier **Right-Sizing Factor** exists to make that assumption visible rather than hidden. It
defaults to 1.0 — the conservative choice. For measured data, bring a Live Optics or Aria
Operations export instead; those do carry time-series.

The parser:

- reads `vInfo`, `vPartition`, `vHost`
- excludes templates, SRM placeholders, and vCLS agent VMs (no flag column exists for vCLS — matched by name)
- prefers `vPartition.Consumed` (in-guest actual) over `vInfo.In Use`
- accepts **both** the pre-4.1.2 `MB` and post-4.1.2 `MiB` column spellings
- imports powered-off VMs but excludes them from sizing by default
- auto-classifies into tiers and flags every auto-classification for SE review

> **Build note:** exact column headers for `vDisk`, `vCluster` and `vDatastore` could not be
> verified from an authoritative public source. The parser handles `vInfo`, `vPartition` and
> `vHost`, which is what sizing needs. Before extending it, read the header row of a real
> RVTools 4.8.x export rather than trusting documentation.

---

## Layout

```
src/
  engine/              pure TypeScript, zero React imports
    types.ts           units convention documented at the top
    rules.ts           every MS/MS-REC constant, with source URLs
    compute.ts         CPU + memory demand, host reserves, licensable cores
    capacity.ts        S2D usable-capacity chain, SAN DRR
    csv.ts             CSV/LUN layout algorithm
    validate.ts        errors and warnings
    solve.ts           forward, reverse, multi-architecture comparison
    __tests__/         82 tests, MS citations in the test names
  io/
    rvtools.ts         RVTools .xlsx parser
    exportXlsx.ts      5-tab workbook export
  components/          React UI
  state/               defaults, URL scenario serialisation
```

The engine has **no React dependency** and is independently testable. That was deliberate: sizing
maths that can't be tested apart from the UI is maths nobody will trust the first time a customer
disputes it — and they will. Every rule has a test with its Microsoft citation in the test name.

---

## Things we assume, because nobody publishes them

Editable in the UI, and every one is tagged `TOOL`:

- **vCPU:pCore ratios** (4:1 general, 1:1 database, 8:1 VDI, 6:1 infrastructure). Microsoft
  publishes none — the WS2025 maximums table states *"Virtual processors per logical processor:
  No ratio imposed by Hyper-V"*, and Azure Stack Hub's docs say Microsoft deliberately declines to
  give guidance. Dell's own published guidance is more conservative still, at 2:1.
- **Host CPU and memory reserves.** Hyper-V calculates these dynamically and publishes no figure.
  The closest official anchor is Azure Stack Hub's 15% memory constant, which is Azure Stack
  Hub-specific.
- **VMs per CSV and blast radius.** Microsoft imposes no limit; Pure's specific Hyper-V CSV
  guidance sits behind a login-walled support portal.
- **SMT factor defaults to 1.0 — no hyperthreading credit.** The core scheduler has been the
  default since WS2019 and pairs virtual processors onto SMT siblings so a physical core is never
  shared between two VMs. Taking SMT credit on top of an oversubscription ratio double-counts the
  same headroom.
- **SAN data reduction defaults to 2.5:1.** Pure's blended marketing average is 5:1. The "up to
  10:1" figure includes thin provisioning, which is *not* data reduction — it counts
  allocated-but-unwritten space that vanishes as guests fill their volumes. The tool models thin
  savings separately and never folds them into the DRR.

---

## Still open

1. Pure's actual Hyper-V CSV guidance — VMs per CSV, recommended LUN size *(support portal, blocked to automated retrieval)*
2. Pure MPIO queue-depth values for Windows
3. Pure sector size (512e vs 4K) and NTFS vs ReFS recommendation
4. Pure **usable** capacity per model — datasheets publish raw and effective, not usable
5. A real RVTools 4.8.x export, to verify `vDisk` / `vCluster` / `vDatastore` headers
6. **Per-workload DRR from HAAS's own arrays** — Pure publishes only a blended 5:1. You run Pure in
   production, so you can derive real ratios by workload type from your own fleet. That single item
   would make this tool measurably better than anything Microsoft or Broadcom ships.

---

*Rules verified against Microsoft Learn, August 2026.*
