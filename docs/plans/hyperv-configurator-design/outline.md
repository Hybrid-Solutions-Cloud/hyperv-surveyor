# Hyper-V Configurator — proposed outline and workflow

Version: 0.2.0  
Prepared: 2026-09-10  
Status: Design proposal for review; no website or infrastructure changes.

Revision 0.2.0: Dell OpenManage Enterprise is an explicit designed, manually deployed appliance. Added a complete optional SDN design/setup branch, export contracts and fourth flowchart.

## 1. Product direction

The configurator turns a sizing decision into a complete, reviewable deployment design. It supports management-only, cluster-only, and combined projects. Users may enter requirements directly, reopen a configurator project, or import a Hyper-V Surveyor plan.

Surveyor remains the sizing and option-comparison starting point. The configurator adds the exact identities, networks, placement, dependencies, deployment ownership and variable contracts needed to implement the selected design.

The website should offer three independent actions: save a draft, export a design/handoff package, and—only when an execution integration is available—submit a separately reviewed deployment request. Downloading files does not start deployment.

### Evidence already available

| Source | What we can reuse | Important limit |
| --- | --- | --- |
| Hyper-V Surveyor management advisor | Requirement-led questions, Classic/VMM/WAC/Arc choices, monitoring selection and rationale | A recommendation is not an installation contract |
| Surveyor deployment and cost engines | Managed-host/VM/cluster scale, VMM and SCOM HA, SQL placement, management capacity, commercial assumptions | External hosting is currently broad; detailed provider and physical-server contracts need expansion |
| ProductLabs Deployment Designer | Eleven-step workflow, conditional fields, provenance, deterministic compilation and validation | Existing source proof is not certification of every runtime path |
| ProductLabs scenario templates and SDR management contracts | Separate hardware, networking, identity, product, VM and lifecycle data; VMware Cloud Director existing-VM example | Private environment values must never become public examples or defaults |
| Hyper-V Toolkit | Staged foundation, SQL, WAC, SCOM, VMM, fabric, bare-metal and cluster tasks | Several paths are lab-specific or incomplete; the existing VMM physical-computer profile must be created beforehand |
| Microsoft product documentation | Version-specific support, HA and bare-metal prerequisites, licensing rules | Recheck when catalog versions or commercial programs change |

Two concrete integration gaps matter. ProductLabs' prototype compiler emits a normalized `management_plane` model, while the toolkit generator reads older `hyperv_management_plane` and `track1` shapes. The generator also has legacy path defaults. Matching filenames is insufficient: we need a tested field adapter to a pinned toolkit version.

## 2. What the website looks like

A persistent project header contains project name, design revision, save/open/import, completeness, and export. A left navigation lists the sections below. The main pane uses decision cards for architectural choices, tables for repeatable inventories, and contextual fields that appear only when applicable. A summary pane shows selected components, server/VM counts, capacity, licensing assumptions, dependencies and unresolved items.

| Section | Main question |
| --- | --- |
| Start / project | What are we designing, and what already exists? |
| Management requirements | Which management capabilities and products do we need? |
| Management hosting and HA | Where does each component run and how does it recover? |
| Sites and cluster topology | What Hyper-V estate are we building or adopting? |
| Hardware and host provisioning | Which physical machines, images and boot methods? |
| Storage | SAN, S2D, SMB or local storage; which volumes and policies? |
| Networking and IP plan | How are adapters, switches, traffic and addressing configured? |
| SDN design and setup | No SDN, existing SDN, or new SDN; which services and deployment owner? |
| Identity, security and media | What identities, trust, certificates and installation sources are required? |
| Product configuration | Exact SQL, VMM, SCOM, WAC, Dell OME and optional product settings |
| Licensing and costs | What entitlements exist and what still needs to be purchased? |
| Operations and recovery | Who patches, monitors, backs up and recovers this design? |
| Automation and handoff | Who owns each stage and what receives the exported files? |
| Review and exports | Is the design complete, and which deliverables are ready? |

The flow is conditional. Management-only skips workload-cluster design but still records the hosting capacity and connectivity on which management depends. Cluster-only asks whether management is existing, externally supplied, not required or deferred.

## 3. Start and import

Collect project/scenario identifier, owner, customer/business context, sites, naming convention, design version, support target and environment class: lab, proof of concept, production or hosted service.

Offer:
- Start from Hyper-V Surveyor export.
- Open an existing configurator project.
- Start manually.
- Import inventory or read-only discovery evidence.

Scope choices: management plane only; cluster only; both; document/adopt an existing installation.

For every imported object retain source, observation time, units, original identifier, confidence and user overrides. A host count calculated by Surveyor does not invent hostnames, BMC addresses or physical NIC mappings. Imported management demand must not be counted twice.

