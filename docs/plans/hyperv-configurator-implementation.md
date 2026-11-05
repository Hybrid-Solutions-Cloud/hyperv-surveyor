# Hyper-V Configurator implementation and publication plan

Created: 2026-09-10  
Status: Active goal; implementation pending  
Baseline: [Design proposal v0.2.0](hyperv-configurator-design/outline.md) and [four editable flowcharts](hyperv-configurator-design/flows.drawio)

## Objective and completion contract

Implement all P0, P1 and P2 functional scope in the design, including Dell OME design/manual handoff and SDN design/setup, as an independent Hyper-V Configurator website/tool. It is not a section of Hyper-V Surveyor and is not an extension of the ProductLabs designer. Surveyor, ProductLabs and the Toolkit are research references, not required runtime or schema dependencies. Optional Surveyor file import is an interoperability feature. Intermediate releases do not close the full goal.

User correction, 2026-09-10: this standalone-tool requirement supersedes the mistaken implementation-home and mandatory ProductLabs/Toolkit integration wording in the original active-goal text and proposal. These planning files currently reside in the Surveyor checkout only because of that mistaken assumption; this location does not establish the implementation home. Do not edit Surveyor product source to implement Configurator.

Establish the standalone tool's GitHub Actions publication pipeline, using existing website delivery practices as a reference. Work locally with native Windows tooling; do not use WSL. Keep the website release separate from deployment of customer infrastructure. Exporting a package never runs it. OME appliance installation remains manual. Live provisioning, reimage and paid resources require separately authorized targets and an execution environment. Missing runtime evidence must remain visible and cannot be replaced by a successful website build.

Completion requires the final commit pushed, all required checks and publication jobs green for that exact commit, and the public website verified against its deployed version/artifacts with working critical journeys and downloads. Required adapter qualification and all remaining phase tasks must also be complete or explicitly changed in scope by the user.

Each unchecked item is pending. Close tasks with file references, test results, consumer versions, action URLs or runtime evidence as appropriate. Track defects and external prerequisites without silently removing scope.

## A. Establish implementation contracts — prerequisite for B–J

- [ ] A01 Establish the standalone Configurator repository and publication destination; inspect applicable instructions and any existing source before scaffolding. Surveyor source remains reference material.
- [ ] A02 Resolve repository registry/work-item tracking and create/link real implementation work items; use valid `AB#` references where required, never invented IDs.
- [ ] A03 Record independent website architecture, owned project/schema/catalog models, optional file interoperability, generic automation consumers and external runner boundaries.
- [ ] A04 Map every question, table, branch and output in proposal sections 1–13 and all four diagrams to implementation tasks and acceptance cases.
- [ ] A05 Trace collected requirements to reference material and define Configurator-owned output contracts. Do not impose ProductLabs scenario layout or Toolkit Track 1 schemas on this tool.
- [ ] A06 Establish dated, primary-source support catalogs for OS/product/HA, OME appliance platforms, SDN architectures and deployment tools; distinguish supported, preview, unknown and unavailable combinations.
- [ ] A07 Identify initial named production adapters, rate-card ownership and authorized qualification environments; keep unresolved prerequisites explicit.

## B. Project model and website workflow — P0; depends on A

- [ ] B01 Define versioned canonical schema, stable resource IDs/references, units, defaults, migrations and validation/result models.
- [ ] B02 Implement management-only, cluster-only, combined and adopt-existing scope with conditional navigation through all 14 design sections.
- [ ] B03 Implement project header, completeness, contextual fields, repeatable inventory tables and live capacity/dependency/licensing summary.
- [ ] B04 Implement new/manual projects, Surveyor import, save/open, draft persistence and project revisions; preserve imported provenance, timestamps and overrides.
- [ ] B05 Separate current/desired state and preserve/adopt/configure/expand/replace lifecycle per resource; prevent implicit replacement.
- [ ] B06 Implement independent resource calculations and optional Surveyor plan import/linking; prevent imported management demand being counted twice and keep source plans intact.
- [ ] B07 Provide field-level error navigation, usable empty states, keyboard access and responsive tables/forms.

