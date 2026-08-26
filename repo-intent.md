# Repo intent — hyperv-surveyor

**Browser-based planning and decision-support app for Windows Server 2025 Hyper-V.**

## What this repo is

Sizes SAN, Storage Spaces Direct, and hybrid cluster designs; identifies the
binding constraint; plans CSV/LUN layout; distributes workloads across target
clusters; assesses migration readiness; connects the technical design to
management, networking, disaster recovery, and licensing decisions. Four guided
planning paths from the landing page: size a new platform from workloads, assess
hardware already owned, fit a workload estate to existing hardware, or design only
the management solution — all converge on the same management-plane checkpoint,
implementation plan, report, and saved-project workflow.

**All workload processing happens in the browser.** No backend, no telemetry, no
inventory upload.

## Shape

- `src/` — the app (Vite + TypeScript, per `vite.config.ts`)
- Production build writes to `dist/` and also produces `HyperV-Surveyor.html`, a
  self-contained single-file build

## Status

Active — live at labs.hybridsolutions.cloud/hyperv-surveyor.