Separate intended lifecycle per object: preserve, adopt, configure, expand/repair, or replace/reimage. Record current and desired states independently.

## 4. Management-plane requirements

Start with the useful questions already in Surveyor:

| Question | Conditional outcome |
| --- | --- |
| Must operation continue without Azure connectivity? | Exclude Azure-dependent features from satisfying offline requirements |
| Is bare-metal host OS deployment required? | Open a VMM provisioning path or a separately supported OEM/toolkit provisioning path |
| Are Windows hosts already prepared? | Allow prepared-host cluster creation without requiring VMM bare-metal deployment |
| Are tenant clouds, quotas or self-service required? | Examine VMM fabric/cloud requirements and the actual tenant interface |
| Are Azure portal/ARM/RBAC VM operations required? | Evaluate Arc-enabled VMM as an addition to VMM |
| Are central fabric, placement, templates or vendor integrations required? | Collect VMM dependencies and supported integration versions |
| Is a browser administration interface required? | Evaluate WAC Administration Mode and separately gated Virtualization Mode |
| Is SCOM monitoring required? | Open an independent SCOM design |
| Is management HA required? | Ask which services must remain available and their RTO/RPO |
| Are preview capabilities acceptable? | Gate preview-only choices and record the acceptance |

The bare-metal question must name the deployment owner. Surveyor currently routes its BMC/PXE requirement to VMM; the configurator should also describe an OEM/toolkit route without implying that WAC installs an OS.

Each component has status: not selected, deploy new, use existing, configure existing, or supplied by another team.

Component catalog:
- VMM management service and consoles.
- VMM library shares, images, drivers and templates.
- PXE/WDS and ADK/WinPE prerequisites when VMM bare-metal is selected.
- SCOM management servers, operational database, warehouse, web console, reporting, gateways and optional ACS.
- SQL resources serving management databases.
- WAC Administration Mode; WAC Virtualization Mode as an independent version-gated choice.
- AD DS/DNS, PKI, jump/administration hosts and automation runners where needed.
- Arc resource bridge and selected Azure services.
- Dell OpenManage Enterprise appliance as an explicit selectable management component, with manual deployment and complete inventory/integration requirements.
- Optional SDN components: Network Controller, software load balancer/MUX and RAS gateways, selected through the SDN design branch.
- Backup, patching and other supported integrations.

Dependencies can use an existing service. Selecting VMM does not automatically create a new domain, SQL installation or CA.

### Dell OpenManage Enterprise — designed appliance, manual deployment

OME appears alongside VMM, SCOM, SQL and WAC in component selection and the management BOM. Choices are **not required**, **use an existing appliance**, or **plan a new appliance for manual deployment**. Its appliance installation is never included in automatic Windows/product installation stages.

| Decision | Collected data |
| --- | --- |
| Appliance | Exact OME version/build, deployment image/source and checksum, new/existing status and appliance identity |
| Hosting | Supported hypervisor/version, cluster/host, datastore/storage policy, VM name and deployment owner; validate the appliance matrix instead of inheriting every generic Windows-server hosting option |
| Sizing | Managed device count, selected plug-ins, vCPU, RAM, disks and free-capacity requirements from the selected release profile |
| Network | FQDN, IP/CIDR, gateway, DNS/NTP, management VLAN/port group, HTTPS endpoint, certificate and proxy requirements |
| Device scope | Explicit iDRAC/device addresses or bounded discovery ranges, device groups, protocols and runtime credential references |
| Lifecycle integration | Firmware/driver catalog source, baseline, compliance schedule, maintenance owner and any supported VMM/WAC/vCenter/monitoring integration |
| Licensing | Existing entitlement, required advanced/integration/plugin rights, affected device scope and purchasing owner; do not assume every feature is included |
| Recovery and access | Admin/RBAC, backup/export and restore procedure, monitoring/alerts and hypervisor recovery protection; no invented application HA pair |
| Manual completion | Appliance import, first-boot wizard, licensing, discovery/integration validation and evidence/owner sign-off |

The resource consumes management capacity and appears in topology, inventory, licensing, environment YAML and design reports even though deployment is manual. Export a manual task and an expected appliance endpoint, not a Windows installer or a generic empty VM described as a completed OME appliance. Existing OME remains preserved.

Current toolkit evidence is limited to an HTTPS reachability wait and operator note; the check ignores connection errors. It cannot certify appliance installation or operational readiness. Qualify any future read-only OME validation separately.

## 5. Hosting and availability — per component

### Hosting choices

