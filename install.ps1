#!/usr/bin/env pwsh
# Installer for upbeat-internal-skills
# Usage:
#   .\install.ps1 ticket develop wiki redmine    # install named components
#   .\install.ps1 --list                          # list everything available
#   .\install.ps1 --uninstall ticket redmine      # remove named components

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
)

$ErrorActionPreference = "Stop"
$RepoRoot = $PSScriptRoot
$CommandsDir = Join-Path $RepoRoot ".claude\commands"
$UserCommandsDir = Join-Path $HOME ".claude\commands"

function Get-Skills {
    if (-not (Test-Path $CommandsDir)) { return @() }
    Get-ChildItem -Path $CommandsDir -Filter "*.md" | ForEach-Object { $_.BaseName }
}

function Get-Mcps {
    Get-ChildItem -Path $RepoRoot -Directory -Filter "*-mcp" | ForEach-Object {
        $_.Name -replace "-mcp$", ""
    }
}

function Show-List {
    Write-Host "`nAvailable skills (slash commands):" -ForegroundColor Cyan
    Get-Skills | ForEach-Object { Write-Host "  /$_" }
    Write-Host "`nAvailable MCPs:" -ForegroundColor Cyan
    Get-Mcps | ForEach-Object { Write-Host "  $_" }
    Write-Host "`nInstall examples:" -ForegroundColor Yellow
    Write-Host "  .\install.ps1 ticket wiki redmine"
    Write-Host "  .\install.ps1 --uninstall ticket"
    Write-Host ""
}

function Install-Skill {
    param([string]$Name)
    $src = Join-Path $CommandsDir "$Name.md"
    if (-not (Test-Path $src)) {
        Write-Host "  [skip] skill '$Name' not found in $CommandsDir" -ForegroundColor Yellow
        return $false
    }
    if (-not (Test-Path $UserCommandsDir)) {
        New-Item -ItemType Directory -Path $UserCommandsDir -Force | Out-Null
    }
    $dst = Join-Path $UserCommandsDir "$Name.md"
    Copy-Item -Path $src -Destination $dst -Force
    Write-Host "  [ok] /$Name -> $dst" -ForegroundColor Green
    return $true
}

function Uninstall-Skill {
    param([string]$Name)
    $dst = Join-Path $UserCommandsDir "$Name.md"
    if (Test-Path $dst) {
        Remove-Item $dst -Force
        Write-Host "  [ok] removed /$Name" -ForegroundColor Green
        return $true
    }
    Write-Host "  [skip] /$Name was not installed" -ForegroundColor Yellow
    return $false
}

function Get-McpEnvVars {
    param([string]$Name)
    $envs = @{}
    switch ($Name) {
        "redmine" {
            $url = if ($env:REDMINE_URL) { $env:REDMINE_URL } else { Read-Host "REDMINE_URL (e.g. http://192.168.1.139:58088)" }
            $key = if ($env:REDMINE_API_KEY) { $env:REDMINE_API_KEY } else { Read-Host "REDMINE_API_KEY" }
            $envs["REDMINE_URL"] = $url
            $envs["REDMINE_API_KEY"] = $key
        }
    }
    return $envs
}

function Install-Mcp {
    param([string]$Name)
    $dir = Join-Path $RepoRoot "$Name-mcp"
    if (-not (Test-Path $dir)) {
        Write-Host "  [skip] MCP '$Name' not found ($dir does not exist)" -ForegroundColor Yellow
        return $false
    }

    $entry = $null
    if (Test-Path (Join-Path $dir "package.json")) {
        Write-Host "  [npm] installing dependencies for $Name..." -ForegroundColor Cyan
        Push-Location $dir
        try { npm install --silent } finally { Pop-Location }
        $entry = "node `"$(Join-Path $dir 'server.js')`""
    } elseif (Test-Path (Join-Path $dir "server.py")) {
        $entry = "python `"$(Join-Path $dir 'server.py')`""
    } else {
        Write-Host "  [skip] no package.json or server.py in $dir" -ForegroundColor Yellow
        return $false
    }

    $envs = Get-McpEnvVars -Name $Name
    $envFlags = @()
    foreach ($k in $envs.Keys) { $envFlags += "-e"; $envFlags += "$k=$($envs[$k])" }

    Write-Host "  [claude] registering MCP '$Name' (user scope)..." -ForegroundColor Cyan
    & claude mcp remove $Name --scope user 2>$null | Out-Null
    $cmdArgs = @("mcp", "add", $Name, "--scope", "user") + $envFlags + @("--") + $entry.Split(" ", 2)
    & claude @cmdArgs
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [ok] MCP '$Name' registered" -ForegroundColor Green
        return $true
    } else {
        Write-Host "  [fail] claude mcp add returned $LASTEXITCODE" -ForegroundColor Red
        return $false
    }
}

function Uninstall-Mcp {
    param([string]$Name)
    & claude mcp remove $Name --scope user 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [ok] removed MCP '$Name'" -ForegroundColor Green
        return $true
    }
    Write-Host "  [skip] MCP '$Name' was not installed" -ForegroundColor Yellow
    return $false
}

# ── Main ──────────────────────────────────────────────────────────────────────

if (-not $Args -or $Args.Count -eq 0 -or $Args -contains "--help" -or $Args -contains "-h") {
    Show-List
    exit 0
}

if ($Args -contains "--list") {
    Show-List
    exit 0
}

$uninstallMode = $false
$names = @()
foreach ($a in $Args) {
    if ($a -eq "--uninstall" -or $a -eq "-u") { $uninstallMode = $true; continue }
    $names += $a
}

if ($names.Count -eq 0) {
    Write-Host "No components specified. Use --list to see what's available." -ForegroundColor Yellow
    exit 1
}

$skills = Get-Skills
$mcps = Get-Mcps

$action = if ($uninstallMode) { "Uninstalling" } else { "Installing" }
Write-Host "`n$action: $($names -join ', ')`n" -ForegroundColor Cyan

foreach ($name in $names) {
    $isSkill = $skills -contains $name
    $isMcp = $mcps -contains $name
    if (-not $isSkill -and -not $isMcp) {
        Write-Host "[$name] not found as either skill or MCP" -ForegroundColor Red
        continue
    }
    Write-Host "[$name]"
    if ($uninstallMode) {
        if ($isSkill) { Uninstall-Skill -Name $name | Out-Null }
        if ($isMcp) { Uninstall-Mcp -Name $name | Out-Null }
    } else {
        if ($isSkill) { Install-Skill -Name $name | Out-Null }
        if ($isMcp) { Install-Mcp -Name $name | Out-Null }
    }
}

if (-not $uninstallMode) {
    Write-Host "`nDone. Restart Claude Code so new commands and MCP servers load." -ForegroundColor Green
} else {
    Write-Host "`nDone." -ForegroundColor Green
}
