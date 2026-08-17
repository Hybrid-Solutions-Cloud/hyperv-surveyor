// This file is generated from HyperV_Management_Plane_Comparison.xlsx.
// Run npm run generate:management after changing the workbook.

export const MANAGEMENT_WORKBOOK = {
  "generatedFrom": "HyperV_Management_Plane_Comparison.xlsx",
  "decisionQuestions": [
    {
      "id": "airGap",
      "question": "Does the tenant require an air-gapped or sovereign environment with no outbound internet?",
      "ifYes": "ELIMINATE Arc-enabled SCVMM. Choose SCVMM, or Classic + WAC aMode.",
      "ifNo": "Arc stays on the table. Continue to Q2.",
      "why": "Arc requires persistent outbound 443 and agents must check in. There is no disconnected mode. This is a hard architectural stop, not a preference."
    },
    {
      "id": "bareMetal",
      "question": "Do you need to provision hosts from bare metal (BMC/PXE) as a repeatable workflow?",
      "ifYes": "SCVMM is the ONLY option. Nothing else does this.",
      "ifNo": "All planes remain viable. Continue to Q3.",
      "why": "Bare-metal host provisioning via BMC/IPMI + WDS with physical computer profiles exists only in SCVMM. WAC (either mode) requires an OS already installed and domain-joined."
    },
    {
      "id": "tenantSelfService",
      "question": "Do tenants get self-service, quotas, or a delegated portal?",
      "ifYes": "SCVMM (Clouds + self-service roles) or Arc-enabled SCVMM (Azure RBAC). Nothing else has it.",
      "ifNo": "Classic or WAC become viable. Continue to Q4.",
      "why": "Classic RBAC is effectively 'are you a local administrator'. WAC's JEA roles are connection-scoped, not tenant-scoped with quotas. There is no middle option."
    },
    {
      "id": "pureIntegration",
      "question": "Do you need array-aware storage integration with Pure — classification, SAN-copy rapid provisioning?",
      "ifYes": "SCVMM (SMI-S/SMP provider). WAC aMode gives visibility only.",
      "ifNo": "WAC aMode's Pure extension may be enough. Continue to Q5.",
      "why": "The Pure SMI-S/SMP provider only plugs into SCVMM. The Pure WAC extension gives monitoring, volume and initiator management, but no placement intelligence. vMode has NO Pure path at all today."
    },
    {
      "id": "drs",
      "question": "Do you need a DRS equivalent — automatic load balancing across the cluster?",
      "ifYes": "SCVMM Dynamic Optimization. Nothing else has it.",
      "ifNo": "Classic Node Fairness may suffice. Continue to Q6.",
      "why": "Node Fairness is threshold-based rebalancing on join plus an optional 30-minute interval. Dynamic Optimization is scheduled (10-1440 min) with a 1-5 aggressiveness scale. Neither is continuous predictive DRS — set expectations."
    },
    {
      "id": "migration",
      "question": "Are you converting VMs FROM VMware as part of the engagement?",
      "ifYes": "SCVMM (V2V, ~4x faster in 2025) or a third party. Budget it separately.",
      "ifNo": "Continue to Q7.",
      "why": "Classic has ZERO native V2V. This is a tooling decision independent of which plane runs the fabric day-to-day."
    },
    {
      "id": "largeFabric",
      "question": "Is this fabric larger than roughly 50 hosts?",
      "ifYes": "SCVMM today. Track WAC vMode for when it reaches GA.",
      "ifNo": "Prefer Classic + WAC vMode if the production-readiness answer permits it; otherwise use aMode. Continue to Q8.",
      "why": "Microsoft's own guidance puts WAC Administration Mode at 1-50 hosts. vMode targets 1,000 hosts / 25,000 VMs — the same ceiling as SCVMM — but is Public Preview."
    },
    {
      "id": "smallEdge",
      "question": "Is this a 2-4 node edge or small dedicated stack?",
      "ifYes": "Classic + WAC aMode. Do NOT license System Center for this.",
      "ifNo": "SCVMM is justified. Continue to Q9.",
      "why": "System Center Datacenter adds ~59% to your Microsoft host licensing plus a SQL Server. On a 2-node edge cluster that overhead is indefensible."
    },
    {
      "id": "azureReady",
      "question": "Does the tenant already live in Azure, and will they accept an Azure dependency?",
      "ifYes": "Layer Arc-enabled SCVMM on top as an upsell. The connector is free.",
      "ifNo": "Stop at SCVMM. Do not introduce an Azure dependency the tenant did not ask for.",
      "why": "Arc is additive, not alternative — it sits ON TOP of SCVMM. It adds Azure RBAC, Update Manager, Defender, Monitor and Cost Management, metered per VM per month."
    },
    {
      "id": "productionSoon",
      "question": "Is the deployment going into production before mid-2027?",
      "ifYes": "Do NOT select WAC vMode. It is Public Preview with no HA design and self-signed certs only.",
      "ifNo": "vMode is a legitimate candidate — re-verify GA, HA, CA certs and Pure support first.",
      "why": "vMode is the right strategic bet and the wrong thing to sign a SOW against in 2026. Revisit at the 2027 planning cycle."
    }
  ],
  "decisionPatterns": [
    {
      "situation": "Core service-provider multi-tenant fabric",
      "answer": "SCVMM 2025 as the fabric of record, with WAC aMode alongside as the day-2 GUI and Pure visibility layer.",
      "because": "SCVMM is the only plane that does bare-metal provisioning, tenant clouds with quotas, Pure array integration and V2V. Those four are table stakes for the business."
    },
    {
      "situation": "Tenant already in Azure, accepts the dependency",
      "answer": "Add Arc-enabled SCVMM on top as a paid upsell.",
      "because": "The connector is free. You are selling Azure RBAC self-service, Update Manager, Defender and Cost Management — priced per VM per month."
    },
    {
      "situation": "Air-gapped or sovereign tenant",
      "answer": "SCVMM + WAC vMode where its current gaps are acceptable; otherwise use aMode. Arc is off the table entirely.",
      "because": "Arc requires persistent outbound 443 with no disconnected mode. This is architectural, not negotiable."
    },
    {
      "situation": "2-4 node edge or small dedicated stack",
      "answer": "Classic + WAC vMode when production readiness permits; otherwise use aMode. Do not licence System Center.",
      "because": "System Center adds ~59% to Microsoft host licensing plus a SQL Server. Indefensible at that size."
    },
    {
      "situation": "Anything going live before mid-2027",
      "answer": "Do not select WAC vMode.",
      "because": "Public Preview, no HA design, self-signed certs only, no Pure path. Right bet, wrong year."
    },
    {
      "situation": "Lab / evaluation track for 2027",
      "answer": "Stand up WAC vMode now and re-assess at the 2027 planning cycle.",
      "because": "Gate the re-assessment on four things: GA, a documented HA design, CA certificate support, and a Pure Storage integration path."
    }
  ],
  "planeGuides": [
    {
      "plane": "1. Classic\n(Hyper-V Mgr + FCM + PowerShell)",
      "pros": "+  Zero incremental licence cost — it is in the box\n+  No management server to build, patch, licence or make highly available\n+  Deepest PowerShell surface of any plane\n+  Fully air-gap capable, zero Azure dependency\n+  Nothing extra to upgrade — lifecycle is just Windows Server's\n+  Cluster-Aware Updating is genuinely good and free\n+  Shielded VMs / HGS fully supported natively",
      "cons": "–  No central inventory at all — the single biggest shock for vCenter-trained staff\n–  RBAC is effectively local Administrators membership\n–  No bare-metal provisioning, no templates, no library, no self-service\n–  ZERO native VMware V2V\n–  Cluster Sets deprecated in WS2025 — the multi-cluster story is dead\n–  No Pure Storage integration beyond the REST SDK\n–  GPU-P and nested virt are PowerShell-only, no GUI\n–  Capacity planning and alerting are DIY scripting",
      "pickWhen": "2-4 node edge sites, dedicated single-tenant stacks, lab and burn-in, or as the always-present fallback when a management plane is down.",
      "walkAwayWhen": "Any multi-tenant fabric, anything over ~2 clusters, or any engagement where the customer expects a vCenter-like experience."
    },
    {
      "plane": "2. SCVMM 2025",
      "pros": "+  The only plane with bare-metal host provisioning\n+  The only plane with a true DRS equivalent (Dynamic Optimization) and Power Optimization\n+  Clouds give a real on-prem tenant abstraction with quotas and self-service roles\n+  Pure Storage SMI-S/SMP: array-aware placement and SAN-copy rapid provisioning\n+  Native V2V from VMware, ~4x faster in the 2025 release\n+  Templates, hardware/guest profiles, service templates, library server\n+  Logical networks, MAC/IP pools, VIP templates, load balancer integration\n+  1,000 hosts / 25,000 VMs, supported to Jan 2035\n+  The easiest conceptual bridge for VMware-native staff — maps to vCenter almost 1:1\n+  Fully air-gap capable",
      "cons": "–  ~59% uplift on your Microsoft host licensing, per managed host core\n–  Requires SQL Server — Express is not supported for the VMM database\n–  You must make VMM itself highly available, plus the SQL behind it\n–  Its own upgrade cadence and Update Rollup discipline to maintain\n–  Dated console UX compared to WAC\n–  Microsoft is narrowing its Azure surface: SPF discontinued, Azure VM mgmt removed\n–  Only supports upgrade from VMM 2022 — no direct jump from 2016/2019",
      "pickWhen": "Any multi-tenant service-provider fabric. Anywhere you need bare-metal provisioning, tenant clouds, Pure array integration, or V2V. This is the default answer for the core business.",
      "walkAwayWhen": "2-4 node edge deployments where the licensing and SQL overhead cannot be justified."
    },
    {
      "plane": "3. WAC Administration Mode\n(2606, GA)",
      "pros": "+  Genuinely $0 — Microsoft states it explicitly\n+  Modern web GUI; low learning curve for VMware-native staff\n+  Best S2D day-2 experience available, including the HCI dashboard\n+  Extensible: Dell OMIMSWAC, HPE, Lenovo XClarity, and the Pure Storage extension\n+  VM Conversion extension gives a V2V path (preview)\n+  Storage Migration Service included\n+  Air-gap capable, no Azure dependency\n+  HA is documented and supported via Deploy-GatewayV2Ha",
      "cons": "–  Microsoft's own guidance caps it at roughly 1-50 hosts\n–  No tenant self-service, no quotas, no cloud abstraction\n–  No bare-metal provisioning, no VM templates\n–  CredSSP double-hop is a recurring security tradeoff\n–  Modern Lifecycle: you must upgrade within 30 days of each release to stay supported\n–  RBAC is coarse — connection-scoped, not tenant-scoped\n–  Pure extension gives visibility only, no placement intelligence",
      "pickWhen": "As the day-2 GUI and hardware/Pure visibility layer ALONGSIDE SCVMM, and as the primary plane for small dedicated or edge stacks.",
      "walkAwayWhen": "As the sole plane for a large multi-tenant fabric. It was not designed for that and Microsoft says so."
    },
    {
      "plane": "4. WAC Virtualization Mode\n(vMode — Public Preview 2)",
      "pros": "+  Genuinely $0\n+  Built for fleet scale: 1,000 hosts / 25,000 VMs, matching SCVMM's ceiling\n+  Stateful — PostgreSQL backend plus per-host agents enable true parallel operations\n+  Auto-configures constrained Kerberos instead of relying on CredSSP\n+  VM templates — the capability aMode never had\n+  First plane with a first-class GPU-P UI\n+  Resource Groups, Host Profiles, Network ATC intent templates\n+  Air-gap capable, no Azure dependency\n+  Clear evidence Microsoft is investing in the on-prem fabric story",
      "cons": "–  PUBLIC PREVIEW — not supported for production\n–  NO documented HA design at all, unlike aMode\n–  Self-signed 60-day certificates ONLY; CA certs not yet available\n–  Storage and Networking host profiles still unavailable in preview\n–  S2D / hyperconverged storage explicitly not available yet\n–  NO Pure Storage integration path today\n–  Managed hosts must be Datacenter edition, and onboarding forces a rolling VM-draining reboot\n–  Cannot coexist with aMode — Microsoft requires separate systems\n–  No bare-metal provisioning, no tenant self-service",
      "pickWhen": "Lab evaluation now. Re-assess at the 2027 planning cycle, gated on four things: GA, a documented HA design, CA certificate support, and a Pure Storage path.",
      "walkAwayWhen": "Anything going to production before mid-2027, and anything with a signed SLA behind it."
    },
    {
      "plane": "5. Arc-enabled SCVMM",
      "pros": "+  The connector, control plane and resource bridge are all FREE\n+  Real self-service through Azure RBAC — the best tenant portal of any plane\n+  VMs become ARM resources: first-party Terraform, Bicep and full REST\n+  Azure Update Manager for guest patching — the best of any plane\n+  Defender for Cloud gives real security posture management\n+  Azure Monitor, Cost Management, Activity Log audit trail\n+  Azure Lighthouse (free) enables cross-tenant delegated management\n+  Update Manager and Guest Config are FREE if hosts carry WS SA, PAYG, or Defender P2",
      "cons": "–  NOT air-gap capable — requires persistent outbound 443. Hard stop for sovereign tenants\n–  Additive only — you still need SCVMM underneath and must licence it\n–  Azure services are metered per VM per month and accumulate quickly\n–  Resource bridge consumes 4 vCPU / 32 GB / 100 GB of your capacity\n–  Static IPs only, 3 contiguous, plus an extensive firewall allow-list\n–  Max 15,000 VMs per SCVMM server connection\n–  Tenant must accept an Azure dependency and an Entra ID relationship\n–  Microsoft's own 'choose an Arc service' guide omits Arc-SCVMM entirely — Azure Local is the favoured path",
      "pickWhen": "As a per-tenant UPSELL on top of SCVMM, where the tenant already lives in Azure and wants one control plane across on-prem and cloud.",
      "walkAwayWhen": "Air-gapped or sovereign tenants, cost-sensitive tenants, or anywhere the customer has no existing Azure footprint."
    }
  ],
  "decisionCautions": [
    {
      "statement": "Arc is not an alternative to SCVMM — it sits ON TOP of it.",
      "explanation": "You still buy and run SCVMM underneath. Arc adds an Azure control plane; it does not replace the fabric manager."
    },
    {
      "statement": "WAC aMode and vMode cannot coexist on the same system.",
      "explanation": "Microsoft requires them on separate systems. Choosing vMode means standing up a second, parallel management estate."
    },
    {
      "statement": "WAC is not an alternative to SCVMM for a multi-tenant fabric.",
      "explanation": "Microsoft's own FAQ: they are complementary. WAC replaces the MMC snap-ins, not System Center's fabric and monitoring role."
    },
    {
      "statement": "The migration tool is a separate decision from the management plane.",
      "explanation": "You may run Classic day-to-day and still need SCVMM or a third party purely to convert VMs off VMware. Budget it separately."
    },
    {
      "statement": "Classic is not a 'cheaper SCVMM'.",
      "explanation": "It is a different operating model with no central inventory. Staff cost, not licence cost, is where the difference shows up."
    },
    {
      "statement": "Azure Local is not in this comparison, and that is deliberate.",
      "explanation": "It is a different product with its own hardware catalogue, billing model and Arc dependency. If it belongs on the table, it needs its own evaluation."
    }
  ],
  "featureMatrix": [
    {
      "category": "Core VM Ops",
      "capability": "VM lifecycle (create/delete/start/stop)",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Full",
        "arc-scvmm": "Full"
      },
      "vmwareVsphere8": "vSphere Client / PowerCLI",
      "vmwareVcf9": "vSphere Client / PowerCLI",
      "note": "All planes cover basic lifecycle. Classic = per-host console only."
    },
    {
      "category": "Core VM Ops",
      "capability": "Checkpoints (Standard + Production)",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Not documented in preview",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "Snapshot",
      "vmwareVcf9": "Snapshot (VSS-quiesced via Tools)",
      "note": "Production checkpoints are VSS/app-consistent - closer to a 'snapshot done right'."
    },
    {
      "category": "Core VM Ops",
      "capability": "Export / Import VM",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Partial",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "OVF/OVA export",
      "vmwareVcf9": "OVF/OVA export",
      "note": "Classic Export-VM/Import-VM is the baseline everything else wraps."
    },
    {
      "category": "Core VM Ops",
      "capability": "Live Migration (in-cluster)",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Full",
        "arc-scvmm": "Full"
      },
      "vmwareVsphere8": "vMotion",
      "vmwareVcf9": "vMotion",
      "note": "Full parity with vMotion."
    },
    {
      "category": "Core VM Ops",
      "capability": "Shared-nothing Live Migration",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Full",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "Enhanced vMotion (XVC)",
      "vmwareVcf9": "Enhanced vMotion (XVC)",
      "note": "Kerberos constrained delegation or cert auth required."
    },
    {
      "category": "Core VM Ops",
      "capability": "Storage Live Migration",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Partial",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "Storage vMotion",
      "vmwareVcf9": "Storage vMotion",
      "note": "Move-VMStorage / Move-VM -IncludeStorage."
    },
    {
      "category": "Core VM Ops",
      "capability": "Console access (VMConnect / Enhanced Session)",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Full",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "VM Web/Remote Console",
      "vmwareVcf9": "VM Web Console",
      "note": "Classic uses vmconnect.exe. Arc gives portal-based serial/RDP paths, not a true VM console."
    },
    {
      "category": "Core VM Ops",
      "capability": "Tenant-facing web console",
      "values": {
        "classic": "None",
        "scvmm": "Partial",
        "wac-admin": "Partial",
        "wac-virtual": "Partial",
        "arc-scvmm": "Full"
      },
      "vmwareVsphere8": "VM Web Console",
      "vmwareVcf9": "VCF Automation console",
      "note": "Arc/Azure portal is the only plane with a real delegated web console for end tenants."
    },
    {
      "category": "Core VM Ops",
      "capability": "Nested virtualization",
      "values": {
        "classic": "Scripted only",
        "scvmm": "Partial",
        "wac-admin": "Scripted only",
        "wac-virtual": "Scripted only",
        "arc-scvmm": "Scripted only"
      },
      "vmwareVsphere8": "Nested ESXi",
      "vmwareVcf9": "Nested ESXi",
      "note": "PowerShell only. No GUI in ANY plane - surprises VMware admins."
    },
    {
      "category": "Core VM Ops",
      "capability": "GPU - DDA passthrough",
      "values": {
        "classic": "Scripted only",
        "scvmm": "Partial",
        "wac-admin": "Partial",
        "wac-virtual": "Full",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "vGPU / DirectPath I/O",
      "vmwareVcf9": "Assignable Hardware / Private AI Foundation",
      "note": "vMode ships a dedicated GPU-P tool; Classic is 100% PowerShell."
    },
    {
      "category": "Core VM Ops",
      "capability": "GPU-P (partitioning)",
      "values": {
        "classic": "Scripted only",
        "scvmm": "Partial",
        "wac-admin": "Partial",
        "wac-virtual": "Full",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "NVIDIA vGPU profiles",
      "vmwareVcf9": "vGPU + Private AI Foundation; vMotion ~6x faster",
      "note": "vMode is the first plane with a first-class GPU-P UI."
    },
    {
      "category": "Cluster & Fabric",
      "capability": "Cluster creation from existing hosts",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Full",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "Create Cluster wizard",
      "vmwareVcf9": "Create Cluster wizard",
      "note": "vMode wizard can create a new failover cluster during onboarding."
    },
    {
      "category": "Cluster & Fabric",
      "capability": "Node add / evict",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Full",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "Add/Remove Host",
      "vmwareVcf9": "Add/Remove Host",
      "note": "Classic: Add-ClusterNode / Remove-ClusterNode."
    },
    {
      "category": "Cluster & Fabric",
      "capability": "Bare-metal host provisioning (BMC/PXE)",
      "values": {
        "classic": "None",
        "scvmm": "Full",
        "wac-admin": "None",
        "wac-virtual": "None",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "Auto Deploy / vLCM",
      "vmwareVcf9": "VCF Installer / ZTP (ESXi hosts only)",
      "note": "SCVMM ONLY. This is the single biggest fabric gap for Classic and WAC."
    },
    {
      "category": "Cluster & Fabric",
      "capability": "Multi-cluster / fabric-wide single pane",
      "values": {
        "classic": "None",
        "scvmm": "Full",
        "wac-admin": "Partial",
        "wac-virtual": "Full",
        "arc-scvmm": "Full"
      },
      "vmwareVsphere8": "vCenter / Enhanced Linked Mode",
      "vmwareVcf9": "VCF Fleet (Enhanced Linked Mode REMOVED)",
      "note": "Classic lost this: Cluster Sets is DEPRECATED in WS2025."
    },
    {
      "category": "Cluster & Fabric",
      "capability": "Cluster-Aware Updating (CAU)",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Full",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "vSphere Lifecycle Manager",
      "vmwareVcf9": "vLCM images only (baselines REMOVED) + Live Patch",
      "note": "Classic CAU is genuinely good - self-updating or orchestrated mode."
    },
    {
      "category": "Cluster & Fabric",
      "capability": "Host firmware / driver lifecycle (OEM)",
      "values": {
        "classic": "None",
        "scvmm": "Partial",
        "wac-admin": "Full (via extension)",
        "wac-virtual": "Partial",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "vLCM firmware baselines",
      "vmwareVcf9": "vLCM images, mixed-vendor clusters now allowed",
      "note": "WAC extensions (Dell OMIMSWAC, HPE, Lenovo XClarity) are the real path here."
    },
    {
      "category": "Cluster & Fabric",
      "capability": "Fault domains (rack/chassis/site)",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Partial",
        "wac-virtual": "Partial",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "Fault Domains / Host Groups",
      "vmwareVcf9": "Fault Domains / Host Groups",
      "note": "New-ClusterFaultDomain works well within a single cluster."
    },
    {
      "category": "Cluster & Fabric",
      "capability": "Availability sets ACROSS clusters",
      "values": {
        "classic": "None (deprecated)",
        "scvmm": "Partial",
        "wac-admin": "None",
        "wac-virtual": "Partial",
        "arc-scvmm": "Full"
      },
      "vmwareVsphere8": "vSphere HA across clusters",
      "vmwareVcf9": "VCF Fleet",
      "note": "Cluster Sets deprecated in WS2025 - do NOT pitch this for Classic."
    },
    {
      "category": "Cluster & Fabric",
      "capability": "VM affinity / anti-affinity rules",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Partial",
        "wac-virtual": "Partial",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "DRS affinity rules",
      "vmwareVcf9": "DRS affinity rules",
      "note": "Classic is arguably better: soft vs hard enforcement is explicit."
    },
    {
      "category": "Cluster & Fabric",
      "capability": "Dynamic Optimization (DRS equivalent)",
      "values": {
        "classic": "Partial",
        "scvmm": "Full",
        "wac-admin": "None",
        "wac-virtual": "None",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "DRS",
      "vmwareVcf9": "DRS (now in base VCF subscription)",
      "note": "Classic has basic Node Fairness only. SCVMM DO is the only true DRS analogue."
    },
    {
      "category": "Cluster & Fabric",
      "capability": "Power Optimization (host power-down)",
      "values": {
        "classic": "None",
        "scvmm": "Full",
        "wac-admin": "None",
        "wac-virtual": "None",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "DPM",
      "vmwareVcf9": "DPM",
      "note": "SCVMM only. Requires BMC out-of-band access."
    },
    {
      "category": "Cluster & Fabric",
      "capability": "CPU compatibility for migration",
      "values": {
        "classic": "Partial",
        "scvmm": "Full",
        "wac-admin": "Partial",
        "wac-virtual": "Partial",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "EVC",
      "vmwareVcf9": "EVC + Dynamic DirectPath",
      "note": "Per-VM flag, not a cluster-wide EVC baseline. Real operational difference."
    },
    {
      "category": "Cluster & Fabric",
      "capability": "Rolling OS upgrade of cluster",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Partial",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "vSphere rolling upgrade",
      "vmwareVcf9": "vLCM + Live Patch (often no reboot)",
      "note": "Cluster OS Rolling Upgrade, one major version per hop."
    },
    {
      "category": "Cluster & Fabric",
      "capability": "Max scale (hosts / VMs per mgmt instance)",
      "values": {
        "classic": "64 nodes / 8,000 VMs per cluster",
        "scvmm": "1,000 hosts / 25,000 VMs",
        "wac-admin": "~1-50 hosts (guidance)",
        "wac-virtual": "1,000 hosts / 25,000 VMs",
        "arc-scvmm": "15,000 VMs per SCVMM server"
      },
      "vmwareVsphere8": "2,000 hosts / 25,000 VMs (vCenter)",
      "vmwareVcf9": "128 hosts/cluster (verify on configmax)",
      "note": "vMode matches SCVMM's published ceiling - this is the headline vMode number."
    },
    {
      "category": "Storage",
      "capability": "S2D create (day 0)",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Not in preview",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "vSAN cluster enable",
      "vmwareVcf9": "vSAN ESA (OSA legacy)",
      "note": "vMode preview explicitly lists hyperconverged storage as NOT available yet."
    },
    {
      "category": "Storage",
      "capability": "S2D day-2 ops (volumes, drive replace)",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Not in preview",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "vSAN disk mgmt",
      "vmwareVcf9": "vSAN ESA + vSAN Storage Clusters",
      "note": "WAC aMode's HCI dashboard is the best S2D GUI experience today."
    },
    {
      "category": "Storage",
      "capability": "SAN / FC / iSCSI presentation + MPIO",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Full",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "VMFS datastore on FC/iSCSI",
      "vmwareVcf9": "FC VMFS/NFSv3 greenfield; iSCSI brownfield only",
      "note": "Native Windows features. Works identically under all on-prem planes."
    },
    {
      "category": "Storage",
      "capability": "Storage classification + array provider (SMI-S/SMP)",
      "values": {
        "classic": "None",
        "scvmm": "Full",
        "wac-admin": "None",
        "wac-virtual": "None",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "VASA / SPBM",
      "vmwareVcf9": "SPBM; classic vVols DEPRECATED",
      "note": "SCVMM ONLY. This is where Pure Storage array-aware placement lives."
    },
    {
      "category": "Storage",
      "capability": "Rapid provisioning via SAN copy/clone",
      "values": {
        "classic": "None",
        "scvmm": "Full",
        "wac-admin": "None",
        "wac-virtual": "None",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "Array-based clone / VAAI",
      "vmwareVcf9": "Array-based clone / VAAI",
      "note": "SCVMM SAN-copy rapid provisioning - a real Pure Storage differentiator."
    },
    {
      "category": "Storage",
      "capability": "Storage QoS (min/max IOPS policy)",
      "values": {
        "classic": "Full (no GUI)",
        "scvmm": "Full",
        "wac-admin": "Partial",
        "wac-virtual": "Partial",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "SIOC / SPBM IOPS limits",
      "vmwareVcf9": "SPBM (SIOC + Storage DRS I/O REMOVED)",
      "note": "Classic has the full StorageQoS module but no policy editor UI."
    },
    {
      "category": "Storage",
      "capability": "Cluster Shared Volumes (CSV) mgmt",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Full",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "VMFS / Datastore",
      "vmwareVcf9": "VMFS / Datastore",
      "note": "CSV is the VMFS analogue."
    },
    {
      "category": "Storage",
      "capability": "Storage Migration Service (file server)",
      "values": {
        "classic": "Partial",
        "scvmm": "None",
        "wac-admin": "Full",
        "wac-virtual": "None",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "(no analogue)",
      "vmwareVcf9": "(no analogue)",
      "note": "Ships as a default WAC aMode extension."
    },
    {
      "category": "Storage",
      "capability": "Pure Storage FlashArray integration",
      "values": {
        "classic": "Scripted only (REST SDK)",
        "scvmm": "Full (SMI-S/SMP provider)",
        "wac-admin": "Full (WAC extension)",
        "wac-virtual": "None yet",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "Pure vSphere Plugin / VASA",
      "vmwareVcf9": "FC VMFS safe; next-gen vVols still maturing",
      "note": "CRITICAL FOR SERVICE PROVIDERS: Pure integrates via SCVMM SMI-S OR the WAC aMode extension. Neither works in vMode preview yet."
    },
    {
      "category": "Networking",
      "capability": "Virtual switch / SET teaming",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Partial (Network ATC)",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "vSphere Standard Switch",
      "vmwareVcf9": "vSphere Standard Switch",
      "note": "LBFO teaming is deprecated for vSwitch use - SET is the supported path."
    },
    {
      "category": "Networking",
      "capability": "Distributed-switch equivalent (consistent config)",
      "values": {
        "classic": "Scripted only",
        "scvmm": "Full (Logical Switch)",
        "wac-admin": "Partial",
        "wac-virtual": "Full (Network ATC intent)",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "vSphere Distributed Switch",
      "vmwareVcf9": "VDS 7.0+ only (N-VDS REMOVED)",
      "note": "Classic has no distributed-switch object; each host is configured independently."
    },
    {
      "category": "Networking",
      "capability": "Logical networks / VM networks abstraction",
      "values": {
        "classic": "None",
        "scvmm": "Full",
        "wac-admin": "None",
        "wac-virtual": "Partial",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "Port Groups / Network folders",
      "vmwareVcf9": "NSX VPC / Transit Gateway",
      "note": "SCVMM fabric construct. Classic has VLANs on vSwitches, nothing more."
    },
    {
      "category": "Networking",
      "capability": "Network virtualization / SDN (NC, SLB, Gateway)",
      "values": {
        "classic": "Scripted only",
        "scvmm": "Full",
        "wac-admin": "Partial (SDN extension)",
        "wac-virtual": "Not in preview",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "NSX",
      "vmwareVcf9": "NSX 9 + VPC constructs",
      "note": "WS2025 lets Network Controller run as a clustering role - no VM needed."
    },
    {
      "category": "Networking",
      "capability": "Hardware load balancer / VIP integration",
      "values": {
        "classic": "None",
        "scvmm": "Full",
        "wac-admin": "None",
        "wac-virtual": "None",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "NSX ALB / F5 integration",
      "vmwareVcf9": "NSX ALB",
      "note": "SCVMM VIP templates + service template wiring. Nothing else has it."
    },
    {
      "category": "Networking",
      "capability": "MAC / IP address pool management",
      "values": {
        "classic": "Scripted only",
        "scvmm": "Full",
        "wac-admin": "None",
        "wac-virtual": "Partial",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "(vCenter IP pools)",
      "vmwareVcf9": "(vCenter IP pools)",
      "note": "SCVMM MAC pools and static IP pools are a real operational win at scale."
    },
    {
      "category": "Networking",
      "capability": "Micro-segmentation / NSG-style policy",
      "values": {
        "classic": "Scripted only",
        "scvmm": "Full",
        "wac-admin": "Partial",
        "wac-virtual": "None",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "NSX DFW",
      "vmwareVcf9": "NSX DFW + per-tenant NSX Projects",
      "note": "WS2025 SDN added tag-based segmentation."
    },
    {
      "category": "Templates & Provisioning",
      "capability": "VM templates",
      "values": {
        "classic": "Scripted only",
        "scvmm": "Full",
        "wac-admin": "None",
        "wac-virtual": "Full (new in preview)",
        "arc-scvmm": "Full"
      },
      "vmwareVsphere8": "VM Template",
      "vmwareVcf9": "VM Template",
      "note": "vMode's template support is its most notable functional addition vs aMode."
    },
    {
      "category": "Templates & Provisioning",
      "capability": "Hardware profiles / guest OS profiles",
      "values": {
        "classic": "None",
        "scvmm": "Full",
        "wac-admin": "None",
        "wac-virtual": "Partial",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "Customization Specifications",
      "vmwareVcf9": "Config Profiles (Host Profiles DEPRECATED)",
      "note": "SCVMM library objects. No Classic equivalent."
    },
    {
      "category": "Templates & Provisioning",
      "capability": "Service templates / multi-tier app deploy",
      "values": {
        "classic": "None",
        "scvmm": "Full",
        "wac-admin": "None",
        "wac-virtual": "None",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "vApp",
      "vmwareVcf9": "vApp",
      "note": "SCVMM only. Note vApp itself has no other Hyper-V analogue."
    },
    {
      "category": "Templates & Provisioning",
      "capability": "Library / ISO + VHD catalog",
      "values": {
        "classic": "None",
        "scvmm": "Full",
        "wac-admin": "None",
        "wac-virtual": "Partial",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "Content Library",
      "vmwareVcf9": "Content Library",
      "note": "Classic = hand-managed file shares. No versioning, no indexing."
    },
    {
      "category": "Templates & Provisioning",
      "capability": "Self-service tenant portal",
      "values": {
        "classic": "None",
        "scvmm": "Full",
        "wac-admin": "None",
        "wac-virtual": "None",
        "arc-scvmm": "Full"
      },
      "vmwareVsphere8": "vRA / Aria Automation",
      "vmwareVcf9": "VCF Automation (supersedes vRA + Cloud Director)",
      "note": "SCVMM self-service roles OR Azure RBAC via Arc. Nothing in between."
    },
    {
      "category": "Templates & Provisioning",
      "capability": "Quotas per tenant",
      "values": {
        "classic": "None",
        "scvmm": "Full",
        "wac-admin": "None",
        "wac-virtual": "None",
        "arc-scvmm": "Full"
      },
      "vmwareVsphere8": "Resource Pool limits / vRA quotas",
      "vmwareVcf9": "VCF Automation Orgs/Projects",
      "note": "SCVMM role+member quotas, or Azure Policy/quota via Arc."
    },
    {
      "category": "Templates & Provisioning",
      "capability": "V2V migration FROM VMware",
      "values": {
        "classic": "None",
        "scvmm": "Full",
        "wac-admin": "Preview (VM Conversion ext.)",
        "wac-virtual": "None",
        "arc-scvmm": "Partial (Azure Migrate)"
      },
      "vmwareVsphere8": "(n/a)",
      "vmwareVcf9": "(n/a)",
      "note": "MOST IMPORTANT ROW FOR SERVICE PROVIDERS: Classic has ZERO native V2V. SCVMM V2V is 4x faster in 2025."
    },
    {
      "category": "Security & Multi-tenancy",
      "capability": "RBAC / delegated admin",
      "values": {
        "classic": "None (local Admins)",
        "scvmm": "Full",
        "wac-admin": "Partial (JEA roles)",
        "wac-virtual": "Partial",
        "arc-scvmm": "Full (Azure RBAC)"
      },
      "vmwareVsphere8": "vCenter roles & permissions",
      "vmwareVcf9": "VCF Automation Orgs/Projects (IWA REMOVED)",
      "note": "Classic RBAC is effectively 'are you a local admin'. Serious gap for a hoster."
    },
    {
      "category": "Security & Multi-tenancy",
      "capability": "Tenant isolation constructs",
      "values": {
        "classic": "Scripted only",
        "scvmm": "Full (Clouds)",
        "wac-admin": "None",
        "wac-virtual": "Partial",
        "arc-scvmm": "Full (subscriptions/RGs)"
      },
      "vmwareVsphere8": "Tenant vDC / vCD org",
      "vmwareVcf9": "VCF Automation Org + NSX Project",
      "note": "SCVMM 'Clouds' are the on-prem tenant abstraction."
    },
    {
      "category": "Security & Multi-tenancy",
      "capability": "Shielded VMs / HGS / vTPM",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Partial",
        "wac-virtual": "Partial",
        "arc-scvmm": "None"
      },
      "vmwareVsphere8": "vTPM + Key Provider",
      "vmwareVcf9": "vTPM + Key Provider",
      "note": "Classic covers the whole guarded-fabric flow natively."
    },
    {
      "category": "Security & Multi-tenancy",
      "capability": "Secure Boot / Credential Guard",
      "values": {
        "classic": "Full",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Full",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "Secure Boot / VBS",
      "vmwareVcf9": "Secure Boot / VBS",
      "note": "Gen2 VMs default to Secure Boot on."
    },
    {
      "category": "Security & Multi-tenancy",
      "capability": "Security posture / vuln management",
      "values": {
        "classic": "None",
        "scvmm": "Partial",
        "wac-admin": "Partial",
        "wac-virtual": "Partial",
        "arc-scvmm": "Full (Defender for Cloud)"
      },
      "vmwareVsphere8": "Aria Ops / Carbon Black",
      "vmwareVcf9": "VCF Operations Security dashboard",
      "note": "Only the Arc path gives real security posture management."
    },
    {
      "category": "Security & Multi-tenancy",
      "capability": "Credential delegation model",
      "values": {
        "classic": "Kerberos / CredSSP",
        "scvmm": "Run As accounts",
        "wac-admin": "CredSSP (security tradeoff)",
        "wac-virtual": "Auto-configured constrained Kerberos",
        "arc-scvmm": "Entra ID / managed identity"
      },
      "vmwareVsphere8": "SSO / SAML",
      "vmwareVcf9": "Federation / LDAPS (IWA REMOVED)",
      "note": "vMode auto-configures constrained Kerberos - a real improvement over aMode's CredSSP reliance."
    },
    {
      "category": "Security & Multi-tenancy",
      "capability": "Audit logging of admin actions",
      "values": {
        "classic": "Partial (Event Log)",
        "scvmm": "Full",
        "wac-admin": "Partial",
        "wac-virtual": "Partial",
        "arc-scvmm": "Full (Activity Log)"
      },
      "vmwareVsphere8": "vCenter Events/Tasks",
      "vmwareVcf9": "VCF Operations (native log ingest)",
      "note": "Azure Activity Log is the strongest audit trail of the five."
    },
    {
      "category": "Day-2 Ops",
      "capability": "Performance monitoring (live)",
      "values": {
        "classic": "Partial",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Full",
        "arc-scvmm": "Full"
      },
      "vmwareVsphere8": "vSphere Client charts",
      "vmwareVcf9": "VCF Operations (bundled)",
      "note": "S2D clusters get good native history; the graphs are a WAC feature, not Classic."
    },
    {
      "category": "Day-2 Ops",
      "capability": "Historical metrics retention",
      "values": {
        "classic": "Full (S2D only, 1 yr, PS only)",
        "scvmm": "Full (with SCOM)",
        "wac-admin": "Full (S2D dashboard)",
        "wac-virtual": "Full",
        "arc-scvmm": "Full (Azure Monitor)"
      },
      "vmwareVsphere8": "vCenter / Aria Operations",
      "vmwareVcf9": "VCF Operations (bundled, was Aria)",
      "note": "Get-ClusterPerformanceHistory gives 1 year with no DB or internet needed."
    },
    {
      "category": "Day-2 Ops",
      "capability": "Alerting / notification engine",
      "values": {
        "classic": "Scripted only",
        "scvmm": "Full (with SCOM)",
        "wac-admin": "Partial",
        "wac-virtual": "Partial",
        "arc-scvmm": "Full (Azure Monitor alerts)"
      },
      "vmwareVsphere8": "vCenter alarms",
      "vmwareVcf9": "VCF Operations (bundled)",
      "note": "Classic requires DIY on Event Viewer + Task Scheduler."
    },
    {
      "category": "Day-2 Ops",
      "capability": "Capacity planning & reporting",
      "values": {
        "classic": "Scripted only",
        "scvmm": "Full",
        "wac-admin": "Partial",
        "wac-virtual": "Partial",
        "arc-scvmm": "Full"
      },
      "vmwareVsphere8": "Aria Operations",
      "vmwareVcf9": "VCF Operations (bundled)",
      "note": "SCVMM + SCOM, or Azure Monitor workbooks."
    },
    {
      "category": "Day-2 Ops",
      "capability": "Guest OS patching orchestration",
      "values": {
        "classic": "None",
        "scvmm": "Partial",
        "wac-admin": "Partial",
        "wac-virtual": "Partial",
        "arc-scvmm": "Full (Update Manager)"
      },
      "vmwareVsphere8": "vRealize / third party",
      "vmwareVcf9": "vRealize / third party",
      "note": "Azure Update Manager is the standout here."
    },
    {
      "category": "Day-2 Ops",
      "capability": "Host patching orchestration",
      "values": {
        "classic": "Full (CAU)",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Full",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "vLCM",
      "vmwareVcf9": "vLCM images + Live Patch (no maint. mode)",
      "note": "CAU works well and is free."
    },
    {
      "category": "Day-2 Ops",
      "capability": "Backup integration (VSS / RCT)",
      "values": {
        "classic": "Full (API layer)",
        "scvmm": "Full (+ DPM)",
        "wac-admin": "Full",
        "wac-virtual": "Full",
        "arc-scvmm": "Full (+ Azure Backup)"
      },
      "vmwareVsphere8": "VADP",
      "vmwareVcf9": "VADP",
      "note": "Veeam/Commvault hook the same Hyper-V VSS+RCT API regardless of plane."
    },
    {
      "category": "Day-2 Ops",
      "capability": "DR / replication orchestration",
      "values": {
        "classic": "Full (Hyper-V Replica)",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Full (Replica tool)",
        "arc-scvmm": "Full (ASR)"
      },
      "vmwareVsphere8": "SRM / VCDR",
      "vmwareVcf9": "VCF Protection & Recovery (SRM absorbed)",
      "note": "Hyper-V Replica is native and free in every on-prem plane."
    },
    {
      "category": "Day-2 Ops",
      "capability": "Chargeback / showback",
      "values": {
        "classic": "None",
        "scvmm": "Partial",
        "wac-admin": "None",
        "wac-virtual": "None",
        "arc-scvmm": "Full (Cost Mgmt)"
      },
      "vmwareVsphere8": "Aria Operations / vCloud Usage",
      "vmwareVcf9": "VCF Operations Cost (bundled)",
      "note": "Real gap for a hoster unless you go Arc or build your own."
    },
    {
      "category": "Automation & Integration",
      "capability": "PowerShell coverage",
      "values": {
        "classic": "Full (deepest)",
        "scvmm": "Full",
        "wac-admin": "Partial",
        "wac-virtual": "Partial",
        "arc-scvmm": "Full (Az module)"
      },
      "vmwareVsphere8": "PowerCLI",
      "vmwareVcf9": "PowerCLI",
      "note": "Classic's PowerShell surface is the best of any plane - but has no inventory object model."
    },
    {
      "category": "Automation & Integration",
      "capability": "REST API",
      "values": {
        "classic": "None",
        "scvmm": "Partial (SPF discontinued)",
        "wac-admin": "Partial",
        "wac-virtual": "Partial (gateway API)",
        "arc-scvmm": "Full (ARM)"
      },
      "vmwareVsphere8": "vSphere REST API",
      "vmwareVcf9": "vSphere Automation API (legacy SDKs removed)",
      "note": "SPF is DISCONTINUED in System Center 2025 - Arc is the replacement."
    },
    {
      "category": "Automation & Integration",
      "capability": "Terraform provider",
      "values": {
        "classic": "Community only",
        "scvmm": "Community only",
        "wac-admin": "None",
        "wac-virtual": "None",
        "arc-scvmm": "Full (Microsoft AzAPI/AzureRM)"
      },
      "vmwareVsphere8": "Official VMware provider",
      "vmwareVcf9": "terraform-provider-vcf + vsphere (first-party)",
      "note": "Only the Arc path has a first-party, Microsoft-supported Terraform provider."
    },
    {
      "category": "Automation & Integration",
      "capability": "Ansible support",
      "values": {
        "classic": "Community (WinRM)",
        "scvmm": "Community",
        "wac-admin": "None",
        "wac-virtual": "None",
        "arc-scvmm": "Partial"
      },
      "vmwareVsphere8": "Official VMware collections",
      "vmwareVcf9": "Official VMware collections",
      "note": "No Microsoft-supported Ansible collection for Hyper-V fabric."
    },
    {
      "category": "Automation & Integration",
      "capability": "Bicep / ARM / IaC",
      "values": {
        "classic": "None",
        "scvmm": "None",
        "wac-admin": "None",
        "wac-virtual": "None",
        "arc-scvmm": "Full"
      },
      "vmwareVsphere8": "(n/a)",
      "vmwareVcf9": "(n/a)",
      "note": "Arc-enabled SCVMM exposes VMs as ARM resources - real IaC."
    },
    {
      "category": "Automation & Integration",
      "capability": "Third-party ecosystem depth",
      "values": {
        "classic": "Partial",
        "scvmm": "Full",
        "wac-admin": "Full",
        "wac-virtual": "Thin (preview)",
        "arc-scvmm": "Growing"
      },
      "vmwareVsphere8": "Very deep",
      "vmwareVcf9": "Very deep, but HCL narrowed in 9.x",
      "note": "Backup vendors are plane-agnostic; hardware vendors are WAC-extension-centric."
    },
    {
      "category": "Platform / Operational",
      "capability": "HA of the management plane itself",
      "values": {
        "classic": "N/A - none required",
        "scvmm": "Requires HA VMM + SQL AG",
        "wac-admin": "Active/passive cluster role",
        "wac-virtual": "NOT DOCUMENTED (preview gap)",
        "arc-scvmm": "Azure-hosted (Microsoft HA)"
      },
      "vmwareVsphere8": "vCenter HA / VCHA",
      "vmwareVcf9": "vCenter HA / VCHA",
      "note": "BIGGEST vMode RISK: no HA story published as of Aug 2026."
    },
    {
      "category": "Platform / Operational",
      "capability": "Required supporting infrastructure",
      "values": {
        "classic": "None (AD recommended)",
        "scvmm": "SQL Server + VMM server(s) + Library",
        "wac-admin": "Gateway server + cert",
        "wac-virtual": "Gateway + PostgreSQL + per-host agents",
        "arc-scvmm": "Resource bridge VM (4 vCPU/32GB/100GB) + SCVMM"
      },
      "vmwareVsphere8": "vCenter appliance",
      "vmwareVcf9": "vCenter + NSX + SDDC Mgr + Ops + Automation",
      "note": "vMode's PostgreSQL + agent model is a real departure from stateless WAC."
    },
    {
      "category": "Platform / Operational",
      "capability": "Certificate / PKI requirement",
      "values": {
        "classic": "Optional",
        "scvmm": "Required (Run As, HTTPS)",
        "wac-admin": "CA cert or 60-day self-signed",
        "wac-virtual": "Self-signed ONLY in preview",
        "arc-scvmm": "Azure-managed"
      },
      "vmwareVsphere8": "vCenter certs",
      "vmwareVcf9": "vCenter certs",
      "note": "vMode preview cannot use a CA-issued cert yet. Blocker for production."
    },
    {
      "category": "Platform / Operational",
      "capability": "Internet dependency / air-gap capable",
      "values": {
        "classic": "Fully air-gap capable",
        "scvmm": "Fully air-gap capable",
        "wac-admin": "Air-gap capable",
        "wac-virtual": "Air-gap capable",
        "arc-scvmm": "NOT air-gap capable"
      },
      "vmwareVsphere8": "Air-gap capable",
      "vmwareVcf9": "Air-gap capable (Fleet Depot side-load)",
      "note": "Arc requires persistent outbound 443. Hard stop for air-gapped tenants."
    },
    {
      "category": "Platform / Operational",
      "capability": "Azure dependency",
      "values": {
        "classic": "None",
        "scvmm": "None",
        "wac-admin": "Optional",
        "wac-virtual": "None",
        "arc-scvmm": "Mandatory"
      },
      "vmwareVsphere8": "None",
      "vmwareVcf9": "None",
      "note": "vMode is explicitly a non-Azure, self-hosted fabric manager."
    },
    {
      "category": "Platform / Operational",
      "capability": "Product maturity / GA status",
      "values": {
        "classic": "GA - decades",
        "scvmm": "GA - System Center 2025",
        "wac-admin": "GA - WAC 2606 (Jul 2026)",
        "wac-virtual": "PUBLIC PREVIEW 2 (Apr 2026)",
        "arc-scvmm": "GA - Nov 2023"
      },
      "vmwareVsphere8": "GA",
      "vmwareVcf9": "GA - VCF 9.1 (May 2026)",
      "note": "vMode is NOT production-ready as of Aug 2026. Plan for it, don't sell it."
    },
    {
      "category": "Platform / Operational",
      "capability": "Support lifecycle end date",
      "values": {
        "classic": "Tied to Windows Server 2025 (2034/2035)",
        "scvmm": "Mainstream 2030-01-09, Extended 2035-01-10",
        "wac-admin": "Modern Lifecycle - upgrade within 30 days",
        "wac-virtual": "Modern Lifecycle (preview, unsupported)",
        "arc-scvmm": "Modern Lifecycle (Azure)"
      },
      "vmwareVsphere8": "VCF lifecycle",
      "vmwareVcf9": "VCF 9.x EOS ~Jun 2031 (6+1 model)",
      "note": "System Center's 2035 date should quiet 'SCVMM is dead' objections."
    },
    {
      "category": "Platform / Operational",
      "capability": "Mgmt plane upgrade burden",
      "values": {
        "classic": "None (in-OS)",
        "scvmm": "High (VMM + SQL + UR cadence)",
        "wac-admin": "Medium (30-day upgrade window)",
        "wac-virtual": "Medium-High",
        "arc-scvmm": "Low (Microsoft-managed)"
      },
      "vmwareVsphere8": "Medium (VCSA upgrades)",
      "vmwareVcf9": "Lower - Live Patch + vCenter RDU",
      "note": "WAC's Modern Lifecycle 30-day rule is an underrated operational tax."
    },
    {
      "category": "Platform / Operational",
      "capability": "Microsoft strategic direction signal",
      "values": {
        "classic": "Stable / maintained",
        "scvmm": "Maintained, Azure surface narrowing",
        "wac-admin": "Actively invested",
        "wac-virtual": "New investment area",
        "arc-scvmm": "Strategic but Azure Local favored"
      },
      "vmwareVsphere8": "(n/a)",
      "vmwareVcf9": "Broadcom: VCF-only, subscription-only",
      "note": "Pattern: on-prem fabric -> WAC vMode + VMM; cloud governance -> Arc."
    },
    {
      "category": "Skills & GTM",
      "capability": "Learning curve for a VMware admin",
      "values": {
        "classic": "Steep (no vCenter analogue)",
        "scvmm": "Moderate (closest to vCenter)",
        "wac-admin": "Low (modern web UI)",
        "wac-virtual": "Low-Moderate",
        "arc-scvmm": "Low if Azure-fluent, else steep"
      },
      "vmwareVsphere8": "-",
      "vmwareVcf9": "Re-learn: Automation, VPCs, Supervisor",
      "note": "SCVMM is the easiest conceptual bridge for VMware-native staff and customers."
    },
    {
      "category": "Skills & GTM",
      "capability": "Learning curve for a VMware architect",
      "values": {
        "classic": "Moderate",
        "scvmm": "Low",
        "wac-admin": "Low",
        "wac-virtual": "Moderate",
        "arc-scvmm": "Moderate"
      },
      "vmwareVsphere8": "-",
      "vmwareVcf9": "Re-learn: new tenancy + networking model",
      "note": "Architects map SCVMM->vCenter, Clouds->vDC, DO->DRS almost 1:1."
    },
    {
      "category": "Skills & GTM",
      "capability": "Fit for service-provider multi-tenant hosting",
      "values": {
        "classic": "Poor",
        "scvmm": "Strong",
        "wac-admin": "Weak",
        "wac-virtual": "Promising, not yet",
        "arc-scvmm": "Strong (if tenants accept Azure)"
      },
      "vmwareVsphere8": "-",
      "vmwareVcf9": "VCSP program now invite-only",
      "note": "RECOMMENDATION: SCVMM as the fabric of record; prefer WAC vMode where current gaps are acceptable, with aMode as the production fallback; Arc optional per tenant."
    },
    {
      "category": "Skills & GTM",
      "capability": "Fit for single-tenant / dedicated private cloud",
      "values": {
        "classic": "Fair",
        "scvmm": "Strong",
        "wac-admin": "Strong",
        "wac-virtual": "Promising",
        "arc-scvmm": "Strong"
      },
      "vmwareVsphere8": "-",
      "vmwareVcf9": "Strong, if you accept subscription",
      "note": "Small dedicated stacks can run Classic + WAC aMode economically."
    },
    {
      "category": "Skills & GTM",
      "capability": "Fit for edge / small footprint",
      "values": {
        "classic": "Strong",
        "scvmm": "Poor (overhead)",
        "wac-admin": "Strong",
        "wac-virtual": "Moderate",
        "arc-scvmm": "Moderate"
      },
      "vmwareVsphere8": "-",
      "vmwareVcf9": "VCF Edge 9.1",
      "note": "2-node edge clusters do not justify SCVMM+SQL licensing."
    },
    {
      "category": "Skills & GTM",
      "capability": "Incremental licensing cost vs Classic",
      "values": {
        "classic": "Baseline ($0)",
        "scvmm": "+System Center per host + SQL",
        "wac-admin": "$0",
        "wac-virtual": "$0",
        "arc-scvmm": "+Azure consumption per VM/host"
      },
      "vmwareVsphere8": "-",
      "vmwareVcf9": "Per-core subscription, 16-core/CPU minimum",
      "note": "See the Cost Model tab for modelled figures."
    }
  ],
  "skuReference": [
    {
      "ref": "WS-DC-16",
      "product": "Windows Server 2025 Datacenter",
      "edition": "Datacenter",
      "channel": "Perpetual / Open ERP",
      "unit": "per 16-core server license",
      "price": "$6,771.00",
      "confidence": "HIGH - Microsoft pricing page",
      "priceDate": "Aug 2026",
      "source": "https://www.microsoft.com/en-us/windows-server/pricing",
      "note": "16-core minimum per server; 8-core minimum per socket. Unlimited Windows guest OSEs once all physical cores licensed."
    },
    {
      "ref": "WS-DC-2",
      "product": "Windows Server 2025 Datacenter",
      "edition": "Datacenter",
      "channel": "Perpetual / Open ERP",
      "unit": "per 2-core pack",
      "price": "$846.38",
      "confidence": "MED - derived (6771/8)",
      "priceDate": "Aug 2026",
      "source": "https://www.microsoft.com/en-us/windows-server/pricing",
      "note": "Derived from the 16-core figure. Use for hosts above 16 cores."
    },
    {
      "ref": "WS-STD-16",
      "product": "Windows Server 2025 Standard",
      "edition": "Standard",
      "channel": "Perpetual / Open ERP",
      "unit": "per 16-core server license",
      "price": "$1,176.00",
      "confidence": "HIGH - Microsoft pricing page",
      "priceDate": "Aug 2026",
      "source": "https://www.microsoft.com/en-us/windows-server/pricing",
      "note": "Grants only 2 virtual OSEs. Must re-license ALL cores again for every additional 2 VMs."
    },
    {
      "ref": "WS-STD-2",
      "product": "Windows Server 2025 Standard",
      "edition": "Standard",
      "channel": "Perpetual / Open ERP",
      "unit": "per 2-core pack",
      "price": "$147.00",
      "confidence": "MED - derived (1176/8)",
      "priceDate": "Aug 2026",
      "source": "https://www.microsoft.com/en-us/windows-server/pricing",
      "note": "Derived."
    },
    {
      "ref": "WS-DC-SPLA",
      "product": "Windows Server Datacenter",
      "edition": "Datacenter",
      "channel": "SPLA (hosting)",
      "unit": "per 2-core pack / month",
      "price": "$25.00",
      "confidence": "LOW - reseller midpoint of $22-28 range",
      "priceDate": "2026",
      "source": "https://redresscompliance.com/microsoft-spla-pricing-2026.html",
      "note": "SPLA list is contractually confidential. GET A QUOTE from your SPLA distributor before committing."
    },
    {
      "ref": "WS-STD-SPLA",
      "product": "Windows Server Standard",
      "edition": "Standard",
      "channel": "SPLA (hosting)",
      "unit": "per 2-core pack / month",
      "price": "$5.00",
      "confidence": "LOW - reseller midpoint of $4-6 range",
      "priceDate": "2026",
      "source": "https://redresscompliance.com/microsoft-spla-pricing-2026.html",
      "note": "Same caveat. SPLA pricing held flat for the Jan 2026 refresh (FX adjustments only)."
    },
    {
      "ref": "WS-PAYG",
      "product": "Windows Server 2025 pay-as-you-go via Azure Arc",
      "edition": "Std or DC (same rate)",
      "channel": "Azure Arc subscription",
      "unit": "per physical core / month",
      "price": "$33.58",
      "confidence": "MED-HIGH - $0.046/core/hr",
      "priceDate": "Aug 2026",
      "source": "https://learn.microsoft.com/azure/azure-arc/servers/billing-windows-server-pay-go",
      "note": "Microsoft docs confirm Standard and Datacenter bill at the SAME rate. No CPU core minimum. AVMA NOT available. RDS CALs still required."
    },
    {
      "ref": "WS-CAL-DEV",
      "product": "Windows Server 2025 Device CAL",
      "edition": "-",
      "channel": "Reseller retail",
      "unit": "per device",
      "price": "$29.99",
      "confidence": "LOW - reseller listing, no MS list price",
      "priceDate": "Aug 2026",
      "source": "https://www.cdw.com/product/microsoft-windows-server-2025-standard-license-1-device-cal/8143166",
      "note": "NOT needed in a SPLA hosting model - use SALs instead."
    },
    {
      "ref": "WS-CAL-RDS",
      "product": "Windows Server 2025 RDS User CAL",
      "edition": "-",
      "channel": "Reseller retail",
      "unit": "per user",
      "price": "$129.99",
      "confidence": "LOW-MED - single reseller listing",
      "priceDate": "Aug 2026",
      "source": "https://www.cdw.com/product/microsoft-windows-server-2025-remote-desktop-services-license-1-user-ca/8143188",
      "note": "RDS CALs are required even under Arc pay-as-you-go."
    },
    {
      "ref": "RDS-SAL",
      "product": "RDS Subscriber Access License",
      "edition": "-",
      "channel": "SPLA (hosting)",
      "unit": "per subscriber / month",
      "price": "$6.50",
      "confidence": "LOW - reseller midpoint of $5-8",
      "priceDate": "2026",
      "source": "https://redresscompliance.com/microsoft-spla-pricing-2026.html",
      "note": "The hosting-model equivalent of an RDS CAL."
    },
    {
      "ref": "SC-DC-16",
      "product": "System Center 2025 Datacenter",
      "edition": "Datacenter",
      "channel": "Perpetual + SA / Open",
      "unit": "per 16-core server license",
      "price": "$3,968.00",
      "confidence": "HIGH - Microsoft pricing datasheet",
      "priceDate": "Nov 2024 datasheet",
      "source": "https://www.microsoft.com/content/dam/microsoft/final/en-us/microsoft-brand/documents/System-Center-2025-Pricing-Datasheet.pdf",
      "note": "+10% vs System Center 2022. ALL physical cores of every managed host must be licensed."
    },
    {
      "ref": "SC-DC-2",
      "product": "System Center 2025 Datacenter",
      "edition": "Datacenter",
      "channel": "Perpetual + SA / Open",
      "unit": "per 2-core pack",
      "price": "$496.00",
      "confidence": "MED - derived (3968/8)",
      "priceDate": "Nov 2024",
      "source": "https://www.microsoft.com/content/dam/microsoft/final/en-us/microsoft-brand/documents/System-Center-2025-Pricing-Datasheet.pdf",
      "note": "Derived."
    },
    {
      "ref": "SC-STD-16",
      "product": "System Center 2025 Standard",
      "edition": "Standard",
      "channel": "Perpetual + SA / Open",
      "unit": "per 16-core server license",
      "price": "$1,455.00",
      "confidence": "HIGH - Microsoft pricing datasheet",
      "priceDate": "Nov 2024",
      "source": "https://www.microsoft.com/content/dam/microsoft/final/en-us/microsoft-brand/documents/System-Center-2025-Pricing-Datasheet.pdf",
      "note": "Only 2 managed OSEs. Uneconomical for dense hosting - Datacenter is effectively mandatory."
    },
    {
      "ref": "SC-STD-2",
      "product": "System Center 2025 Standard",
      "edition": "Standard",
      "channel": "Perpetual + SA / Open",
      "unit": "per 2-core pack",
      "price": "$181.88",
      "confidence": "MED - derived (1455/8)",
      "priceDate": "Nov 2024",
      "source": "https://www.microsoft.com/content/dam/microsoft/final/en-us/microsoft-brand/documents/System-Center-2025-Pricing-Datasheet.pdf",
      "note": "Derived."
    },
    {
      "ref": "SC-STD-CSP1",
      "product": "System Center 2025 Standard - 2 Core Pack",
      "edition": "Standard",
      "channel": "CSP NCE, 1-year term",
      "unit": "per 2-core pack / year",
      "price": "$57.00",
      "confidence": "LOW-MED - reseller catalog (SKU DG7GMGF0PP47)",
      "priceDate": "Aug 2026",
      "source": "https://o365hq.com/license/CSP-DG7GMGF0PP47-0003",
      "note": "CSP NCE is subscription-only - rights END at term end. Verify against Partner Center."
    },
    {
      "ref": "SC-STD-CSP3",
      "product": "System Center 2025 Standard - 2 Core Pack",
      "edition": "Standard",
      "channel": "CSP NCE, 3-year term",
      "unit": "per 2-core pack / 3 years",
      "price": "$143.00",
      "confidence": "LOW-MED - reseller catalog",
      "priceDate": "Aug 2026",
      "source": "https://o365hq.com/license/CSP-DG7GMGF0PP47-0003",
      "note": "Equivalent to ~$47.67/pack/yr."
    },
    {
      "ref": "SC-DC-SPLA",
      "product": "System Center Datacenter",
      "edition": "Datacenter",
      "channel": "SPLA (hosting)",
      "unit": "per 2-core pack / month",
      "price": "$21.00",
      "confidence": "LOW - reseller midpoint of $18-24",
      "priceDate": "2026",
      "source": "https://redresscompliance.com/microsoft-spla-pricing-2026.html",
      "note": "Required per managed host if using SCVMM/SCOM/SCCM on hosted infrastructure."
    },
    {
      "ref": "SC-STD-SPLA",
      "product": "System Center Standard",
      "edition": "Standard",
      "channel": "SPLA (hosting)",
      "unit": "per 2-core pack / month",
      "price": "$6.50",
      "confidence": "LOW - reseller midpoint of $5-8",
      "priceDate": "2026",
      "source": "https://redresscompliance.com/microsoft-spla-pricing-2026.html",
      "note": "Same caveat."
    },
    {
      "ref": "SQL-STD-CORE",
      "product": "SQL Server 2022/2025 Standard",
      "edition": "Standard",
      "channel": "Perpetual / Open",
      "unit": "per core",
      "price": "$1,859.00",
      "confidence": "MED - long-standing published list, third-party compiled",
      "priceDate": "2026",
      "source": "https://redresscompliance.com/sql-server-2022-licensing-a-comprehensive-guide",
      "note": "4-core minimum per VM/socket. SQL Server 2025 GA'd with NO pricing changes vs 2022."
    },
    {
      "ref": "SQL-ENT-CORE",
      "product": "SQL Server 2022/2025 Enterprise",
      "edition": "Enterprise",
      "channel": "Perpetual / Open",
      "unit": "per core",
      "price": "$7,128.00",
      "confidence": "MED - third-party compiled",
      "priceDate": "2026",
      "source": "https://redresscompliance.com/sql-server-2022-licensing-a-comprehensive-guide",
      "note": "Only needed if you want Always On AG for VMM DB HA."
    },
    {
      "ref": "WAC",
      "product": "Windows Admin Center (all modes)",
      "edition": "aMode + vMode",
      "channel": "Included with Windows",
      "unit": "per anything",
      "price": "$0.00",
      "confidence": "HIGH - Microsoft FAQ, explicit",
      "priceDate": "Aug 2026",
      "source": "https://learn.microsoft.com/windows-server/manage/windows-admin-center/understand/faq",
      "note": "'Windows Admin Center has no additional cost beyond Windows.' Licensed under a Windows Supplemental EULA."
    },
    {
      "ref": "ARC-CP",
      "product": "Azure Arc control plane (inventory, RBAC, tags, VM CRUD)",
      "edition": "-",
      "channel": "Azure",
      "unit": "per resource",
      "price": "$0.00",
      "confidence": "HIGH - Microsoft docs",
      "priceDate": "Aug 2026",
      "source": "https://learn.microsoft.com/azure/azure-arc/overview#pricing",
      "note": "Free. Includes the Arc-enabled SCVMM connector itself and the resource bridge."
    },
    {
      "ref": "ARC-BRIDGE",
      "product": "Azure Arc resource bridge",
      "edition": "-",
      "channel": "Azure",
      "unit": "per appliance",
      "price": "$0.00",
      "confidence": "HIGH - Microsoft docs",
      "priceDate": "Aug 2026",
      "source": "https://learn.microsoft.com/azure/azure-arc/overview#pricing",
      "note": "Free as a meter. Consumes 4 vCPU / 32GB RAM / 100GB on YOUR infrastructure."
    },
    {
      "ref": "AUM",
      "product": "Azure Update Manager (Arc-enabled server)",
      "edition": "-",
      "channel": "Azure PAYG",
      "unit": "per server / month",
      "price": "$5.00",
      "confidence": "MED - model official, rate from secondary sources",
      "priceDate": "Aug 2026",
      "source": "https://learn.microsoft.com/azure/update-manager/update-manager-faq#pricing",
      "note": "FREE if the machine has active WS Software Assurance, WS pay-as-you-go, or Defender for Servers P2."
    },
    {
      "ref": "DEF-P1",
      "product": "Microsoft Defender for Servers Plan 1",
      "edition": "P1",
      "channel": "Azure PAYG",
      "unit": "per server / month",
      "price": "$4.91",
      "confidence": "HIGH - Azure Retail Prices API",
      "priceDate": "Aug 2026",
      "source": "https://prices.azure.com/api/retail/prices",
      "note": "$0.00672/node/hour, East US."
    },
    {
      "ref": "DEF-P2",
      "product": "Microsoft Defender for Servers Plan 2",
      "edition": "P2",
      "channel": "Azure PAYG",
      "unit": "per server / month",
      "price": "$14.60",
      "confidence": "HIGH - Azure Retail Prices API",
      "priceDate": "Aug 2026",
      "source": "https://prices.azure.com/api/retail/prices",
      "note": "$0.02/node/hour. Unlocks free Update Manager + Change Tracking + Machine Config."
    },
    {
      "ref": "GUESTCFG",
      "product": "Azure Policy Guest Config + Change Tracking",
      "edition": "-",
      "channel": "Azure PAYG",
      "unit": "per server / month",
      "price": "$6.00",
      "confidence": "MED - model official, rate secondary",
      "priceDate": "Aug 2026",
      "source": "https://learn.microsoft.com/azure/cloud-adoption-framework/scenarios/hybrid/arc-enabled-servers/eslz-cost-governance",
      "note": "Bundles Automanage machine configuration. Free with WS SA / PAYG / Defender P2."
    },
    {
      "ref": "LAW-GB",
      "product": "Azure Monitor Log Analytics ingestion",
      "edition": "Analytics Logs",
      "channel": "Azure PAYG",
      "unit": "per GB",
      "price": "$2.30",
      "confidence": "HIGH - Azure Retail Prices API",
      "priceDate": "Aug 2026",
      "source": "https://prices.azure.com/api/retail/prices",
      "note": "First 5 GB/day free per workspace. VM Insights typically 1-3 GB/server/month (PLANNING ESTIMATE, not a Microsoft figure)."
    },
    {
      "ref": "BKP-PI",
      "product": "Azure Backup protected instance (on-prem, MARS/MABS)",
      "edition": "-",
      "channel": "Azure PAYG",
      "unit": "per instance / month",
      "price": "$10.00",
      "confidence": "HIGH - Azure Retail Prices API",
      "priceDate": "Aug 2026",
      "source": "https://prices.azure.com/api/retail/prices",
      "note": "Flat, no size tiers in the current meter. Storage billed separately."
    },
    {
      "ref": "BKP-GB",
      "product": "Azure Backup vault storage (Standard LRS)",
      "edition": "LRS",
      "channel": "Azure PAYG",
      "unit": "per GB / month",
      "price": "$0.0224",
      "confidence": "HIGH - Azure Retail Prices API",
      "priceDate": "Aug 2026",
      "source": "https://prices.azure.com/api/retail/prices",
      "note": "ZRS $0.028, GRS $0.0448, RA-GRS $0.0569."
    },
    {
      "ref": "ASR-AZ",
      "product": "Azure Site Recovery - replicate to Azure",
      "edition": "-",
      "channel": "Azure PAYG",
      "unit": "per protected instance / month",
      "price": "$25.00",
      "confidence": "HIGH - Azure Retail Prices API",
      "priceDate": "Aug 2026",
      "source": "https://prices.azure.com/api/retail/prices",
      "note": "Plus target storage and any failover compute."
    },
    {
      "ref": "ASR-SC",
      "product": "Azure Site Recovery - replicate to System Center",
      "edition": "-",
      "channel": "Azure PAYG",
      "unit": "per protected instance / month",
      "price": "$16.00",
      "confidence": "HIGH - Azure Retail Prices API",
      "priceDate": "Aug 2026",
      "source": "https://prices.azure.com/api/retail/prices",
      "note": "On-prem to on-prem DR target."
    },
    {
      "ref": "LIGHTHOUSE",
      "product": "Azure Lighthouse (cross-tenant delegated mgmt)",
      "edition": "-",
      "channel": "Azure",
      "unit": "per tenant",
      "price": "$0.00",
      "confidence": "HIGH - Microsoft docs",
      "priceDate": "Aug 2026",
      "source": "https://learn.microsoft.com/azure/lighthouse/concepts/cross-tenant-management-experience",
      "note": "Free. The mechanism for a service provider to manage customer-owned Azure tenants."
    },
    {
      "ref": "AZL-HOST",
      "product": "Azure Local host service fee",
      "edition": "-",
      "channel": "Azure",
      "unit": "per physical core / month",
      "price": "$10.00",
      "confidence": "MED - Microsoft Q&A, pricing page not scrapable",
      "priceDate": "Aug 2026",
      "source": "https://learn.microsoft.com/answers/a/1910705",
      "note": "WAIVED entirely with Azure Hybrid Benefit (1 SA-covered WS DC core = 1 Azure Local core)."
    },
    {
      "ref": "AZL-GUEST",
      "product": "Azure Local Windows Server guest subscription",
      "edition": "-",
      "channel": "Azure",
      "unit": "per physical core / month",
      "price": "$23.30",
      "confidence": "MED - Microsoft Q&A",
      "priceDate": "Aug 2026",
      "source": "https://learn.microsoft.com/answers/a/12805955",
      "note": "Only if running WS guests without your own WS Datacenter + SA licenses."
    },
    {
      "ref": "SA-RATE",
      "product": "Software Assurance (server products)",
      "edition": "-",
      "channel": "Volume Licensing",
      "unit": "% of license price / year",
      "price": "25.0%",
      "confidence": "MED - two independent analyst sources agree",
      "priceDate": "2026",
      "source": "https://upperedge.com/microsoft/microsoft-software-assurance-big-risk-for-a-small-reward/",
      "note": "NOT a Microsoft-published percentage. Note: unlimited virtualization on Datacenter is a BASE license right, NOT an SA benefit."
    }
  ],
  "vmwareTranslation": [
    {
      "vmware": "vCenter Server",
      "hyperv": "SCVMM (fabric) or WAC vMode (cluster fleet)",
      "fidelity": "Partial",
      "note": "No single 1:1. Classic has NO central inventory at all - biggest conceptual gap for VMware staff."
    },
    {
      "vmware": "vSphere Client",
      "hyperv": "WAC (Administration Mode) / VMM Console",
      "fidelity": "Good",
      "note": "WAC aMode is the closest modern web UI."
    },
    {
      "vmware": "ESXi Host Client",
      "hyperv": "Hyper-V Manager",
      "fidelity": "Good",
      "note": "Both are single-target, no aggregation."
    },
    {
      "vmware": "PowerCLI",
      "hyperv": "Hyper-V + FailoverClusters PowerShell modules",
      "fidelity": "Good",
      "note": "Comparable cmdlet depth, but no cross-host object model - you write the loops."
    },
    {
      "vmware": "vMotion",
      "hyperv": "Live Migration (Move-VM)",
      "fidelity": "Exact",
      "note": "Full parity."
    },
    {
      "vmware": "Storage vMotion",
      "hyperv": "Storage Migration (Move-VMStorage)",
      "fidelity": "Exact",
      "note": "Full parity."
    },
    {
      "vmware": "Enhanced vMotion (no shared storage)",
      "hyperv": "Shared-nothing Live Migration",
      "fidelity": "Exact",
      "note": "Full parity."
    },
    {
      "vmware": "vSphere HA",
      "hyperv": "Failover Clustering",
      "fidelity": "Exact",
      "note": "Restart-on-failure semantics are equivalent."
    },
    {
      "vmware": "Fault Tolerance (lockstep)",
      "hyperv": "NO EQUIVALENT",
      "fidelity": "None",
      "note": "Be explicit with customers. Nothing in Hyper-V does lockstep FT."
    },
    {
      "vmware": "DRS",
      "hyperv": "SCVMM Dynamic Optimization",
      "fidelity": "Partial",
      "note": "Classic only has basic Node Fairness. No predictive/what-if simulation in any plane."
    },
    {
      "vmware": "DPM (Distributed Power Mgmt)",
      "hyperv": "SCVMM Power Optimization",
      "fidelity": "Partial",
      "note": "SCVMM only, requires BMC."
    },
    {
      "vmware": "DRS affinity/anti-affinity",
      "hyperv": "Cluster Affinity Rules",
      "fidelity": "Exact+",
      "note": "Arguably better - soft vs hard enforcement is explicit."
    },
    {
      "vmware": "EVC",
      "hyperv": "Set-VMProcessor -CompatibilityForMigrationEnabled",
      "fidelity": "Partial",
      "note": "Per-VM flag, not a cluster-wide baseline."
    },
    {
      "vmware": "vSAN",
      "hyperv": "Storage Spaces Direct (S2D)",
      "fidelity": "Good",
      "note": "Conceptually equivalent HCI storage layer."
    },
    {
      "vmware": "VMFS",
      "hyperv": "Cluster Shared Volume (CSV) on NTFS/ReFS",
      "fidelity": "Good",
      "note": "CSV is the concurrent-access clustered filesystem."
    },
    {
      "vmware": "VMDK",
      "hyperv": "VHDX",
      "fidelity": "Exact",
      "note": "VHDX is the disk image format."
    },
    {
      "vmware": "vSphere Distributed Switch",
      "hyperv": "SET + SCVMM Logical Switch / Network ATC",
      "fidelity": "Partial",
      "note": "Classic has no distributed switch object at all."
    },
    {
      "vmware": "NSX",
      "hyperv": "Hyper-V Network Virtualization + SDN (NC/SLB/Gateway)",
      "fidelity": "Partial",
      "note": "Exists and works, but no first-party GUI policy manager outside WAC's SDN extension."
    },
    {
      "vmware": "NSX Distributed Firewall",
      "hyperv": "SDN NSGs / tag-based segmentation",
      "fidelity": "Partial",
      "note": "WS2025 added tag-based segmentation."
    },
    {
      "vmware": "Resource Pool",
      "hyperv": "Hyper-V Resource Pools",
      "fidelity": "Weak",
      "note": "Exists but rarely used, no GUI."
    },
    {
      "vmware": "vApp",
      "hyperv": "SCVMM Service Template",
      "fidelity": "Partial",
      "note": "SCVMM only."
    },
    {
      "vmware": "Snapshot",
      "hyperv": "Checkpoint (Standard or Production)",
      "fidelity": "Exact+",
      "note": "Production Checkpoints are VSS-based/app-consistent."
    },
    {
      "vmware": "Content Library",
      "hyperv": "SCVMM Library Server",
      "fidelity": "Good",
      "note": "Classic = hand-managed file shares."
    },
    {
      "vmware": "Tags",
      "hyperv": "NO GENERAL EQUIVALENT on-prem / Azure Tags via Arc",
      "fidelity": "Partial",
      "note": "SDN tag-based segmentation is networking-only."
    },
    {
      "vmware": "VAMI",
      "hyperv": "NO EQUIVALENT",
      "fidelity": "None",
      "note": "No appliance. sconfig is the nearest thing, and it's for the base OS."
    },
    {
      "vmware": "vCLS",
      "hyperv": "Failover Cluster Service (in-OS)",
      "fidelity": "Partial",
      "note": "Different architecture - kernel/quorum-based, not workload-VM agents."
    },
    {
      "vmware": "VCF / VVF",
      "hyperv": "Azure Local (nearest bundled stack)",
      "fidelity": "Partial",
      "note": "No equivalent bundled licensing construct for plain Hyper-V."
    },
    {
      "vmware": "vRealize / Aria Operations",
      "hyperv": "SCOM, or Azure Monitor via Arc",
      "fidelity": "Partial",
      "note": "SCOM for on-prem, Azure Monitor for the Arc path."
    },
    {
      "vmware": "vRealize / Aria Automation",
      "hyperv": "SCVMM self-service, or Azure RBAC via Arc",
      "fidelity": "Partial",
      "note": "Neither is as rich as vRA."
    },
    {
      "vmware": "Site Recovery Manager (SRM)",
      "hyperv": "Hyper-V Replica, or Azure Site Recovery",
      "fidelity": "Good",
      "note": "Hyper-V Replica is free and native."
    },
    {
      "vmware": "vSphere Lifecycle Manager",
      "hyperv": "Cluster-Aware Updating (CAU)",
      "fidelity": "Good",
      "note": "CAU handles the OS; firmware needs OEM WAC extensions."
    },
    {
      "vmware": "Auto Deploy",
      "hyperv": "SCVMM bare-metal provisioning",
      "fidelity": "Partial",
      "note": "SCVMM only. Uses BMC/IPMI + WDS."
    },
    {
      "vmware": "VASA / SPBM",
      "hyperv": "SCVMM Storage Classification (SMI-S/SMP)",
      "fidelity": "Partial",
      "note": "SCVMM only. This is the Pure Storage integration point."
    },
    {
      "vmware": "VAAI",
      "hyperv": "ODX (Offloaded Data Transfer)",
      "fidelity": "Good",
      "note": "Array-offloaded copy. Supported by Pure FlashArray."
    },
    {
      "vmware": "VADP",
      "hyperv": "Hyper-V VSS Writer + RCT",
      "fidelity": "Good",
      "note": "Backup vendors hook this identically across all planes."
    },
    {
      "vmware": "vCenter roles & permissions",
      "hyperv": "SCVMM User Roles, or Azure RBAC",
      "fidelity": "Partial",
      "note": "Classic has effectively none."
    },
    {
      "vmware": "Tenant vDC / vCloud Director Org",
      "hyperv": "SCVMM Cloud, or Azure subscription via Arc",
      "fidelity": "Partial",
      "note": "SCVMM 'Cloud' is the on-prem tenant abstraction."
    },
    {
      "vmware": "vGPU profiles",
      "hyperv": "GPU-P (GPU partitioning)",
      "fidelity": "Good",
      "note": "PowerShell-only until WAC vMode."
    },
    {
      "vmware": "Nested ESXi",
      "hyperv": "Nested virtualization",
      "fidelity": "Exact",
      "note": "Set-VMProcessor -ExposeVirtualizationExtensions."
    },
    {
      "vmware": "Cross-vCenter linked mode",
      "hyperv": "Cluster Sets (DEPRECATED WS2025)",
      "fidelity": "None",
      "note": "Do not build on Cluster Sets. Use SCVMM or vMode for multi-cluster."
    }
  ],
  "sources": [
    {
      "topic": "Windows Server pricing",
      "finding": "WS 2025 Datacenter $6,771 per 16-core server licence; Standard $1,176. Datacenter grants unlimited Windows guest OSEs once all physical cores are licensed. Minimums: 8 cores/socket, 16 cores/server.",
      "source": "https://www.microsoft.com/en-us/windows-server/pricing"
    },
    {
      "topic": "Windows Server Standard restack",
      "finding": "Standard grants 2 virtual OSEs. Every additional 2 VMs requires re-licensing ALL physical cores again — not incremental cores. A host needing 8 VMs requires 4x the full core stack.",
      "source": "https://learn.microsoft.com/answers/a/12670642"
    },
    {
      "topic": "Windows Server pay-as-you-go",
      "finding": "Standard and Datacenter bill at the SAME rate via Arc. No minimum core count. AVMA is NOT available under PAYG — each VM needs its own licence. RDS CALs are still required. $0.046/core/hr ≈ $33.58/core/month.",
      "source": "https://learn.microsoft.com/azure/azure-arc/servers/billing-windows-server-pay-go"
    },
    {
      "topic": "System Center pricing",
      "finding": "System Center 2025 Datacenter $3,968 per 16-core server; Standard $1,455. Both up ~10% vs System Center 2022.",
      "source": "https://www.microsoft.com/content/dam/microsoft/final/en-us/microsoft-brand/documents/System-Center-2025-Pricing-Datasheet.pdf"
    },
    {
      "topic": "System Center core rule",
      "finding": "ALL physical cores on every managed host must be licensed — 8/socket, 16/server minimum. Partial-core licensing is not permitted, even with cores parked via Intel SST-PP.",
      "source": "https://www.microsoft.com/en-us/licensing/product-licensing/system-center"
    },
    {
      "topic": "SCVMM not sold standalone",
      "finding": "'Components included in the server MLs are not available separately.' You cannot buy SCVMM alone — it is the full System Center suite or nothing, in every channel including SPLA.",
      "source": "https://www.microsoft.com/en-us/licensing/product-licensing/system-center"
    },
    {
      "topic": "System Center lifecycle",
      "finding": "System Center 2025 VMM: mainstream support ends 9 Jan 2030; extended support ends 10 Jan 2035. All System Center 2025 components share these dates.",
      "source": "https://learn.microsoft.com/lifecycle/products/system-center-2025-virtual-machine-manager"
    },
    {
      "topic": "SCVMM 2025 scale",
      "finding": "Tested maxima: 1,000 hosts, 25,000 VMs, 1,000 services, 1,000 user roles, 20 clouds, 2,000 virtual networks. Upgrade path is VMM 2022 → 2025 only.",
      "source": "https://learn.microsoft.com/system-center/vmm/system-requirements?view=sc-vmm-2025"
    },
    {
      "topic": "SCVMM 2025 changes",
      "finding": "SPF (Service Provider Foundation) is DISCONTINUED. Azure VM management from VMM and Azure Update Management v1 are no longer supported — Microsoft directs you to Arc-enabled SCVMM. ESXi→Hyper-V conversion is ~4x faster.",
      "source": "https://learn.microsoft.com/system-center/vmm/whats-new-in-vmm?view=sc-vmm-2025"
    },
    {
      "topic": "SQL for the VMM database",
      "finding": "SQL Server 2019/2022/2025 Standard, Enterprise or Datacenter. SQL Express is NOT listed as supported. Budget licensed SQL Standard at minimum. Some sources claim System Center bundles SQL runtime rights for its own databases — this could NOT be confirmed on a Microsoft page for 2025. Verify with your LSP.",
      "source": "https://learn.microsoft.com/system-center/vmm/system-requirements?view=sc-vmm-2025#sql-server"
    },
    {
      "topic": "WAC is free",
      "finding": "'Windows Admin Center has no additional cost beyond Windows. You can use Windows Admin Center with valid licenses of Windows Server or Windows client at no additional cost.' Applies to every install topology including vMode.",
      "source": "https://learn.microsoft.com/windows-server/manage/windows-admin-center/understand/faq"
    },
    {
      "topic": "WAC current release",
      "finding": "Windows Admin Center 2606, build 2.7.4, released 9 Jul 2026. Modern Lifecycle Policy — only the latest version is serviced, and you must upgrade within 30 days of a new release to stay supported.",
      "source": "https://learn.microsoft.com/windows-server/manage/windows-admin-center/support/release-history"
    },
    {
      "topic": "WAC vMode — what it is",
      "finding": "Virtualization Mode. Public Preview 2, announced 21 Apr 2026, no GA date. Stateful gateway backed by PostgreSQL plus a local agent on every managed Hyper-V host. Scale target 1,000 hosts / 25,000 VMs vs 'typically 1-50 hosts' for Administration Mode.",
      "source": "https://learn.microsoft.com/windows-server/manage/windows-admin-center/virtualization-mode-overview"
    },
    {
      "topic": "WAC vMode — separate install",
      "finding": "'You must install Windows Admin Center Administration Mode and Windows Admin Center Virtualization mode on separate systems.' They are mutually exclusive, not two views of one product.",
      "source": "https://learn.microsoft.com/windows-server/manage/windows-admin-center/virtualization-mode-overview"
    },
    {
      "topic": "WAC vMode — requirements",
      "finding": "Gateway: 4 vCPU / 8 GB RAM / 10 GB disk, Windows Server 2025 Std or DC, domain-joined with FQDN DNS. Managed hosts: Datacenter edition ONLY, plus Network ATC, Data Center Bridging, Hyper-V and Failover Clustering roles. Onboarding performs a rolling, VM-draining reboot of existing clusters.",
      "source": "https://learn.microsoft.com/windows-server/manage/windows-admin-center/install-virtualization-mode"
    },
    {
      "topic": "WAC vMode — the two gaps",
      "finding": "(1) NO HA deployment guidance published as of Aug 2026 — unlike Administration Mode, which has Deploy-GatewayV2Ha. (2) Certificates: self-signed 60-day ONLY; 'preinstalled certificates aren't available at this time.' Both are production blockers.",
      "source": "https://learn.microsoft.com/windows-server/manage/windows-admin-center/install-virtualization-mode"
    },
    {
      "topic": "WAC vMode — what it adds",
      "finding": "Resource Groups, Host Profiles (Compute/Storage/Networking), Network ATC intent templates, VM templates, GPU-P tooling, Hyper-V Replica. Auto-configures constrained Kerberos delegation instead of relying on CredSSP. Storage and Networking host profiles are NOT yet available in preview.",
      "source": "https://learn.microsoft.com/windows-server/manage/windows-admin-center/add-virtualization-mode-resources"
    },
    {
      "topic": "WAC in the Azure portal",
      "finding": "A third thing entirely — not aMode, not vMode. Microsoft-hosted reverse proxy via the HybridConnectivity resource provider; outbound-only, no inbound ports. Third-party extensions are NOT supported there. Enabling it REPLACES any standalone WAC gateway on those nodes.",
      "source": "https://learn.microsoft.com/windows-server/manage/windows-admin-center/azure/manage-hci-clusters"
    },
    {
      "topic": "Azure Local is not WAC-managed",
      "finding": "'Windows Admin Center doesn't support Azure Stack HCI OS deployment' and 'Azure Local infrastructure management isn't supported in Windows Admin Center.' Azure Local is deployed and managed through Arc and the Azure portal.",
      "source": "https://learn.microsoft.com/windows-server/manage/windows-admin-center/use/manage-hyper-converged"
    },
    {
      "topic": "Arc-enabled SCVMM",
      "finding": "GA Nov 2023. Requires an Arc resource bridge appliance (4 vCPU / 32 GB RAM / 100 GB free) on an SCVMM cloud or host group, static IPs only (3 contiguous), outbound TCP 443, minimum 100 Mbps. Max 15,000 VMs per SCVMM server. NOT supported for VMware-vCenter VMs managed by SCVMM.",
      "source": "https://learn.microsoft.com/azure/azure-arc/system-center-virtual-machine-manager/support-matrix-for-system-center-virtual-machine-manager"
    },
    {
      "topic": "Arc connector is free",
      "finding": "Arc control plane, the Arc-enabled SCVMM connector, the resource bridge, inventory, RBAC, tags and VM CRUD/power operations are all free. You pay only for the Azure services layered on top.",
      "source": "https://learn.microsoft.com/azure/azure-arc/overview#pricing"
    },
    {
      "topic": "Arc free-service waiver",
      "finding": "If a machine has active Windows Server Software Assurance or a WS subscription, is enrolled in Windows Server pay-as-you-go, or has Defender for Servers Plan 2, then Azure Update Manager, Change Tracking and Machine Configuration become FREE on that machine.",
      "source": "https://learn.microsoft.com/azure/azure-arc/servers/windows-server-management-overview#billing"
    },
    {
      "topic": "Arc is not air-gap capable",
      "finding": "Arc-enabled servers and SCVMM require live outbound connectivity; agents must check in and Update Manager only counts a machine as managed on days it is Connected. True disconnected operation exists only in Azure Local's separate disconnected-operations feature.",
      "source": "https://learn.microsoft.com/azure/azure-arc/resource-bridge/network-requirements"
    },
    {
      "topic": "Azure Lighthouse",
      "finding": "Free. Supports cross-tenant delegated management of Arc-enabled servers and SCVMM machines. Documented pattern is customer-owned tenants delegated to the provider's managing tenant. Caveat: Azure Backup cross-tenant support is incomplete for vault-based workloads.",
      "source": "https://learn.microsoft.com/azure/lighthouse/concepts/cross-tenant-management-experience"
    },
    {
      "topic": "Azure prices verified",
      "finding": "Defender P1 $0.00672/node/hr, P2 $0.02/node/hr, P2-with-MDATP-benefit $0.0137/node/hr; Log Analytics $2.30/GB (first 5 GB/day free per workspace); Azure Backup protected instance $10/month, Standard LRS storage $0.0224/GB/month; ASR to Azure $25/instance/month, to System Center $16/instance/month. All from the public Azure Retail Prices API, East US.",
      "source": "https://prices.azure.com/api/retail/prices"
    },
    {
      "topic": "SPLA Listed Provider rule",
      "finding": "From 1 Oct 2025 you may not run your own SPLA licences on Listed Provider infrastructure (Azure, AWS, Google Cloud, Alibaba). This does NOT affect a hoster running its own bare-metal — SPLA remains fully valid on infrastructure you own and operate. Self-owned infrastructure is unaffected.",
      "source": "https://www.microsoft.com/en-us/licensing/news/updated-licensing-rights-for-dedicated-cloud"
    },
    {
      "topic": "SPLA 2026 pricing",
      "finding": "Microsoft held Windows Server and SQL Server SPLA pricing unchanged for the January 2026 refresh (FX adjustments only).",
      "source": "https://www.bacloud.com/en/blog/213/microsoft-announces-spla-on-premises-price-increases-for-2026.html"
    },
    {
      "topic": "Azure Hybrid Benefit on Azure Local",
      "finding": "1 core licence of SA-enabled Windows Server Datacenter = 1 physical core of Azure Local capacity. AHB waives the Azure Local host service fee AND the Windows Server guest OS subscription fee. Requires hyperconverged (L1) deployment — NOT supported on L2/L3 external-storage configs. Once activated it cannot be deactivated.",
      "source": "https://learn.microsoft.com/azure/azure-local/concepts/azure-hybrid-benefit"
    },
    {
      "topic": "Cluster Sets deprecated",
      "finding": "Failover Clustering Cluster Sets is 'no longer in active feature development' in Windows Server 2025. It was the only Classic-plane path to a multi-cluster fabric view and cross-cluster availability sets. Treat any pitch built on it as end-of-life messaging.",
      "source": "https://learn.microsoft.com/windows-server/get-started/removed-deprecated-features-windows-server"
    },
    {
      "topic": "Classic scale limits",
      "finding": "Windows Server 2025 host: 1,024 running VMs per host, 2,048 logical processors, up to 4 PB RAM. Cluster: 64 nodes, 8,000 running VMs. With Cluster Sets deprecated, 8,000 VMs is the practical Classic ceiling.",
      "source": "https://learn.microsoft.com/windows-server/virtualization/hyper-v/maximum-scale-limits"
    },
    {
      "topic": "Classic has no RBAC",
      "finding": "There is no native granular RBAC in Hyper-V Manager or Failover Cluster Manager — access is effectively local Administrators group membership per host or cluster. AzMan exists but is a deprecated generic framework not integrated with Hyper-V or clustering.",
      "source": "https://learn.microsoft.com/windows/win32/secauthz/role-based-access-control"
    },
    {
      "topic": "Classic has no V2V",
      "finding": "Hyper-V Manager and PowerShell have NO native VMware conversion tool. Every path runs through SCVMM V2V, the WAC VM Conversion extension (preview), Azure Migrate, or a paid third party.",
      "source": "https://learn.microsoft.com/system-center/vmm/vm-convert-vmware"
    },
    {
      "topic": "Pure Storage — SCVMM",
      "finding": "Pure ships an SMI-S/SMP storage provider consumable via Add-SCStorageProvider. Listed as a supported array for VMM 2025 (Purity 5.3.0+ / 6.x). This enables storage classification and SAN-copy rapid provisioning.",
      "source": "https://learn.microsoft.com/system-center/vmm/supported-arrays"
    },
    {
      "topic": "Pure Storage — WAC",
      "finding": "Pure ships a Windows Admin Center extension giving a single-pane view of FlashArray: real-time IOPS/bandwidth/latency, data reduction, space management, volume and initiator management, host groups including CSV access. Built with the WAC engineering team. Not available in the Azure-portal WAC experience, and no vMode support yet.",
      "source": "https://learn.microsoft.com/windows-server/manage/windows-admin-center/extend/case-studies/purestorage"
    },
    {
      "topic": "Network Controller in WS2025",
      "finding": "Network Controller can now run as a Failover Clustering role directly on hosts — no dedicated VM required. A genuine Classic-plane SDN improvement, though still PowerShell/SDNExpress-driven with no first-party GUI outside WAC's SDN extension.",
      "source": "https://learn.microsoft.com/windows-server/networking/sdn/technologies/network-controller/network-controller-failover-clustering"
    },
    {
      "topic": "Microsoft's own positioning",
      "finding": "Microsoft states WAC and SCVMM are complementary: 'Windows Admin Center is intended to replace the traditional MMC snap-ins and the server admin experience. Windows Admin Center isn't intended to replace the monitoring aspects of SCVMM.'",
      "source": "https://learn.microsoft.com/windows-server/manage/windows-admin-center/understand/faq"
    }
  ],
  "caveats": [
    {
      "topic": "SPLA figures are estimates",
      "detail": "Microsoft does not publish SPLA list prices; they are contractually confidential and visible only to signed SPLA partners. Every SPLA rate in this workbook is a reseller-published midpoint of a range (WS Datacenter $22-28, WS Standard $4-6, System Center Datacenter $18-24, System Center Standard $5-8, RDS SAL $5-8, all per 2-core pack or per subscriber per month). Get a written quote from your SPLA distributor before Scenario B reaches a customer."
    },
    {
      "topic": "CAL prices are reseller retail",
      "detail": "Microsoft's own CAL page explicitly directs buyers to a reseller rather than showing a price. The CAL figures here are live reseller listings, not Microsoft list. In a SPLA hosting model you use SALs, not perpetual CALs, so this mostly does not apply to a self-hosted service provider."
    },
    {
      "topic": "Software Assurance rate is an analyst benchmark",
      "detail": "The 25%/year figure for server products is widely cited by two independent analyst sources but is not a Microsoft-published percentage. Also note: unlimited virtualisation on Datacenter is a BASE licence right, not an SA benefit — you do not need SA to run unlimited Windows guests on a fully licensed Datacenter host."
    },
    {
      "topic": "Two Azure rates are secondary-sourced",
      "detail": "Azure Update Manager (~$5/server/month) and Guest Configuration + Change Tracking (~$6/server/month): the billing MODEL is confirmed in Microsoft docs, but the exact rates come from third-party sources — the meters are not exposed in the public Retail Prices API. Validate in the Azure Pricing Calculator against your actual EA/CSP agreement. Note both are free under the SA / PAYG / Defender P2 waiver."
    },
    {
      "topic": "Log Analytics volume is a planning estimate",
      "detail": "Microsoft publishes no per-server GB figure for VM Insights. The 1-3 GB/server/month range used here is an industry rule of thumb. Verbose security-event or Sentinel collection will be materially higher. Measure it in a pilot before committing to a per-VM price."
    },
    {
      "topic": "Windows Server PAYG rate — one conflict resolved",
      "detail": "One analyst blog claims Datacenter PAYG is ~$67/core/month against ~$34 for Standard. This contradicts Microsoft's explicit statement that both editions bill at the same rate. We used $33.58 for both. If a large PAYG deal is on the table, confirm the meter directly."
    },
    {
      "topic": "System Center bundled SQL rights — unresolved",
      "detail": "Several third-party licensing guides assert that System Center Server MLs include limited SQL Server runtime rights for System Center's own databases, which would remove the SQL line from the Cost Model. This could not be confirmed on any Microsoft Learn or microsoft.com page for System Center 2025. The model includes the SQL cost conservatively. Confirm with your LSP — it is worth roughly $7.4k on a 4-core deployment."
    },
    {
      "topic": "vMode is a moving target",
      "detail": "Everything documented here about Virtualization Mode reflects Public Preview 2 as of Aug 2026. The HA gap, the certificate limitation, and the missing storage/networking host profiles are all preview-stage issues that Microsoft may close. Re-verify before the 2027 planning cycle."
    },
    {
      "topic": "Feature verdicts are documentation-based",
      "detail": "The Full/Partial/None verdicts come from Microsoft's published documentation, not from lab validation in the target environment. Where a capability is business-critical to a specific deal, prove it in the lab before it goes in a statement of work."
    }
  ],
  "advantages": [
    {
      "area": "Licensing",
      "claim": "Windows Server Datacenter includes UNLIMITED Windows guest OSE licensing once all physical cores are licensed.",
      "strength": "STRONG",
      "evidence": "Microsoft 'locks and limits' page: Standard = 2 VMs per licensed host; Datacenter = unlimited VMs. On vSphere/VCF the customer pays Broadcom for the platform AND Microsoft for every Windows guest — Windows Server licensing does not get cheaper because you run ESXi.",
      "guidance": "THE headline economic argument. On a Windows-heavy estate the guest OS licensing you must buy anyway collapses into the host licence. Works without attacking VMware's product quality at all — it is pure licensing math."
    },
    {
      "area": "Licensing",
      "claim": "Microsoft's core minimum is HALF of Broadcom's.",
      "strength": "STRONG",
      "evidence": "Windows Server: 8 cores/socket, 16 cores/server minimum. VCF/VVF: 16 cores per CPU minimum, even if the CPU has fewer. On a 2-socket 8-core/socket host, Windows bills 16 cores (exactly what you have); VCF bills 32.",
      "guidance": "Mechanically verifiable from both vendors' own docs. Worst on low-core-density hosts. One compliance firm measures 10-30% 'phantom cores' across the renewals they reviewed."
    },
    {
      "area": "Licensing",
      "claim": "Perpetual licensing is still available from Microsoft. Broadcom is subscription-only.",
      "strength": "STRONG",
      "evidence": "Windows Server 2025 and System Center 2025 both still sell perpetually, with an optional Arc pay-as-you-go subscription as a CHOICE. Broadcom ended perpetual VMware licensing and support renewal entirely.",
      "guidance": "Frame as optionality and capex/opex control, not as 'subscriptions are bad'. Some customers prefer subscription."
    },
    {
      "area": "Licensing",
      "claim": "SPLA remains open and stable for hosters. The VCSP program has contracted sharply.",
      "strength": "STRONG",
      "evidence": "SPLA is a standard, broadly available monthly-reporting model. Broadcom terminated the VCSP White Label / rental resale model (31 Oct 2025) and closed the VCSP Advantage program to an invite-only model (26 Jan 2026) — press reports as few as ~19 VCSP providers left in the entire US.",
      "guidance": "THE most relevant argument for service providers. This is not a price argument, it is a business-continuity argument: your ability to keep selling VMware capacity at all is now gated by Broadcom's partner-tier decisions."
    },
    {
      "area": "Licensing",
      "claim": "Documented customer disputes over Broadcom renewal pricing.",
      "strength": "MODERATE",
      "evidence": "AT&T's 2024 lawsuit ALLEGES a proposed 1,050% increase across ~75,000 VMs / ~8,600 servers. Tesco publicly cited 'abusive conduct'. Four European industry associations wrote jointly to EU leadership citing steep increases.",
      "guidance": "Say 'AT&T alleges', never 'Broadcom raised prices 1,050%'. Broadcom's counter-position is that full-VCF-bundle customers pay less overall. Present as 'public disputes exist', not as settled fact — overstating this loses the room."
    },
    {
      "area": "Security",
      "claim": "Shielded VMs + Host Guardian Service give an attestation-based guarded fabric.",
      "strength": "MODERATE-STRONG",
      "evidence": "TPM-backed attestation where even a fabric administrator cannot inspect a shielded VM's disk or state. Microsoft publishes a Guarded Fabric Planning Guide aimed specifically at HOSTING PROVIDERS. VMware has vTPM for encryption at rest but no equivalent attestation service preventing a rogue fabric admin from reaching tenant VM state.",
      "guidance": "Strong for a multi-tenant hosting trust story specifically. Much weaker for a single-tenant enterprise, where nobody is worried about their own admins."
    },
    {
      "area": "Security",
      "claim": "ESXi has a documented history as a named ransomware target.",
      "strength": "MODERATE",
      "evidence": "ESXiArgs (Feb 2023) mass-exploited an ESXi OpenSLP flaw — CISA alert AA23-039A. CVE-2024-37085: ESXi auto-grants full admin to any AD group literally named 'ESX Admins' without validating it exists; actively exploited by Storm-0506, Storm-1175, Octo Tempest and Manatee Tempest to deploy Akira and Black Basta.",
      "guidance": "The CVE and the CISA alert are independently verifiable — lead with those. Microsoft's claim that ESXi-targeting IR engagements 'more than doubled in three years' is Microsoft's own IR data about a competitor; use it as colour, not as the load-bearing claim."
    },
    {
      "area": "Scale",
      "claim": "Hyper-V wins the per-VM spec sheet by a wide margin.",
      "strength": "STRONG (for rebuttal only)",
      "evidence": "WS2025: 2,048 vCPUs/VM and 240 TB RAM/VM, vs vSphere 8's 768 vCPUs and 24 TB. Host: 2,048 logical processors vs 896. Both figures from each vendor's own published maximums.",
      "guidance": "Use ONLY to rebut 'Hyper-V doesn't scale'. Almost nothing needs a 768-vCPU VM, let alone 2,048. Do not lead with '4 petabytes of host RAM' — it reads as marketing even though it is Microsoft's published number. And know that vSphere wins cluster node count, 96 vs 64."
    },
    {
      "area": "DR",
      "claim": "Hyper-V Replica is free and built in. SRM is a separately licensed product.",
      "strength": "MODERATE",
      "evidence": "Hyper-V Replica ships with the Hyper-V role at no extra cost. On the VMware side, DR orchestration is now VCF Protection & Recovery (SRM absorbed), with local protection, remote replication, site recovery, multitenancy and cyber recovery carrying DIFFERENT commercial prerequisites.",
      "guidance": "Real cost advantage. But Hyper-V Replica is VM-level async replication, NOT SRM-grade orchestrated failover with runbooks. Do not claim parity — claim 'free DR-lite included' and price orchestration separately if the customer needs it."
    },
    {
      "area": "Ecosystem",
      "claim": "Backup vendor support is at parity, not second-class.",
      "strength": "STRONG",
      "evidence": "Veeam, Commvault, Rubrik and Cohesity all maintain first-class Hyper-V support in current products. Veeam maintains parallel Hyper-V and vSphere guides at the same doc version and has supported Hyper-V natively since the v6/v8 era.",
      "guidance": "Directly kills a common objection that is roughly a decade out of date."
    },
    {
      "area": "Ecosystem",
      "claim": "Linux guest support is a solved problem.",
      "strength": "STRONG",
      "evidence": "Linux Integration Services has been upstream in the mainline kernel since the 3.x series — it is not a bolt-on driver pack. Microsoft publishes current, maintained support matrices for RHEL, CentOS, Ubuntu, Debian, Oracle Linux, Rocky and SUSE. VMM 2025 added Ubuntu 24.04, RHEL 9, Debian 12/13, Oracle Linux 9, Rocky 8/9.",
      "guidance": "The 'Linux runs badly on Hyper-V' objection was legitimate around 2012-2014. It is not current. Enlightened I/O gives near-native disk and network performance."
    },
    {
      "area": "Platform",
      "claim": "Windows Server 2025 shipped real new Hyper-V capability.",
      "strength": "MODERATE",
      "evidence": "GPU-P now supports HA and LIVE MIGRATION of a GPU-partitioned VM. Dynamic Processor Compatibility auto-negotiates the max common CPU feature set across mixed-generation nodes. Network ATC gives intent-based, cluster-consistent network config. Workgroup clusters now support certificate-based auth — live migration with no AD domain.",
      "guidance": "Good 'Microsoft is actively investing and shipping' evidence. Not a headline economic argument, but it counters the 'Hyper-V is in maintenance mode' narrative."
    },
    {
      "area": "Platform",
      "claim": "Storage Replica and S2D are included in Datacenter.",
      "strength": "MODERATE",
      "evidence": "Storage Replica is unlimited in Datacenter (capped at 1 partnership / 2 TB in Standard). S2D is included at no separate licence.",
      "guidance": "Note the S2D-vs-vSAN cost argument has WEAKENED: vSAN is now bundled into the VCF 9 subscription rather than sold as a true add-on. Say 'included' not 'vSAN costs extra' — that was true pre-VCF-9 and is now only half true."
    },
    {
      "area": "Platform",
      "claim": "Hotpatching via Azure Arc reduces reboot cycles.",
      "strength": "MODERATE",
      "evidence": "Hotpatching for Windows Server 2025 is GA via Azure Arc, cutting reboot-requiring patch cycles.",
      "guidance": "Scope it correctly: this is a GUEST-OS patching win across a Windows VM fleet, not a hypervisor-patching win. Note VMware's Live Patch in VCF 9 now covers vmkernel, user-space, VMX and NSX — they have their own answer here."
    },
    {
      "area": "Hybrid",
      "claim": "Azure Hybrid Benefit has no vSphere equivalent.",
      "strength": "MODERATE",
      "evidence": "SA-covered Windows Server cores run Azure VMs at the Linux base compute rate, waive the Azure Local host fee, and cover AKS on Windows Server / Azure Local at no extra licence cost.",
      "guidance": "Only matters to customers with a real Azure trajectory. Strong when the pitch includes a hybrid story, irrelevant for pure on-prem."
    }
  ],
  "doNotClaim": [
    {
      "claim": "ReFS + Veeam Fast Clone is a Hyper-V advantage",
      "whyWrong": "FALSE. Fast Clone is a backup REPOSITORY filesystem feature. Veeam documents it for ReFS repositories backing up vSphere too. It works identically regardless of hypervisor."
    },
    {
      "claim": "Live migration without shared storage is unique to Hyper-V",
      "whyWrong": "FALSE. vMotion has supported migration without shared storage since vSphere 5.1. This is parity."
    },
    {
      "claim": "Hyper-V's soft/hard cluster affinity is better than DRS rules",
      "whyWrong": "FALSE. DRS has had 'must run on/with' (hard) and 'should run on/with' (soft) rules for years. Parity."
    },
    {
      "claim": "Production Checkpoints beat VMware snapshots",
      "whyWrong": "OVERSTATED. VMware snapshots are VSS-quiesced via VMware Tools on Windows guests. Functionally close to a wash."
    },
    {
      "claim": "Nested virtualization is a Hyper-V differentiator",
      "whyWrong": "FALSE. Nested ESXi is widely supported and heavily used for labs and CI. Parity."
    },
    {
      "claim": "vSAN costs extra, S2D is free",
      "whyWrong": "HALF TRUE AND NOW MISLEADING. vSAN is bundled into the VCF 9 subscription. The honest version is 'S2D is included in a licence you already need', not 'vSAN is an expensive add-on'."
    },
    {
      "claim": "Hyper-V is X% faster than ESXi (or vice versa)",
      "whyWrong": "NO CREDIBLE SOURCE EXISTS. There is no independent, methodologically sound, current benchmark comparing WS2025 Hyper-V to vSphere 8/VCF 9. Refuse the number in BOTH directions — and say so if a competitor cites one."
    },
    {
      "claim": "Lots of major hosters run Hyper-V",
      "whyWrong": "UNSUPPORTABLE. No credible public case studies at vSphere-comparable hosting scale were found. Use the SPLA-vs-VCSP program argument instead — that one is documented."
    },
    {
      "claim": "Free Hyper-V Server is still available",
      "whyWrong": "FALSE. Hyper-V Server 2019 was the last standalone free edition. The Hyper-V ROLE is free to enable, but a Windows Server licence is required. For operators already buying Datacenter, this is moot — but do not pretend otherwise."
    }
  ],
  "honestLosses": [
    {
      "area": "Fault Tolerance (lockstep)",
      "detail": "No Hyper-V equivalent exists. Clustering plus Replica gives fast failover with a brief interruption; FT gives lockstep dual execution with zero interruption. Structural — do not spin it."
    },
    {
      "area": "DRS maturity",
      "detail": "SCVMM Dynamic Optimization is scheduled and threshold-based. DRS is a continuous predictive placement engine refined over two decades. The gap has narrowed (DRS is now in the base VCF subscription, and vSphere Standard never had it) but it is real."
    },
    {
      "area": "Cluster node ceiling",
      "detail": "vSphere allows 96 nodes per cluster; Windows Failover Clustering allows 64. A genuine vSphere edge at extreme scale."
    },
    {
      "area": "Third-party ecosystem breadth",
      "detail": "vSphere has two more decades of storage, networking and monitoring partner integrations. Real and structural — do not contest it."
    },
    {
      "area": "Independent performance validation",
      "detail": "Neither side has a credible current public benchmark. This cuts both ways — refuse the number in both directions."
    },
    {
      "area": "Automation rework",
      "detail": "PowerCLI and the Hyper-V PowerShell modules are different APIs. Terraform and Ansible support for Hyper-V is community-maintained, not first-party. Broadcom ships its own terraform-provider-vcf. Quantify the rework honestly in the TCO."
    }
  ],
  "objections": [
    {
      "objection": "\"Hyper-V doesn't scale.\"",
      "verdict": "FALSE AS STATED",
      "answer": "WS2025 Hyper-V: 2,048 vCPUs/VM, 240 TB RAM/VM, 2,048 logical processors/host — against vSphere 8's 768 vCPUs and 24 TB RAM. Both from each vendor's own published maximums.",
      "concede": "Concede the one they may know: vSphere allows 96 nodes per cluster, Hyper-V 64. Say it before they do."
    },
    {
      "objection": "\"There's no DRS.\"",
      "verdict": "PARTIALLY TRUE — ANSWER HONESTLY",
      "answer": "Native Failover Clustering has Node Fairness: basic, free, threshold-based. A true DRS equivalent (Dynamic Optimization) requires System Center VMM and runs on a schedule (default every 10 min, 10-1440 configurable) with a 1-5 aggressiveness scale.",
      "concede": "Do NOT claim parity. DRS is a continuous, predictive placement engine refined over two decades. Note in passing that vSphere Standard never included DRS either — it needed Enterprise Plus, and now the VCF bundle."
    },
    {
      "objection": "\"The management tools are bad.\"",
      "verdict": "OUTDATED, WITH A KERNEL OF TRUTH",
      "answer": "Legacy Hyper-V Manager and the VMM console are genuinely dated. WAC 2606 is a modern web GUI, and WAC Virtualization Mode (vMode) is a purpose-built fleet manager targeting 1,000 hosts / 25,000 VMs.",
      "concede": "Be straight that vMode is still Public Preview. Overselling a preview product to an architect is how you lose the technical win."
    },
    {
      "objection": "\"Microsoft is killing System Center.\"",
      "verdict": "FALSE",
      "answer": "System Center 2025 GA'd November 2024 with an active Update Rollup cadence. Mainstream support runs to 9 Jan 2030, extended support to 10 Jan 2035.",
      "concede": "Concede the real trend: Microsoft IS narrowing System Center's Azure-facing surface. SPF is discontinued and native Azure VM management was removed in 2025, redirected to Arc. The product is supported; its cloud ambitions moved to Arc."
    },
    {
      "objection": "\"Linux doesn't run well on Hyper-V.\"",
      "verdict": "OUTDATED — CIRCA 2012 OBJECTION",
      "answer": "Linux Integration Services is upstream in the mainline kernel, not a bolt-on. Microsoft maintains current support matrices for RHEL, CentOS, Ubuntu, Debian, Oracle Linux, Rocky and SUSE. Enlightened I/O gives near-native disk and network performance.",
      "concede": "Offer to run their actual distro in the target lab. This objection dies fastest with a demo."
    },
    {
      "objection": "\"Nobody uses Hyper-V for hosting.\"",
      "verdict": "DO NOT FIGHT THIS ONE DIRECTLY",
      "answer": "No credible public case studies at vSphere-comparable hosting scale were found. Do not manufacture a customer list.",
      "concede": "REDIRECT to the program argument, which is documented: SPLA is open and stable; Broadcom terminated VCSP White Label resale and closed VCSP Advantage to invite-only with reportedly ~19 US providers left. Ask them who their provider will be in 2028."
    },
    {
      "objection": "\"Migration is too risky.\"",
      "verdict": "ADDRESS WITH TOOLING, NOT RISK DENIAL",
      "answer": "SCVMM V2V is ~4x faster in the 2025 release. Azure Migrate, the WAC VM Conversion extension (preview), and third parties (Veeam, Zerto, Carbonite, NAKIVO) all have paths. Shared-nothing live migration removes the identical-shared-storage blocker during transition.",
      "concede": "Frame as 'de-risked by phased coexistence', never 'risk-free'. Note the Classic plane has NO native V2V — the migration tool is a separate decision from the management plane."
    },
    {
      "objection": "\"The free hypervisor was discontinued.\"",
      "verdict": "TRUE — CONFIRM IT, DON'T DEFLECT",
      "answer": "Hyper-V Server 2019 was the last standalone free edition. The Hyper-V role is free to enable but requires a Windows Server licence underneath.",
      "concede": "For operators already buying Datacenter: you are buying Windows Server Datacenter regardless, for the unlimited-guest-OSE benefit. Say that plainly."
    },
    {
      "objection": "\"S2D isn't as good as vSAN.\"",
      "verdict": "DON'T FIGHT ON TECHNICAL MERITS",
      "answer": "No credible independent benchmark supports or refutes this cleanly in either direction.",
      "concede": "Redirect to licensing: S2D is included in a Datacenter licence you already need. But be careful — vSAN is now BUNDLED into VCF 9's subscription, so the old 'vSAN is an expensive add-on' line is stale. And offer SAN: the reference environment uses Pure today, and the sizing tool supports SAN, S2D or hybrid."
    },
    {
      "objection": "\"We'll lose our automation investment.\"",
      "verdict": "PARTIALLY TRUE — QUANTIFY IT",
      "answer": "PowerCLI and the Hyper-V PowerShell modules are different APIs. There is real rework. Terraform and Ansible have Hyper-V providers but they are COMMUNITY-maintained, not first-party — unlike Broadcom's own terraform-provider-vcf.",
      "concede": "This is a genuine migration cost. Put a number on it in the TCO rather than waving it away. Note that Windows-heavy shops usually already have PowerShell skills in house."
    },
    {
      "objection": "\"We'll have weaker DR.\"",
      "verdict": "PARTIALLY TRUE — SCOPE IT",
      "answer": "Hyper-V Replica is free and built in, but it is VM-level async replication, not runbook orchestration. VMware's answer is now VCF Protection & Recovery, with SRM absorbed into it.",
      "concede": "Do not oversell Replica as a 1:1 SRM replacement. If they need orchestrated failover with runbooks, price a third-party DR tool into the deal."
    },
    {
      "objection": "\"Broadcom's partner changes don't affect us — we're the customer.\"",
      "verdict": "FOR SERVICE PROVIDERS IT IS THE WHOLE POINT",
      "answer": "THE OPERATOR IS the service provider. The White Label / rental resale model ended 31 Oct 2025; the VCSP Advantage program closed to invite-only 26 Jan 2026; new or renewed VCSP contracts must be coterminous with an existing commitment.",
      "concede": "Reframe from price to access. The question is not 'what will VMware cost in 2028' but 'will we be permitted to sell it in 2028'."
    }
  ]
} as const
