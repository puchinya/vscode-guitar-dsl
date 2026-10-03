[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateRange(1, 2147483647)]
    [int] $IssueNumber,

    [Parameter(Mandatory = $true, Position = 1, ValueFromRemainingArguments = $true)]
    [string[]] $Description
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

Assert-Command git
Assert-Command gh

$descriptionText = ($Description -join ' ').Trim()
if ([string]::IsNullOrWhiteSpace($descriptionText)) {
    throw 'A short English description is required.'
}

$repoRoot = Invoke-Checked git @('rev-parse', '--show-toplevel')
if ([string]::IsNullOrWhiteSpace($repoRoot)) {
    throw 'Run this script inside a Git repository.'
}
Set-Location $repoRoot

& gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI is not authenticated. Run: gh auth login'
}

$status = Invoke-Checked git @('status', '--porcelain')
if (-not [string]::IsNullOrWhiteSpace($status)) {
    throw "Working tree is not clean. Commit, stash, or discard existing changes first.`n$status"
}

$repository = Invoke-Checked gh @(
    'repo', 'view',
    '--json', 'nameWithOwner',
    '--jq', '.nameWithOwner'
)

$defaultBranch = Invoke-Checked gh @(
    'repo', 'view',
    '--json', 'defaultBranchRef',
    '--jq', '.defaultBranchRef.name'
)

if ([string]::IsNullOrWhiteSpace($defaultBranch) -or $defaultBranch -eq 'null') {
    throw 'Could not determine the remote default branch.'
}

& gh issue view $IssueNumber --repo $repository *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Issue #$IssueNumber does not exist or is not accessible in $repository."
}

$normalized = $descriptionText.Normalize(
    [System.Text.NormalizationForm]::FormD
).ToLowerInvariant()

$asciiCharacters = New-Object System.Collections.Generic.List[char]
foreach ($char in $normalized.ToCharArray()) {
    $category = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($char)
    if ($category -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) {
        $asciiCharacters.Add($char)
    }
}

$asciiText = -join $asciiCharacters
$slug = [System.Text.RegularExpressions.Regex]::Replace($asciiText, '[^a-z0-9]+', '-')
$slug = $slug.Trim('-')
$slug = [System.Text.RegularExpressions.Regex]::Replace($slug, '-{2,}', '-')
if ($slug.Length -gt 48) {
    $slug = $slug.Substring(0, 48).TrimEnd('-')
}

if ([string]::IsNullOrWhiteSpace($slug)) {
    throw 'Description could not be converted to an ASCII branch slug; provide a short English description.'
}

$branchName = "feature/${IssueNumber}-${slug}"

Invoke-Checked git @('fetch', 'origin', $defaultBranch) | Out-Null
& git fetch origin $branchName *> $null

$currentBranch = Invoke-Checked git @('branch', '--show-current')
$branchChanged = $false

if ($currentBranch -eq $branchName) {
    # Already on the requested branch
} else {
    & git show-ref --verify --quiet "refs/heads/$branchName"
    if ($LASTEXITCODE -eq 0) {
        Invoke-Checked git @('switch', $branchName) | Out-Null
        $branchChanged = $true
    } else {
        & git show-ref --verify --quiet "refs/remotes/origin/$branchName"
        if ($LASTEXITCODE -eq 0) {
            Invoke-Checked git @('switch', '--track', '-c', $branchName, "origin/$branchName") | Out-Null
            $branchChanged = $true
        } else {
            Invoke-Checked git @('switch', '-c', $branchName, "origin/$defaultBranch") | Out-Null
            $branchChanged = $true
        }
    }
}

# Clean stale out/ artifacts on actual source branch switch
if ($branchChanged) {
    $outDir = Join-Path $repoRoot 'out'
    if (Test-Path -LiteralPath $outDir) {
        Remove-Item -LiteralPath $outDir -Recurse -Force
    }
}

[Console]::Out.WriteLine($branchName)