## C. Management plane and Dell OME — P0; depends on B

- [ ] C01 Implement capability-led management and licensing questions from Surveyor, offline constraints, preview gates and explained recommendations.
- [ ] C02 Implement new/existing/external/omitted component records for VMM, SCOM, SQL, WAC, identity/PKI, libraries/PXE, Arc, runners and integrations.
- [ ] C03 Implement per-component Hyper-V management/workload/external placement, VMware vSphere/Cloud Director, dedicated physical Windows servers and mixed hosting contracts.
- [ ] C04 Separate infrastructure creation, guest configuration, product installation and integration ownership; collect precise provider/resource mappings.
- [ ] C05 Implement distinct infrastructure/application/database HA, DR, failure domains, anti-affinity and bootstrap/dependency validation.
- [ ] C06 Collect all VMM service/DKM/Run As/library/fabric, SCOM group/pool/database/reporting/agent, SQL edition/storage/HA and WAC mode/authentication/certificate settings in the proposal.
- [ ] C07 Collect supporting identity, DNS, PKI, media/checksum, Arc references and version-qualified integration settings with secret references only.
- [ ] C08 Implement explicit OME existing/new-manual choice, appliance version/platform, device/plugin-driven capacity, placement, addressing and certificates.
- [ ] C09 Collect OME discovery scope, iDRAC references, catalogs/baselines, integrations, entitlements, recovery and owner/evidence checklist.
- [ ] C10 Include OME in BOM, capacity, topology, licensing and exports; prohibit Windows installer treatment and automatic appliance installation. Reachability alone cannot mark completion.

## D. Hosts, clusters and VMM bare metal — P0; depends on B–C

- [ ] D01 Separate deployment intent, host starting state and executor; support design, package, VMM handoff, prepared hosts, adoption, expansion and explicit replacement.
- [ ] D02 Collect sites/racks/fault domains, cluster/node identity, release/edition, witness, reserve, migration, VM paths and topology prerequisites.
- [ ] D03 Implement full per-node physical/BMC/firmware/UUID/NIC/MAC/boot-disk inventory and scoped lifecycle ownership.
- [ ] D04 Implement all VMM bare-metal questionnaire groups: fabric, BMC, PXE/WDS, DHCP, ADK/WinPE, generalized images, physical profiles, OS settings, drivers, networking, storage, Run As references and acceptance evidence.
- [ ] D05 Model desired physical-computer-profile creation separately from a pre-existing profile reference; emit a usable detailed handoff before runtime qualification.
- [ ] D06 Implement distinct SAN/S2D/SMB/local storage and volume/VM ownership, boot/data disks, MPIO, eligibility and capacity validation.
- [ ] D07 Implement physical/logical networks, traffic separation, addressing/pools, NIC mappings, VLANs, MTU/RDMA and single ownership of switches by ATC/VMM/native tooling.
- [ ] D08 Implement domain/trust/OU/security/media readiness and operations, backup/restore, maintenance, patching and RTO/RPO records.

## E. SDN design and setup — P0 design; later execution qualification; depends on C–D