| Choice | Required follow-up |
| --- | --- |
| VM on the new workload Hyper-V cluster | Cluster reference, placement, reserved capacity, anti-affinity and bootstrap/recovery plan |
| VM on a dedicated Hyper-V management cluster | Management cluster topology, hosts, storage, networks and capacity |
| VM on an existing external Hyper-V fabric | Fabric/cluster/host reference, owner, capacity and provisioning authority |
| VM on VMware vSphere | vCenter, datacenter, cluster/resource pool, datastore/policy, network/port group, template, folder and placement rules |
| VM on VMware Cloud Director | Endpoint, organization, Org VDC, vApp, network, storage policy, catalog/template and resource identity |
| Dedicated physical Windows server | Server identity, OOB details, OS, boot/storage/NIC inventory and role assignment |
| Mixed placement | Repeat the appropriate contract for each selected component |
| Other/external service | Record the service contract and owner; allow reporting, require an adapter before automated creation |

“Runs on Hyper-V” means a guest VM unless an explicit supported role placement says otherwise. Do not offer VMM installation in the Hyper-V host parent OS.

For each VM/server collect name/FQDN, roles, exact OS/product versions, Server Core/Desktop Experience as supported per role, vCPU/physical cores, memory, disks, network attachments, IP/DNS, domain/OU, site/failure domain, image, owner, lifecycle and resource reference.

Ask separately:
1. Create the VM or physical OS?
2. Configure the guest?
3. Install products?
4. Configure/integrate products?

This accommodates existing VMware VMs where only Windows and application configuration are needed.

### Availability choices

Use a service-by-service availability table, not one checkbox:
- Infrastructure restart/failover protection.
- Application HA topology.
- Database HA topology.
- Site disaster recovery.
- Backup/rebuild or warm-standby recovery.

VMM: standalone or supported clustered management service; SQL HA and library HA are separate dependencies. Collect cluster/service names, addresses, domain/DKM, service accounts and failure-domain placement.

SCOM: management-server redundancy/resource pools, database availability, gateways, web access and reporting recovery separately. Do not label every SCOM role as active/active because two servers exist.

SQL: use existing or deploy; edition/version; standalone, supported FCI or supported AG; database mapping, listener, replicas, synchronization/failover mode, endpoints, witness and backup. Check the edition's actual AG/FCI capabilities before allowing a shared VMM/SCOM database design.

WAC: mode, supported deployment topology, endpoint, certificates and recovery. Two different WAC modes are not an HA pair. Current Microsoft documentation labels Virtualization Mode as preview.

Show a dependency/failure-domain view. Two management VMs on one physical host do not provide host-failure resilience. If VMM is needed to build the very cluster that would host VMM, require a seed, temporary host or external management fabric.

## 6. Cluster deployment choices

Separate the deployment **intent**, the **host starting state**, and the **executor**.

### Intent
- Collect a detailed design and handoff only.
- Generate an automation package without executing it.
- Prepare a VMM fabric/bare-metal handoff.
- Request supported end-to-end automation through an external runner.
- Adopt or expand an existing estate.

### Starting state
- Bare metal; no usable OS.
- OS installed; host not configured.
- Hyper-V ready; no cluster.
- Existing cluster to adopt/document.
- Existing cluster expansion.
- Replacement/reimage of specifically identified machines.

### Executor and ownership
- VMM provisions hosts and owns selected fabric objects.
- Toolkit/Ansible/PowerShell prepares hosts and creates the cluster.
- WAC/native operator follows a generated implementation plan.
- Mixed stage ownership with an explicit boundary between stages.

“Fully automate” means all selected stages have supported adapters, required data and passing prerequisites. It must not be an unconditional success promise.

### Cluster fields
Collect cluster name, target release/edition, standalone versus clustered, node membership, site/rack/fault domains, address/administrative access point, naming/domain/OU, witness, maintenance/failure reserve, storage model, VM paths, live migration policy, networks, security baseline and validation evidence. Multi-site/DR configurations need a separately supported topology with RTO/RPO; do not equate a stretched workload cluster with supported VMM management-service HA.

Standalone local storage, clustered SAN, S2D, supported SMB storage and mixed storage require distinct models. Track each VM/volume's storage owner and target.

## 7. Detailed VMM bare-metal questionnaire

