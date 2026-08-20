# Hyper-V Surveyor

[Open Hyper-V Surveyor](https://labs.hybridsolutions.cloud/hyperv-surveyor)

Hyper-V Surveyor is a browser-based planning and decision-support application for Windows Server 2025 Hyper-V.
It sizes SAN, Storage Spaces Direct, and hybrid cluster designs, identifies the binding constraint, plans CSV/LUN
layout, and connects the technical design to a management-plane recommendation and licensing estimate.

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

- Workload inventory with RVTools import and manual entry
- Hardware, resilience, storage, and tier assumptions
- Forward comparison across SAN, S2D, MAP, and hybrid designs
- Independent existing-hardware workspace with editable compute, SAN/S2D storage, reserves, workload policies, headroom, and reverse sizing
- CSV/LUN layout and validation findings
- Management Plane Advisor with 10 qualifying questions, a workload-aware deployment BOM, SCOM monitoring topology, HA and capacity impact, the complete 85-row capability matrix, VMware translation, field guidance, sourced caveats, 36-SKU reference, and editable cost model
- Workbook-generated platform limits for Hyper-V VMs, hosts, failover clusters, S2D, SCVMM, Windows Admin Center, and Arc-enabled SCVMM
- CSP customer and MSP hosted-platform economics with discounts, markups, RDS SAL/CAL access, delivery cost, tenant/VM pricing, target-margin gap, Lighthouse guidance, and dynamic recommendations
- Selectable full-solution report with native Markdown, JSON, Microsoft Word, and PDF exports
- XLSX design export, local scenario persistence, and shareable scenarios

The source material and fact-checked research workbook remain under `Reference/`.
