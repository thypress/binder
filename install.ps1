# THYPRESS Windows Installer
# Usage: iwr https://thypress.org/install.ps1 | iex

$ErrorActionPreference = "Stop"

Write-Host "Installing THYPRESS..." -ForegroundColor Cyan

# Detect architecture
$arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
$binary = "thypress-windows-$arch.exe"

# Fetch latest version from GitHub
Write-Host "Fetching latest version..." -ForegroundColor Yellow
try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/thypress/binder/releases/latest"
    $version = $release.tag_name
    $downloadUrl = "https://github.com/thypress/binder/releases/download/$version/$binary"
} catch {
    Write-Host "✗ Could not fetch latest version" -ForegroundColor Red
    exit 1
}

# Download binary
Write-Host "Downloading $binary..." -ForegroundColor Yellow
$tempFile = "$env:TEMP\thypress.exe"

try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile
} catch {
    Write-Host "✗ Download failed" -ForegroundColor Red
    exit 1
}

# Install to user directory (no admin required)
$installDir = "$env:LOCALAPPDATA\Programs\THYPRESS"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

$installPath = "$installDir\thypress.exe"
Move-Item -Path $tempFile -Destination $installPath -Force

# Add to PATH if not already there
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    Write-Host "Adding to PATH..." -ForegroundColor Yellow
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
    $env:Path = "$env:Path;$installDir"
}

Write-Host ""
Write-Host "✓ THYPRESS $version installed!" -ForegroundColor Green
Write-Host ""
Write-Host "Installed to: $installPath" -ForegroundColor Gray
Write-Host ""
Write-Host "Get started:" -ForegroundColor Cyan
Write-Host "  thypress        # Start dev server" -ForegroundColor Gray
Write-Host "  thypress build  # Build static site" -ForegroundColor Gray
Write-Host "  thypress help   # Show help" -ForegroundColor Gray
Write-Host ""
Write-Host "Note: Restart your terminal if 'thypress' command is not found." -ForegroundColor Yellow