| Group | Required collection |
| --- | --- |
| VMM fabric | Existing/new VMM, version/build, service endpoint, host group, cloud if used, delegated authority and capacity |
| Physical identity | Stable node ID, vendor/model, serial/service tag, SMBIOS UUID, intended name, rack/site and ownership |
| BMC | Address, supported protocol/port, firmware, certificate policy and Run As/secret reference; management-network reachability |
| Boot/network | BIOS or UEFI, Secure Boot capability, PXE NIC/MAC, boot order, DHCP/reservation, PXE/WDS placement and approved network prerequisites |
| Deployment services | WDS/PXE server inventory, VMM registration, ADK/WinPE versions, boot-image drivers and endpoint connectivity |
| OS image | Generalized VHD/VHDX for the VMM profile, Windows version/edition/install type, image version/hash, library location and servicing baseline |
| Physical computer profile | Existing profile reference or complete desired definition; profile per applicable hardware/firmware/boot combination |
| OS installation | Boot disk/controller/RAID target, partition/layout intent, locale/time zone, activation method, domain join/OU and answer-file references |
| Drivers and firmware | Qualified driver package, hardware applicability, signed source/hash, firmware baseline and responsible tool |
| Host network profile | Physical NIC identity, management NIC, logical switch/uplink profile, virtual NICs, classifications, network sites, VLANs and IP pools |
| Storage | Local boot versus data disks; SAN zoning/LUN presentation or S2D disk eligibility, MPIO and applicable agents |
| Credentials | VMM Run As references for BMC/domain join and installation operations; resolved only by the execution environment |
| Scope and safeguards | Exact machine allowlist, existing-workload detection, preflight evidence, selected reimage scope, stage ownership and change window |
| Completion | OS/driver checks, domain/DNS, host registration, cluster validation, network/storage tests and returned evidence |

The handoff should generate a per-node worksheet and machine-readable physical profile/target definitions. An OEM Redfish virtual-media install is a different adapter from VMM's BMC/PXE process.

Repository evidence: the toolkit's fabric role checks for a pre-existing physical-computer profile and throws if it is absent. Its bare-metal task starts asynchronous VMM jobs. Before advertising complete automation, add/qualify profile creation or explicit import, job tracking, failure cleanup and post-deployment acceptance.

## 8. Storage, networking, identity and operations

| Area | Choices and data |
| --- | --- |
| S2D | Eligible node count, symmetrical disk layout, boot/cache/capacity roles, controllers, media, resiliency, reserve, thin/fixed, ReFS/NTFS, CSV names/sizes and placement |
| Fibre Channel SAN | Array/model, dual fabrics, HBA/WWPN mappings, zoning ownership, host groups, LUNs, MPIO policy, filesystem and recovery |
| iSCSI SAN | Initiator IQNs, target portals, VLAN/subnet, path diversity, MPIO, authentication references and LUN mapping |
| SMB storage | Supported file service/share, availability, permissions/authentication, network/RDMA and ownership |
| Host network | Adapter MAC/port identity, speed/model, SET, vNICs, traffic isolation, MTU, QoS and RDMA/DCB where applicable |
| Network authority | VMM logical switches, Network ATC or native tooling; one writer per adapter/switch/resource scope |
| IP plan | Management, OOB, storage, live migration, cluster and VM networks; CIDRs, VLANs, gateway, DNS/NTP, DHCP/static pools, reservations and firewall flows |
| Identity | Existing/new forest/domain, trusts, DNS, OU, pre-staged objects, service/gMSA accounts, delegation, DKM and certificate lifecycle |
| Media | Artifact source, exact build/edition, checksum/signature, drivers, ADK/WinPE, product updates, download method and offline cache |
| Security | Roles, privileged access, runner identity, certificate trust, WinRM/SSH policy, hardening, Defender and secret references |
| Operations | SCOM packs/discovery/retention, alerts, patch rings, Cluster-Aware Updating ownership, backup scope, RTO/RPO, restore tests and capacity thresholds |

The current toolkit Track 1 rejects Network ATC intents. A broader future ATC option must choose a different validated adapter; it cannot silently reuse that track.

### SDN design and setup

Add a dedicated SDN step immediately after the physical networking/IP plan. Offer **no SDN**, **document/use existing SDN**, **design a new SDN deployment**, and **expand an existing SDN deployment**. Separately choose design-only export, operator setup handoff, or qualified automated setup.

**Select capabilities first:** tenant virtual networks/isolation, network security policies/microsegmentation, internal/external load balancing, inbound/outbound NAT, routed connectivity, and supported site-to-site gateway connectivity. Derive required components from the chosen release's dependency matrix; do not deploy every role for every SDN project.

