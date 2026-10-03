[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateRange(0, 2147483647)]
    [int] $IssueNumber = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Command {
    param([Parameter(Mandatory = $true)][string] $Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string] $FilePath,
        [Parameter()][string[]] $Arguments = @()
    )

    $output = & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }

    return (($output | Out-String).Trim())
}

function Get-RootPackageVersion {
    param([Parameter(Mandatory = $true)][string] $PackageJsonPath)

    if (-not (Test-Path -LiteralPath $PackageJsonPath -PathType Leaf)) {
        throw "package.json not found at: $PackageJsonPath"
    }

    $raw = Get-Content -LiteralPath $PackageJsonPath -Raw -Encoding UTF8
    $json = ConvertFrom-Json -InputObject $raw
    $version = [string]$json.version

    if ([string]::IsNullOrWhiteSpace($version)) {
        throw "package.json has no valid 'version' string."
    }

    return $version.Trim()
}

Assert-Command git
Assert-Command gh

$repoRoot = Invoke-Checked git @('rev-parse', '--show-toplevel')
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    throw 'Run this script inside a Git repository.'
}
Set-Location $repoRoot

$packageJsonPath = Join-Path $repoRoot 'package.json'
if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) {
    throw 'package.json was not found at the Git repository root.'
}

& gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI is not authenticated. Run: gh auth login'
}

$repository = Invoke-Checked gh @(
    'repo', 'view',
    '--json', 'nameWithOwner',
    '--jq', '.nameWithOwner'
)

$targetVersion = Get-RootPackageVersion -PackageJsonPath $packageJsonPath

$milestonesJson = Invoke-Checked gh @(
    'api',
    "repos/$repository/milestones?state=all&per_page=100"
)

$milestones = @()
if (-not [string]::IsNullOrWhiteSpace($milestonesJson)) {
    $milestones = ConvertFrom-Json -InputObject $milestonesJson
}

$matched = $milestones | Where-Object { $_.title -eq $targetVersion } | Select-Object -First 1

if (-not $matched) {
    [Console]::Error.WriteLine("Creating GitHub Milestone: $targetVersion")
    $createdJson = Invoke-Checked gh @(
        'api',
        "repos/$repository/milestones",
        '-X', 'POST',
        '-f', "title=$targetVersion"
    )
    $matched = ConvertFrom-Json -InputObject $createdJson
}

if ($matched.state -ne 'open') {
    [Console]::Error.WriteLine("Reopening closed milestone: $targetVersion")
    Invoke-Checked gh @(
        'api',
        "repos/$repository/milestones/$($matched.number)",
        '-X', 'PATCH',
        '-f', 'state=open'
    ) | Out-Null
}

if ($IssueNumber -gt 0) {
    [Console]::Error.WriteLine("Assigning Issue #$IssueNumber to Milestone '$targetVersion'")
    Invoke-Checked gh @(
        'issue', 'edit',
        [string]$IssueNumber,
        '--milestone', $targetVersion,
        '--repo', $repository
    ) | Out-Null
}

[Console]::Out.WriteLine($targetVersion)
