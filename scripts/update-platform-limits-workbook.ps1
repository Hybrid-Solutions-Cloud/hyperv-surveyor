param(
  [string]$Path = (Join-Path $PSScriptRoot '..\Reference\HyperV_Management_Plane_Comparison.xlsx')
)

$ErrorActionPreference = 'Stop'
Import-Module ImportExcel

$verified = '2026-08-20'
$hyperVLimits = 'https://learn.microsoft.com/windows-server/virtualization/hyper-v/maximum-scale-limits'
$s2dOverview = 'https://learn.microsoft.com/windows-server/storage/storage-spaces/storage-spaces-direct-overview'
$vmmRequirements = 'https://learn.microsoft.com/system-center/vmm/system-requirements?view=sc-vmm-2025'
$vmmHa = 'https://learn.microsoft.com/system-center/vmm/plan-ha-install?view=sc-vmm-2025'
$wacOverview = 'https://learn.microsoft.com/windows-server/manage/windows-admin-center/virtualization-mode-overview'
$wacInstall = 'https://learn.microsoft.com/windows-server/manage/windows-admin-center/install-virtualization-mode'
$wacHa = 'https://learn.microsoft.com/windows-server/manage/windows-admin-center/deploy/high-availability'
$arcRequirements = 'https://learn.microsoft.com/azure/azure-arc/system-center-virtual-machine-manager/support-matrix-for-system-center-virtual-machine-manager'