- [ ] E01 Implement none/existing/new/expand and independent design-only/handoff/qualified-automation selections.
- [ ] E02 Derive Network Controller, SLB/MUX and gateway requirements from tenant isolation, policy, load balancing, NAT, routing and tunnel capabilities.
- [ ] E03 Support version-qualified VM-based controller and Windows Server 2025 cluster-role designs; account for controller host overhead and separate SLB/gateway VM demand.
- [ ] E04 Collect underlay/HNV/VIP/tenant pools, physical routing, VLAN/MTU, BGP peers/ASNs/routes, controller endpoints/certificates, identities and connectivity.
- [ ] E05 Collect component counts/capacity/placement/failure domains and tenant networks/policies/services, monitoring and recovery.
- [ ] E06 Implement one lifecycle owner per SDN object across VMM, PowerShell/SDN Express, existing fabric and operator-managed paths; gate exact architecture/tool compatibility.
- [ ] E07 Generate ordered prerequisite, host preparation, controller registration, host networking, SLB/gateway and tenant/service setup stages.
- [ ] E08 Implement scoped address validation, feature dependencies, capacity and topology checks; allow valid isolated tenant overlaps.
- [ ] E09 Export complete SDN design/setup contracts and tests for isolation, east/west, north/south, VIP/NAT, BGP and failover; import returned evidence.
- [ ] E10 Implement and qualify missing SDN execution adapters against supported tool versions; do not label existing Toolkit Track 1 as an SDN installer.

## F. Licensing and commercial model — P0; depends on B–E

- [ ] F01 Collect commercial context, program, existing rights, assignment, SA/subscription term, evidence owner and activation method separately.
- [ ] F02 Model Windows host/guest cores and maintenance/failover placement, System Center managed estate coverage and external management hosting.
- [ ] F03 Distinguish restricted-use supporting SQL rights, separately licensed SQL and edition/HA restrictions; avoid duplicate VMM/SCOM/SQL charges.
- [ ] F04 Include access rights, Azure services, OME/plugin, SDN VM/host and third-party dependencies with existing coverage credited first.
- [ ] F05 Produce dated/user-entered rate estimates, recurring/perpetual costs and purchase gaps with visible assumptions and unresolved decisions.

## G. Validation and export package — P0/P1; depends on B–F

- [ ] G01 Implement completeness, cross-field dependencies, duplicate identity/address, pool capacity, HA/bootstrap, support and conflicting-owner rules from proposal section 11.
- [ ] G02 Separate draft, design-complete, adapter-ready and runtime deployment states; exports never imply deployment success.
- [ ] G03 Implement canonical reopenable JSON and environment YAML for scenario, hardware, networking, SDN, storage, identity, management, OME, licensing and operations.
- [ ] G04 Implement Markdown/PDF design and implementation reports, HLD/LLD, decisions, BOM, assumptions, dependencies and manual tasks.
- [ ] G05 Implement XLSX/CSV inventory, IP/VLAN, NIC/port, storage and licensing schedules.
- [ ] G06 Generate editable draw.io plus PNG management/physical/logical/network/storage/deployment topology from the same project model.
- [ ] G07 Implement validation JSON/Markdown, execution plan, package ZIP and manifest with schema/catalog/adapter/toolkit versions and file hashes.
- [ ] G08 Implement full/internal and sanitized/shareable output; exclude resolved secrets from drafts, logs and exports and private lab defaults from source/examples.
- [ ] G09 Implement named, pinned Ansible inventory/group/host vars, Terraform module tfvars, PowerShell PSD1/JSON, version-specific DSC and VMM consumer mappings.
- [ ] G10 Contract-test generated payloads against the tool's declared automation consumers, including negative cases. ProductLabs-specific integration is not a requirement.
- [ ] G11 Ensure deterministic configuration output, stable ordering, meaningful unsupported-adapter messaging and preserved import/export choices.

## H. Qualified adapters, discovery and execution — P1/P2; depends on G

- [ ] H01 Qualify VMM physical-profile creation, bare-metal submission/job tracking, completion checks and partial-failure reporting.
- [ ] H02 Implement and qualify selected Hyper-V/vSphere/Cloud Director provisioning and existing-VM guest-only adapters against pinned modules/providers.
- [ ] H03 Qualify supported product installation/HA variants for management components and dependencies; keep OME installation manual.
- [ ] H04 Add read-only discovery/import with source, timestamp, confidence, override and reconciliation semantics.
- [ ] H05 Define and implement external execution integration: reviewed immutable request, target allowlist, runtime secret resolution, authorization and bounded stage ownership.
- [ ] H06 Implement stage dependency scheduling, resumability, evidence import, failure/retry handling and as-built reporting without false success.
- [ ] H07 Implement drift comparison and preserve/adopt/reconcile behavior; require explicit scope for destructive replacement.
- [ ] H08 Qualify additional selected providers/DSC resources and SDN paths; maintain a supported-consumer/version matrix with evidence.
- [ ] H09 Validate runner connectivity and runtime paths in separately authorized environments; record external prerequisites while unavailable rather than fabricating acceptance.

