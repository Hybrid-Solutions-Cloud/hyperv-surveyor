# Hyper-V Surveyor

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
- Existing-hardware headroom and reverse sizing
- CSV/LUN layout and validation findings
- Management Plane Advisor with qualifying questions, capability comparison, and cost model
- XLSX design export, local scenario persistence, and shareable scenarios

The original source material and research workbook remain unchanged under `Reference/`.