$entries = @(
  @('Virtual machine', 'Generation 2 VM', 'Virtual processors', '2,048', 'Windows Server 2025 Hyper-V host', 'MS', $verified, $hyperVLimits, 'Generation 1 is limited to 64 virtual processors.'),
  @('Virtual machine', 'Generation 2 VM', 'Memory', '240 TB', 'Windows Server 2025 Hyper-V host', 'MS', $verified, $hyperVLimits, 'The guest operating system can impose a lower limit.'),
  @('Virtual machine', 'Virtual disk', 'VHDX capacity', '64 TB', 'Windows Server 2025 Hyper-V host', 'MS', $verified, $hyperVLimits, 'Legacy VHD is limited to 2,040 GB.'),
  @('Virtual machine', 'Generation 2 VM', 'Virtual SCSI devices', '256', 'Windows Server 2025 Hyper-V host', 'MS', $verified, $hyperVLimits, 'Four SCSI controllers with up to 64 devices each.'),
  @('Virtual machine', 'Generation 2 VM', 'Virtual network adapters', '64 standard', 'Windows Server 2025 Hyper-V host', 'MS', $verified, $hyperVLimits, ''),
  @('Virtual machine', 'VM', 'Checkpoints', '50', 'Windows Server 2025 Hyper-V host', 'MS', $verified, $hyperVLimits, 'Practical use also depends on available storage.'),
  @('Hyper-V host', 'Physical host', 'Running virtual machines', '1,024', 'Windows Server 2025', 'MS', $verified, $hyperVLimits, 'A supported maximum, not a recommended consolidation target.'),
  @('Hyper-V host', 'Physical host', 'Logical processors', '2,048', 'Windows Server 2025', 'MS', $verified, $hyperVLimits, ''),
  @('Hyper-V host', 'Physical host', 'Virtual processors in use', '2,048', 'Windows Server 2025', 'MS', $verified, $hyperVLimits, 'Hyper-V imposes no fixed virtual-processor-to-logical-processor ratio.'),
  @('Hyper-V host', 'Physical host', 'Memory', '4 PB with 5-level paging; 256 TB with 4-level paging', 'Windows Server 2025', 'MS', $verified, $hyperVLimits, 'Platform firmware and hardware can impose lower limits.'),
  @('Failover cluster', 'Hyper-V cluster', 'Nodes per cluster', '64', 'Supported Windows Server versions', 'MS', $verified, $hyperVLimits, ''),
  @('Failover cluster', 'Hyper-V cluster', 'Running virtual machines', '8,000', 'Supported Windows Server versions', 'MS', $verified, $hyperVLimits, 'Capacity planning and failure-domain headroom still apply.'),
  @('Storage Spaces Direct', 'S2D cluster', 'Servers', '2-16', 'Windows Server 2025', 'MS', $verified, $s2dOverview, 'S2D sets the 16-node ceiling for hyperconverged and hybrid designs.'),
  @('Storage Spaces Direct', 'S2D cluster', 'Drives', 'Over 400', 'Windows Server 2025', 'MS', $verified, $s2dOverview, 'Microsoft describes this as a platform-scale figure, not a per-design recommendation.'),
  @('Storage Spaces Direct', 'S2D cluster', 'Storage capacity', 'Up to 4 PB', 'Windows Server 2025', 'MS', $verified, $s2dOverview, 'Raw and usable capacity differ based on resiliency and reserve.'),
  @('Storage Spaces Direct', 'Each server', 'Minimum drive complement', '2 SSDs plus 4 additional drives', 'Windows Server 2025', 'MS', $verified, $s2dOverview, 'Eligible drives must be direct-attached to one server.'),
  @('Storage Spaces Direct', 'Storage network', 'Recommended connectivity', '10+ GbE with RDMA', 'Windows Server 2025', 'MS-REC', $verified, $s2dOverview, 'Microsoft strongly recommends SMB Direct using iWARP or RoCE.'),
  @('SCVMM 2025', 'Management instance', 'Physical hosts', '1,000', 'System Center VMM 2025', 'MS', $verified, $vmmRequirements, 'Tested recommended maximum; topology and operations affect practical scale.'),
  @('SCVMM 2025', 'Management instance', 'Virtual machines', '25,000', 'System Center VMM 2025', 'MS', $verified, $vmmRequirements, 'Tested recommended maximum.'),
  @('SCVMM 2025', 'VMM management server', 'Recommended VM resources', '16 cores; 16 GB RAM; 10 GB application disk', 'System Center VMM 2025', 'MS-REC', $verified, $vmmRequirements, 'The deployment designer adds a separate OS disk allowance and labels it as a tool assumption.'),
  @('SCVMM 2025', 'VMM database', 'Recommended VM resources', '16 cores; 16 GB RAM; 200 GB disk', 'System Center VMM 2025', 'MS-REC', $verified, $vmmRequirements, 'SQL Server 2019, 2022, and 2025 are supported.'),
  @('SCVMM 2025', 'Highly available deployment', 'Required topology', 'HA VMM + HA SQL + HA library', 'System Center VMM 2025', 'MS-REC', $verified, $vmmHa, 'SQL and the library should not be installed on the VMM cluster.'),
  @('Windows Admin Center', 'Administration Mode', 'Typical managed-host scale', '1-50 hosts', 'Current WAC documentation', 'MS', $verified, $wacOverview, 'Guidance rather than a hard enforcement limit.'),
  @('Windows Admin Center', 'Virtualization Mode instance', 'Scale', '1,000 hosts; 25,000 VMs', 'WAC Virtualization Mode preview', 'MS', $verified, $wacOverview, 'Preview capability; reverify before production use.'),
  @('Windows Admin Center', 'Virtualization Mode gateway', 'Minimum VM resources', '4 vCPU; 8 GB RAM; 10 GB free disk', 'WAC Virtualization Mode preview', 'MS', $verified, $wacInstall, 'Administration Mode and Virtualization Mode require separate systems.'),
  @('Windows Admin Center', 'Administration Mode HA gateway', 'Cluster requirements', '2+ nodes; 10 GB CSV', 'Current WAC gateway', 'MS', $verified, $wacHa, 'Active/passive. This is not evidence of a supported Virtualization Mode HA design.'),
  @('Arc-enabled SCVMM', 'SCVMM connection', 'Managed virtual machines', '15,000 per SCVMM server', 'Arc-enabled SCVMM', 'MS', $verified, $arcRequirements, ''),
  @('Arc-enabled SCVMM', 'Arc resource bridge', 'Required free capacity', '4 vCPU; 32 GB RAM; 100 GB disk', 'Arc-enabled SCVMM', 'MS', $verified, $arcRequirements, 'Also requires static addressing, DNS resolution, and outbound connectivity.'),
  @('Arc-enabled SCVMM', 'Arc resource bridge', 'Static IP addresses', '3', 'Arc-enabled SCVMM', 'MS', $verified, $arcRequirements, 'Two appliance VM addresses plus one control-plane address; contiguous addresses are supported by the documented custom range flow.')
)