## I. Acceptance and regression checks — continuous; final gate after H

- [ ] I01 Test schemas/migrations, conditional validation, preserved resources, HA/dependency cycles, licensing calculations and support/ownership gates.
- [ ] I02 Round-trip all eight reference scenarios through save/open and export; verify all choices and calculated resource demand survive.
- [ ] I03 Test existing Cloud Director management guests plus separate workload cluster; no infrastructure replacement actions.
- [ ] I04 Test new Hyper-V management cluster, VMM/SQL HA, SCOM and VMM bare-metal workload hosts.
- [ ] I05 Test physical management plus prepared hosts/manual cluster, existing shared VMM dependencies, and offline Classic/WAC paths.
- [ ] I06 Test OME manual-only design, VMM-owned SDN and host-resident-controller SDN with correct independent resource accounting.
- [ ] I07 Test missing data, malformed/oversized imports, secrets, unsupported combinations, overlapping scoped pools, ownership conflicts and incomplete runtime evidence.
- [ ] I08 Contract-test each included automation adapter against its declared consumer; distinguish contract checks from actual runtime evidence.
- [ ] I09 Verify generated Markdown/PDF, schedules, diagrams and ZIP contents for accuracy/readability and manifest integrity.
- [ ] I10 Add standalone browser journey/download tests and accessibility/responsive checks; verify optional Surveyor import interoperability and all Configurator management/cluster/SDN flows.
- [ ] I11 Run required repository checks in appropriate native tooling/CI; fix failures and rerun affected checks. GitHub Actions performs the website publication build.

## J. Documentation, release and live verification — completion gate

- [ ] J01 Update website/package version and lockfile metadata as applicable, visible version, changelog and release notes consistently.
- [ ] J02 Document all user journeys, examples, supported matrices, OME manual tasks, SDN setup paths, licensing assumptions and limitations in Markdown.
- [ ] J03 Document schema/migrations, adapter contracts, pinned consumers, development checks, runner configuration, release and rollback procedures; keep draw.io sources with PNGs.
- [ ] J04 Reconcile checklist/traceability with all proposal scope and record unresolved items honestly; update current task, handoff and work-item status.
- [ ] J05 Review final diff for private environment data, secrets, unintended changes and existing-user regressions; commit with required real work-item references.
- [ ] J06 Push through the existing repository workflow; capture final commit SHA and matching GitHub Action run URLs.
- [ ] J07 Wait for every required test/build/deploy job to succeed for that exact SHA; diagnose failures, fix, push and repeat until green.
- [ ] J08 Verify the public published website at the actual workflow destination, deployed version/artifact identity, assets and all critical new/existing journeys and downloads.
- [ ] J09 Record final live evidence, runtime adapter qualification, known limitations, release links and rollback reference in the handoff.
- [ ] J10 Close the active goal only when all required tasks and acceptance conditions are met; a green build alone is insufficient.

## Progress and evidence

- 2026-09-10: Active Codex goal created from proposal v0.2.0. Baseline source package version is 1.2.0, branch `main`. No implementation or deployment claimed by this planning record.
- Implementation prerequisites to resolve: standalone repository/publication destination, tracking project/work items, initial production support/consumer matrix, execution integration and authorized runtime qualification targets.
- User correction: independent tool; Surveyor and ProductLabs are references. No website source was changed before this correction.