| Area | Choices and required inputs |
| --- | --- |
| Version and authority | Windows Server edition/build, VMM version where used, existing/new SDN fabric, exact deployment tooling and one lifecycle owner per resource |
| Network Controller | Supported Service Fabric/VM deployment or Windows Server 2025 Failover Clustering role; resource placement, redundancy, API endpoint/floating IP, DNS, identity and certificates |
| SLB/MUX | Required features, instance count, sizing, placement/failure domains, management/provider attachments, private/public VIP pools, BGP peers and availability |
| RAS gateways | Supported connection types and gateway pools, capacity/throughput, active/reserve placement, tenant mappings, tunnel endpoints and authentication references |
| Physical underlay | Switch/router models and capabilities, VLAN/trunks, routing, selected encapsulation/MTU, ECMP where required, uplinks and physical-network owner |
| Address plan | Management/controller endpoints, HNV provider addresses, tenant virtual networks/subnets, VIP/GRE pools where required, exclusions and allocation/reservation ownership |
| Routing | Peer addresses, local/remote ASNs, advertised prefixes, route filters, tenant routes and external-network dependencies |
| Tenant policy | Tenant/cloud ownership, virtual networks and subnets, isolation, security rules/tags where supported, QoS, DNS/DHCP behavior and address-overlap scope |
| Service policy | Load-balancer frontends/backends/probes, NAT rules, gateway connections, route propagation and external firewall changes |
| Operations | Monitoring/SCOM integration, backup/recovery, certificate renewal, patch order, capacity thresholds and validation evidence |

Windows Server 2025 supports Network Controller as a Failover Clustering service on hosts; the Service Fabric model remains an alternative. SLB and gateway roles remain VMs. Record host-resident controller overhead without inventing controller VMs. Do not assume the VMM deployment path supports every controller architecture: validate the exact VMM/OS/tooling combination before making automated setup available.

**Setup ownership paths:**

1. **VMM-managed SDN:** collect VMM service templates/profiles, network service/controller registration, logical networks, host groups, VM placement and selected SLB/gateway inputs. Produce a VMM setup handoff and a version-qualified adapter.
2. **PowerShell / SDN Express:** collect the configuration accepted by the exact supported script/tool version. Keep physical-network tasks, host preparation and SDN lifecycle ownership explicit. A host-resident controller may require its own deployment procedure rather than the classic VM-based SDN Express profile.
3. **Existing SDN:** reference and validate existing controller/services/pools, preserve them, and emit only the requested additions or configuration deltas.
4. **Operator setup:** export full topology, prerequisites, parameter worksheets, ordered instructions and tests when no qualified execution adapter exists.

**Setup order:** validate design and reachability → complete physical routing/VLAN/MTU prerequisites → prepare Hyper-V hosts, identity, certificates and media → deploy/register the selected Network Controller architecture → enable/register host networking → deploy required SLB/MUX and gateway resources → configure tenant networks, policies and services → validate isolation, east/west traffic, required north/south connectivity, VIP/NAT, BGP and failover → return evidence and as-built data.

The SDN path adds its actual resource demand to management/infrastructure sizing without double counting workload VMs. Non-overlap rules apply to shared underlay/VIP pools; overlapping isolated tenant address spaces must be evaluated in their tenant/routing scope rather than rejected globally. Validate address capacity, feature prerequisites, HA/failure domains, control-plane reachability, certificates and topology support. Stretched/multi-site requests require an explicitly supported SDN design, not an automatic extension of the ordinary cluster branch.

No SDN deployment implementation was found in the toolkit scripts/roles reviewed for this outline. Full SDN collection and setup handoff are in scope; automated setup needs a new qualified adapter and runtime evidence. Selecting SDN must not silently claim the existing Track 1 workflow installs it.

### Product-specific configuration records

| Product | Additional fields required after selection |
| --- | --- |
| VMM | Management service endpoint/name; exact version/update rollup; DKM container; service and Run As identities; SQL database/listener; library servers/shares/quotas; host groups, clouds, roles/quotas, templates, logical networks/sites/IP pools, port/uplink profiles and integration ownership |
| SCOM | Management group; management servers/resource pools; operational/warehouse database names and retention; agent counts and discovery scope; management-pack versions; action/access/data-reader/data-writer identities; gateways and cross-domain certificates; reporting/web roles, endpoints and recovery; alert routes and maintenance schedules |
| SQL | Edition/build and supported collation; instances/ports; service identities/SPNs; data/log/tempdb/backup disk paths and capacity; database owner mappings; AG/FCI details; listener addresses; witness; backups, retention and restore acceptance |
| WAC | Mode/build, gateway/server name, URL/port, TLS certificate source/renewal, authentication/delegation, operator roles, connection scope, extension versions and recovery |
| Dell OME | Appliance version/placement/resources, endpoint, device/discovery scope, catalogs/baselines, plugin/license requirements, integrations, recovery and manual deployment evidence |
| SDN | Controller architecture/endpoint, SLB/MUX and gateway pools, underlay/tenant/VIP addressing, BGP, policy, deployment authority and setup/validation contract |
| Arc | Existing VMM/resource-bridge references, supported appliance placement, logical Azure scope references, region, network/proxy/DNS, outbound prerequisites, identity/RBAC, onboarding scope and selected paid services |
| Identity/PKI | Existing/new service, domain/forest and trust, DNS authority, OUs/pre-staging, gMSA prerequisites, root/issuing CA ownership, certificate templates, CRL reachability and recovery |

