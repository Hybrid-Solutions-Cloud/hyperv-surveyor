# Hyper-V Surveyor

[Open Hyper-V Surveyor](https://labs.hybridsolutions.cloud/hyperv-surveyor)

Hyper-V Surveyor is a browser-based planning and decision-support application for Windows Server 2025 Hyper-V.
It sizes SAN, Storage Spaces Direct, and hybrid cluster designs, identifies the binding constraint, plans CSV/LUN
layout, distributes workloads across target clusters, assesses migration readiness, and connects the technical
design to management, networking, disaster recovery, and licensing decisions.

The landing page offers four guided planning paths: size a new platform from workloads, assess hardware already owned,
fit a workload estate to existing hardware, or design only the management solution. Every platform path converges on
the same optional management-plane checkpoint, implementation plan, report, and saved-project workflow.

All workload processing happens in the browser. The application has no backend, telemetry, or inventory upload.

## Run locally

```powershell
npm install
npm run dev
```

## Validate and build

```powershell
npm test
npm run build
```

The production build is written to `dist/`. The build also creates `HyperV-Surveyor.html`, a self-contained file
that can be opened directly for offline and disconnected use.

## Application areas

- Journey-based planning with new-platform, existing-capacity, fit-and-gap, and management-only starting points
- Workload-to-hardware fit assessment with explicit CPU, memory, S2D, and SAN deficits plus same-spec expansion guidance
- Workload inventory with RVTools import, measured-performance attachment, confidence scoring, bulk review, and manual entry
- Hardware, resilience, storage, and tier assumptions
- Forward comparison across SAN, S2D, MAP, and hybrid designs
- Independent existing-hardware workspace with editable compute, SAN/S2D storage, reserves, workload policies, headroom, and reverse sizing
- Correctness-gated SAN, S2D, and hybrid feasibility with explicit per-tier hybrid placement and domain-specific storage headroom
- Transparent logical-volume planning that shows count-by-size and count-by-VM-grouping math, maps SAN LUNs 1:1 to CSVs, and applies S2D ownership targets once across the storage domain
- Multi-cluster workload placement, source-cluster grouping, database isolation, and migration-readiness findings
- Host network intent, RDMA/DCB validation, switch-port planning, and backup/disaster-recovery bandwidth estimates
- Management Plane Advisor with 16 fact-checked qualifying questions, source links, a workload-aware deployment BOM, SCOM monitoring topology and retention sizing, Arc connectivity and guest-service scope, HA and capacity impact, the complete 85-row capability matrix, VMware translation, field guidance, sourced caveats, 36-SKU reference, and editable cost model
- Workbook-generated platform limits for Hyper-V VMs, hosts, failover clusters, S2D, SCVMM, Windows Admin Center, and Arc-enabled SCVMM
- CSP customer and MSP hosted-platform economics with discounts, markups, RDS SAL/CAL access, delivery cost, tenant/VM pricing, target-margin gap, Lighthouse guidance, and dynamic recommendations
- Selectable full-solution report with document control and native Markdown, JSON, Microsoft Word, PDF, and interactive offline HTML exports
- Versioned reopenable project files, IndexedDB autosave, named scenario comparison, XLSX design export, and shareable scenarios that block results when a large inventory was omitted

The source material and fact-checked research workbook remain under `Reference/`.