$resolved = (Resolve-Path $Path).Path
$package = Open-ExcelPackage -Path $resolved
try {
  $existing = $package.Workbook.Worksheets['Platform Limits']
  if ($null -ne $existing) { $package.Workbook.Worksheets.Delete($existing) }
  $sheet = $package.Workbook.Worksheets.Add('Platform Limits')

  $sheet.Cells['A1:I1'].Merge = $true
  $sheet.Cells['A1'].Value = 'Platform Limits & Capabilities'
  $sheet.Cells['A2:I2'].Merge = $true
  $sheet.Cells['A2'].Value = 'Fact-checked Windows Server 2025 Hyper-V, clustering, storage, and management-plane limits. Maximums are not design targets.'
  $headers = @('Category', 'Scope', 'Capability / limit', 'Published value', 'Applies to', 'Basis', 'Verified', 'Source', 'Qualification / design note')
  for ($column = 1; $column -le $headers.Count; $column++) { $sheet.Cells[4, $column].Value = $headers[$column - 1] }
  $entryCount = $entries.Count
  for ($rowIndex = 0; $rowIndex -lt $entryCount; $rowIndex++) {
    for ($column = 0; $column -lt $entries[$rowIndex].Count; $column++) {
      $sheet.Cells[($rowIndex + 5), ($column + 1)].Value = $entries[$rowIndex][$column]
    }
    $sheet.Cells[($rowIndex + 5), 8].Hyperlink = [Uri]$entries[$rowIndex][7]
  }

  $lastRow = $entryCount + 4
  $sheet.Cells[1, 1, $lastRow, 9].Style.Font.Name = 'Arial'
  $sheet.Cells[1, 1, $lastRow, 9].Style.VerticalAlignment = 'Top'
  $sheet.Cells[1, 1, $lastRow, 9].Style.WrapText = $true
  $sheet.Cells['A1'].Style.Font.Size = 16
  $sheet.Cells['A1'].Style.Font.Bold = $true
  $sheet.Cells['A1'].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(31, 56, 100))
  $sheet.Cells['A2'].Style.Font.Size = 10
  $sheet.Cells['A2'].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(89, 89, 89))
  $sheet.Cells['A4:I4'].Style.Font.Bold = $true
  $sheet.Cells['A4:I4'].Style.Font.Size = 10
  $sheet.Cells['A4:I4'].Style.Font.Color.SetColor([System.Drawing.Color]::White)
  $sheet.Cells['A4:I4'].Style.Fill.PatternType = 'Solid'
  $sheet.Cells['A4:I4'].Style.Fill.BackgroundColor.SetColor([System.Drawing.Color]::FromArgb(31, 56, 100))
  $sheet.Cells[5, 1, $lastRow, 9].Style.Font.Size = 9
  $sheet.Cells[5, 1, $lastRow, 1].Style.Font.Bold = $true
  $sheet.Cells[5, 4, $lastRow, 4].Style.Font.Bold = $true
  $sheet.Cells[5, 4, $lastRow, 4].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(31, 78, 121))
  $sheet.Cells[5, 8, $lastRow, 8].Style.Font.Color.SetColor([System.Drawing.Color]::FromArgb(5, 99, 193))
  $sheet.Cells[5, 8, $lastRow, 8].Style.Font.UnderLine = $true
  $sheet.Cells[4, 1, $lastRow, 9].Style.Border.Bottom.Style = 'Hair'
  $sheet.Cells[4, 1, $lastRow, 9].Style.Border.Bottom.Color.SetColor([System.Drawing.Color]::FromArgb(217, 225, 232))
  $sheet.Cells['A:A'].Style.Numberformat.Format = '@'
  $sheet.Cells['G:G'].Style.Numberformat.Format = '@'
  $sheet.Column(1).Width = 23
  $sheet.Column(2).Width = 26
  $sheet.Column(3).Width = 28
  $sheet.Column(4).Width = 28
  $sheet.Column(5).Width = 28
  $sheet.Column(6).Width = 12
  $sheet.Column(7).Width = 14
  $sheet.Column(8).Width = 42
  $sheet.Column(9).Width = 58
  $sheet.Row(1).Height = 25
  $sheet.Row(2).Height = 32
  $sheet.Row(4).Height = 30
  for ($row = 5; $row -le $lastRow; $row++) { $sheet.Row($row).Height = 42 }
  $sheet.View.FreezePanes(5, 1)
  $sheet.Cells[4, 1, $lastRow, 9].AutoFilter = $true

  Close-ExcelPackage $package
}
catch {
  Close-ExcelPackage $package -NoSave
  throw
}

Write-Output "Updated Platform Limits sheet with $entryCount fact-checked entries."