The OS catalog must distinguish Windows Server with the Hyper-V role from legacy standalone Hyper-V Server installations. “Hyper-V” alone is not a sufficiently precise OS or licensing input.

## 9. Licensing and commercial questions

Carry Surveyor's licensing journey forward, but keep entitlements, activation and price estimates separate.

| Topic | Ask |
| --- | --- |
| Commercial context | Internal IT, customer-owned deployment, hosted service/MSP; purchasing agreement/program, region/currency and quote date |
| Existing entitlements | Product/version/edition, quantities, assignment, subscription/SA status and expiry, and evidence owner |
| Windows Server | Standard/Datacenter, eligible physical-core or per-VM licensing, host sockets/cores, guest count and maximum placement during maintenance/failover |
| Management hosting | Who licenses Windows on external Hyper-V, VMware or physical management servers; existing coverage versus new requirement |
| System Center | VMM and/or SCOM, managed endpoints/cores/OSEs, Standard/Datacenter, existing suites/coverage, eligible licensing basis and program |
| SQL | Included restricted-use SQL technology versus existing separate entitlement versus new purchase; edition, workloads, HA features and reporting roles |
| Access | Windows CALs, RDS CALs/SALs or other applicable access rights based on actual use and agreement |
| Azure | Arc features, enabled billable services, covered benefits, guest/host scope, ingestion, retention and region |
| Third parties | VMware hosting, backup, OEM management and other separately licensed dependencies |
| OME and SDN | OME feature/plugin entitlements; OS licensing for SDN VMs or host roles; network hardware and external dependencies; count existing coverage before new purchases |
| Costs | User-entered or dated rate cards, recurring versus perpetual, term, support/SA, discounts, optional commercial margin |

Microsoft's System Center licensing resources include rights to supporting SQL Server Standard runtime technology. Do not automatically add separate VMM and SCOM licenses for the same already-covered managed estate, or separate SQL costs when applicable included rights cover the design. A chosen SQL Enterprise feature, non-management workload or different agreement may require separate licensing.

Per-VM Windows licensing has subscription/active-SA eligibility conditions. Failover placement and host licensing must remain consistent. Pricing is an estimate until linked to the applicable agreement/quote; the website should show assumptions and unresolved licensing decisions rather than certify compliance.

## 10. Exports and handoff package

One versioned canonical project drives every report and adapter. Users choose full internal or sanitized/shareable reporting; infrastructure addresses and private inventory should not leak into public links.

| Deliverable | Format | Contents / consumer |
| --- | --- | --- |
| Reopenable project | JSON | Complete design, choices, stable IDs, versions, provenance and unresolved items |
| Human design report | Markdown and PDF | Executive summary, HLD/LLD, topology, BOM, management/cluster design, sizing, licensing assumptions and risks |
| Detailed schedules | XLSX and CSV | Servers/VMs, IPs/VLANs, NIC/port mappings, storage, dependencies and license worksheet |
| Diagrams | Editable draw.io plus PNG | Logical/physical topology, management dependencies, network/storage and deployment flow |
| Environment configuration | YAML | Scenario manifest and separate hardware, networking, identity, management, storage, licensing and operations contracts |
| Ansible adapter | YAML | Inventory, group_vars/host_vars, stage selection and external secret lookups; pinned role/collection versions |
| Terraform adapter | tfvars.json or tfvars | Inputs matching a named, pinned module/provider; backend references and separate plan instructions |
| PowerShell adapter | PSD1 and/or JSON | Typed data accepted by named toolkit entry points; stage parameters and secret references |
| DSC adapter | Version-specific configuration data | DSC 3 YAML/JSON resource documents, or Windows PowerShell DSC configuration-data PSD1 as a distinct compatibility path |
| VMM handoff | YAML/JSON plus CSV and documented PowerShell mapping | Physical profiles, targets, network objects, Run As references and preflight/job tracking requirements |
| Dell OME design | YAML/JSON, BOM and Markdown manual checklist | Appliance placement/resources, device scope, integration/license requirements and manual deployment/acceptance tasks; no appliance install action |
| SDN setup | YAML/JSON, version-qualified PowerShell/VMM inputs and Markdown | Controller/SLB/gateway inventory, underlay and tenant topology, BGP/VIP/policy definitions, setup stages and validation |
| Validation report | JSON and Markdown | Completeness, cross-field failures, warnings, unsupported combinations and export readiness |
| Package manifest | JSON | Design/schema/catalog/adapter/toolkit versions, file hashes, generation metadata and deployment state |
| Execution plan | Markdown and JSON | Ordered stages, dependencies, owners, selected hosts, evidence requirements and resumability |

