[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$downloadUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$versionUrl = "$downloadUrl.ver"
$checksumUrl = "$downloadUrl.sha256"
$repoRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $repoRoot ".tools"
$installRoot = Join-Path $toolsRoot "ffmpeg"
$binRoot = Join-Path $installRoot "bin"
$ffmpegExe = Join-Path $binRoot "ffmpeg.exe"
$ffprobeExe = Join-Path $binRoot "ffprobe.exe"
$versionFile = Join-Path $installRoot ".aurawave-version"

function Test-FFmpegInstall {
    if (-not (Test-Path -LiteralPath $ffmpegExe -PathType Leaf)) {
        return $false
    }
    if (-not (Test-Path -LiteralPath $ffprobeExe -PathType Leaf)) {
        return $false
    }

    try {
        & $ffmpegExe -version *> $null
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
}

function ConvertTo-ResponseText {
    param([object]$Content)

    if ($Content -is [byte[]]) {
        return [Text.Encoding]::UTF8.GetString($Content).Trim()
    }
    return ([string]$Content).Trim()
}

if ([Net.ServicePointManager]::SecurityProtocol -band [Net.SecurityProtocolType]::Tls12) {
    # TLS 1.2 is already enabled.
}
else {
    [Net.ServicePointManager]::SecurityProtocol = (
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    )
}

$localIsValid = Test-FFmpegInstall
$localVersion = ""
if (Test-Path -LiteralPath $versionFile -PathType Leaf) {
    $localVersion = (Get-Content -LiteralPath $versionFile -Raw).Trim()
}

try {
    $versionResponse = Invoke-WebRequest -UseBasicParsing -Uri $versionUrl -TimeoutSec 30
    $remoteVersion = ConvertTo-ResponseText $versionResponse.Content
}
catch {
    if ($localIsValid -and -not $Force) {
        Write-Warning "Could not check for a newer FFmpeg release. Using bundled version '$localVersion'."
        exit 0
    }
    Write-Error "Could not check the FFmpeg release version: $($_.Exception.Message)"
    exit 1
}

if ($localIsValid -and -not $Force -and $localVersion -eq $remoteVersion) {
    Write-Host "    Bundled FFmpeg $localVersion is current."
    exit 0
}

New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
$workRoot = Join-Path $toolsRoot (".ffmpeg-install-" + [Guid]::NewGuid().ToString("N"))
$archivePath = Join-Path $workRoot "ffmpeg-release-essentials.zip"
$extractRoot = Join-Path $workRoot "extracted"
$previousRoot = Join-Path $toolsRoot "ffmpeg.previous"

try {
    New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
    Write-Host "    Downloading FFmpeg $remoteVersion..."
    Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archivePath -TimeoutSec 600

    $checksumResponse = Invoke-WebRequest -UseBasicParsing -Uri $checksumUrl -TimeoutSec 30
    $checksumText = ConvertTo-ResponseText $checksumResponse.Content
    $expectedHash = ([regex]::Match($checksumText, '(?i)\b[0-9a-f]{64}\b')).Value.ToUpperInvariant()
    if (-not $expectedHash) {
        throw "The FFmpeg checksum response did not contain a SHA-256 hash."
    }

    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "FFmpeg archive checksum mismatch. Expected $expectedHash but received $actualHash."
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
    $downloadedExe = Get-ChildItem -LiteralPath $extractRoot -Recurse -Filter "ffmpeg.exe" -File |
        Select-Object -First 1
    if (-not $downloadedExe) {
        throw "The FFmpeg archive did not contain ffmpeg.exe."
    }

    $downloadedBin = $downloadedExe.Directory.FullName
    $downloadedRoot = Split-Path -Parent $downloadedBin
    $downloadedProbe = Join-Path $downloadedBin "ffprobe.exe"
    if (-not (Test-Path -LiteralPath $downloadedProbe -PathType Leaf)) {
        throw "The FFmpeg archive did not contain ffprobe.exe."
    }

    & $downloadedExe.FullName -version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "The downloaded FFmpeg executable failed its startup check."
    }

    if (Test-Path -LiteralPath $previousRoot) {
        Remove-Item -LiteralPath $previousRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $installRoot) {
        Move-Item -LiteralPath $installRoot -Destination $previousRoot
    }

    try {
        Move-Item -LiteralPath $downloadedRoot -Destination $installRoot
        Set-Content -LiteralPath $versionFile -Value $remoteVersion -Encoding ASCII
        if (-not (Test-FFmpegInstall)) {
            throw "The installed FFmpeg build failed validation."
        }
    }
    catch {
        if (Test-Path -LiteralPath $installRoot) {
            Remove-Item -LiteralPath $installRoot -Recurse -Force
        }
        if (Test-Path -LiteralPath $previousRoot) {
            Move-Item -LiteralPath $previousRoot -Destination $installRoot
        }
        throw
    }

    if (Test-Path -LiteralPath $previousRoot) {
        Remove-Item -LiteralPath $previousRoot -Recurse -Force
    }
    Write-Host "    Installed and verified FFmpeg $remoteVersion."
}
catch {
    Write-Error "FFmpeg installation failed: $($_.Exception.Message)"
    exit 1
}
finally {
    if (Test-Path -LiteralPath $workRoot) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force
    }
}