Do not generate a file called Terraform or DSC merely by changing the extension. Every automation output needs a defined consumer contract and positive/negative tests. Do not place product keys, passwords, private keys or resolved credentials in the package. No production tenant/subscription IDs are copied into committed artifacts; use logical references under the applicable repository policy.

Proposed package layout:

```text
hyperv-design/
  project.json
  manifest.json
  reports/
    design.md
    design.pdf
    implementation-plan.md
    licensing.xlsx
    inventory.xlsx
    validation.md
  diagrams/
    topology.drawio
    topology.png
  environment/
    scenario.yml
    hardware.yml
    networking.yml
    sdn.yml
    storage.yml
    identity.yml
    management.yml
    ome.yml
    licensing.yml
    operations.yml
  adapters/
    ansible/
    terraform/
    powershell/
    dsc/
    vmm/
  validation/
    results.json
```

The ProductLabs repository adapter maps the generic environment model into its existing `config/scenarios/<scenario-id>/...` ownership structure. Other environment repositories get their own mappings. Only supported, selected adapters appear in an automation-ready package; drafts may export a design report clearly marked incomplete.

## 11. Execution flow and validation

The companion draw.io contains four pages: complete journey, management-plane decisions, cluster deployment branches, and SDN design/setup. Dell OME is explicitly included in management and output stages as a manually deployed appliance.

A draft may be saved at any time. Automation readiness requires complete applicable data, supported versions/topology, a tested adapter, immutable input references and a reachable execution environment. A separate execution system owns authorization and runtime credentials.

Required validation examples:
- VMM bare-metal without VMM/PXE/profile/targets: incomplete.
- Network ATC and VMM attempting to own the same switch: blocked.
- VMware hosting without a provider/resource mapping: report draft only.
- Existing VM with “create infrastructure” disabled: retain complete guest inventory; do not emit replacement actions.
- Management HA peers sharing one unprotected failure domain: availability requirement unmet.
- SQL topology exceeding selected edition capabilities: blocked until corrected.
- SCOM reporting labeled HA without a supported recovery design: reject that claim.
- Duplicate IP/MAC/name or pool exhaustion: block affected deployment.
- No independent bootstrap path for self-hosted VMM: unresolved dependency.
- Unknown product/OS/firmware support: draft/manual review, not certified automation.
- Generated configuration: status remains undeployed until execution evidence is imported.
- OME selected: include appliance capacity and a manual deployment task; reject automatic Windows-install treatment or a completed state without evidence.
- SDN selected without its required addressing, routing, certificates, components or qualified adapter: permit a marked draft/handoff, not automated-ready status.
- VMM and SDN Express attempting to own the same SDN objects: block until ownership is resolved.

## 12. Delivery order and acceptance

Primary user stories: an infrastructure architect needs a complete design and BOM; an implementation engineer needs exact per-node/per-component data and ordered stages; a VMM administrator needs a complete physical-profile and fabric handoff; a licensing owner needs separate entitlement and purchase assumptions; an operations owner needs recovery and maintenance responsibilities.

The first release does not perform unqualified infrastructure execution, certify licensing compliance, or make every provider/engine combination automatically deployable. These require validated consumer contracts and their own acceptance evidence. No delivery date was provided; phase sequencing is proposed rather than a calendar commitment.

P0: complete questionnaire, import/save, per-component hosting/lifecycle/HA, cluster handoff choices, licensing worksheet, validation, canonical JSON/YAML and design reports. First automation adapter: reconcile the ProductLabs scenario contract with a pinned Hyper-V Toolkit version. Include VMM bare-metal collection and a usable operator handoff even where execution remains manual.

P0 also includes Dell OME appliance design/manual handoff and the full optional SDN questionnaire, component sizing, topology and setup exports. OME installation stays manual. SDN automated execution is qualified separately from design completeness.

P1: qualified VMM profile creation/job tracking; VMware/Hyper-V infrastructure adapters; richer topology diagrams and spreadsheet schedules; additional product installation/HA variants; read-only discovery with provenance.

P2: authorized execution integration, resumable stage evidence, drift/reconcile workflows and separately qualified additional providers/DSC resources.

Acceptance targets:
- Every required answer maps to an output field or an explicit design decision.
- No secret values appear in drafts, reports, logs or exports.
- All eight reference scenarios below round-trip without losing choices.
- Identical accepted design and adapter versions produce identical configuration payloads.
- Unsupported combinations cannot be labeled automation-ready.
- Every included adapter passes contract tests against its intended consumer.
- Human review can distinguish existing resources, proposed creations, reimages, manual tasks and unresolved dependencies.

Reference scenarios:
1. Existing VMware Cloud Director management VMs; configure guests/products only; separate Hyper-V workload cluster.
2. New Hyper-V management cluster with VMM/SQL HA, independent SCOM design and VMM bare-metal workload hosts.
3. Dedicated physical management servers with prepared Hyper-V hosts and a manual/native cluster handoff.
4. Existing VMM/SQL/identity services; new cluster only; preserve all shared dependencies.
5. Offline environment with Classic/WAC administration and supported local automation; no required Azure control plane.
6. Manually deployed OME on supported external virtualization; include its capacity, discovery/catalogs, licensing and completion evidence without emitting installation actions.
7. VMM-owned SDN design with selected NC, SLB and gateway resources; full underlay/BGP/VIP and tenant-policy contracts.
8. Windows Server 2025 host-resident Network Controller design; controller host overhead and selected SLB/gateway VMs counted separately; automation gated on compatible tooling.

Open product decisions for implementation: whether the configurator lives inside Surveyor or as a linked website; first supported production hosting adapters; exact initial OS/product version matrix; commercial rate-card owner. None prevents reviewing this outline.

## 13. Sources and traceability

Local evidence reviewed:
- [Surveyor management questions](D:/git/hybrid-solutions-cloud/hyperv-surveyor/Reference/management-decision-questions.fact-checked.json)
- [Surveyor management deployment model](D:/git/hybrid-solutions-cloud/hyperv-surveyor/src/engine/managementDeployment.ts)
- [Surveyor licensing/cost model](D:/git/hybrid-solutions-cloud/hyperv-surveyor/src/engine/managementCost.ts)
- [ProductLabs questionnaire](D:/git/tierpoint/prodtech/hybrid-cloud/environments/tierpointproductlabs/pmo/deployment-designer/requirements-and-questionnaire.md)
- [ProductLabs compiler](D:/git/tierpoint/prodtech/hybrid-cloud/environments/tierpointproductlabs/apps/deployment-designer/shared/src/compiler.ts)
- [Scenario boundary](D:/git/tierpoint/prodtech/hybrid-cloud/environments/tierpointproductlabs/docs/decisions/scenario-configuration-boundary.md)
- [Toolkit stages](D:/git/tierpoint/prodtech/hybrid-cloud/toolkits/hyperv-toolkit/STAGES.md)
- [Toolkit inventory generator](D:/git/tierpoint/prodtech/hybrid-cloud/toolkits/hyperv-toolkit/scripts/tools/Generate-AnsibleFromProductLabsConfig.ps1)
- [VMM physical profile gate](D:/git/tierpoint/prodtech/hybrid-cloud/toolkits/hyperv-toolkit/src/ansible/roles/scvmm_fabric/tasks/main.yml)
- [VMM bare-metal task](D:/git/tierpoint/prodtech/hybrid-cloud/toolkits/hyperv-toolkit/src/ansible/roles/scvmm_bmd/tasks/main.yml)

Vendor references checked on 2026-09-10:
- [Dell OME host requirements](https://www.dell.com/support/manuals/en-us/dell-openmanage-enterprise/ome_p_4_7_online_help_user_guide/host-system-requirements?guid=guid-54cbd632-cf9e-40b1-8420-085d49196e10&lang=en-us)
- [SDN deployment through VMM](https://learn.microsoft.com/en-us/system-center/vmm/deploy-sdn?view=sc-vmm-2025)
- [Network Controller with Failover Clustering](https://learn.microsoft.com/en-us/windows-server/networking/sdn/technologies/network-controller/network-controller-failover-clustering)
- [SDN script deployment](https://learn.microsoft.com/en-us/windows-server/networking/sdn/deploy/deploy-a-software-defined-network-infrastructure-using-scripts)
- [VMM bare-metal deployment](https://learn.microsoft.com/en-us/system-center/vmm/hyper-v-bare-metal?view=sc-vmm-2025)
- [VMM HA planning](https://learn.microsoft.com/en-us/system-center/vmm/plan-ha-install?view=sc-vmm-2025)
- [SCOM requirements](https://learn.microsoft.com/en-us/system-center/scom/system-requirements?view=sc-om-2025)
- [SCOM HA and disaster recovery](https://learn.microsoft.com/en-us/system-center/scom/plan-hadr-design?view=sc-om-2025)
- [WAC Virtualization Mode preview](https://learn.microsoft.com/en-us/windows-server/manage/windows-admin-center/virtualization-mode-overview)
- [System Center licensing](https://www.microsoft.com/en-us/licensing/product-licensing/system-center)
- [Windows Server licensing guidance](https://www.microsoft.com/licensing/guidance/Windows-Server-2025)

The live Surveyor entry page returned HTTP 200. Browser automation was unavailable in this session; the management journey was reviewed through its local website source and fact-checked question catalog. Source presence is not runtime acceptance.
