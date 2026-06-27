param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir,
  [switch]$AcceptResearchLicense,
  [switch]$DownloadCheckpoint
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not $AcceptResearchLicense) {
  throw "apple/ml-sharp model license must be accepted before installation."
}

function Write-Step($Message) {
  Write-Output ""
  Write-Output "==> $Message"
}

function Download-File($Url, $OutFile) {
  $LastError = $null
  for ($Attempt = 1; $Attempt -le 4; $Attempt++) {
    Write-Output "Downloading: $Url (attempt $Attempt)"
    try {
      Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
      if ((Test-Path $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -gt 0)) {
        return
      }
    } catch {
      $LastError = $_
      Write-Output "Invoke-WebRequest failed: $($_.Exception.Message)"
    }

    $Curl = Get-Command "curl.exe" -ErrorAction SilentlyContinue
    if ($Curl) {
      & $Curl.Source -L --retry 5 --retry-delay 2 --output $OutFile $Url
      if ($LASTEXITCODE -eq 0 -and (Test-Path $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -gt 0)) {
        return
      }
      Write-Output "curl.exe failed with exit code $LASTEXITCODE"
    }

    Start-Sleep -Seconds ([Math]::Min(12, 2 * $Attempt))
  }

  if ($LastError) {
    throw $LastError
  }
  throw "Download failed: $Url"
}

$Root = [System.IO.Path]::GetFullPath($InstallDir)
$UvDir = Join-Path $Root "uv"
$UvExe = Join-Path $UvDir "uv.exe"
$SourceDir = Join-Path $Root "source"
$VenvDir = Join-Path $Root ".venv"
$CheckpointDir = Join-Path $Root "checkpoints"
$CheckpointPath = Join-Path $CheckpointDir "sharp_2572gikvuh.pt"
$SharpExe = Join-Path $VenvDir "Scripts\sharp.exe"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"
$MinCheckpointBytes = 1024 * 1024 * 1024

function Test-Checkpoint($FilePath) {
  if (-not (Test-Path $FilePath)) {
    return $false
  }

  $Item = Get-Item -LiteralPath $FilePath
  if ($Item.Length -lt $MinCheckpointBytes) {
    Write-Host "Checkpoint is too small ($($Item.Length) bytes). It will be downloaded again."
    return $false
  }

  if (-not (Test-Path $PythonExe)) {
    return $true
  }

  & $PythonExe -c "import sys, torch; torch.load(sys.argv[1], weights_only=True); print('checkpoint ok')" $FilePath
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Checkpoint validation failed. It will be downloaded again."
    return $false
  }

  return $true
}

New-Item -ItemType Directory -Path $Root -Force | Out-Null
New-Item -ItemType Directory -Path $UvDir -Force | Out-Null

if (-not (Test-Path $UvExe)) {
  Write-Step "Installing uv runtime manager"
  $UvZip = Join-Path $Root "uv.zip"
  $UvExtract = Join-Path $Root "uv-extract"
  Remove-Item -LiteralPath $UvZip -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $UvExtract -Recurse -Force -ErrorAction SilentlyContinue
  Download-File "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip" $UvZip
  Expand-Archive -Path $UvZip -DestinationPath $UvExtract -Force
  $DownloadedUv = Get-ChildItem -LiteralPath $UvExtract -Recurse -Filter "uv.exe" | Select-Object -First 1
  if (-not $DownloadedUv) {
    throw "uv.exe was not found in downloaded archive."
  }
  Copy-Item -LiteralPath $DownloadedUv.FullName -Destination $UvExe -Force
  Remove-Item -LiteralPath $UvZip -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $UvExtract -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path (Join-Path $SourceDir "requirements.txt"))) {
  Write-Step "Downloading apple/ml-sharp source"
  $SharpZip = Join-Path $Root "ml-sharp-main.zip"
  $SharpExtract = Join-Path $Root "ml-sharp-extract"
  Remove-Item -LiteralPath $SharpZip -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $SharpExtract -Recurse -Force -ErrorAction SilentlyContinue
  Download-File "https://github.com/apple/ml-sharp/archive/refs/heads/main.zip" $SharpZip
  Expand-Archive -Path $SharpZip -DestinationPath $SharpExtract -Force
  $DownloadedSource = Get-ChildItem -LiteralPath $SharpExtract -Directory | Select-Object -First 1
  if (-not $DownloadedSource) {
    throw "ml-sharp source directory was not found in downloaded archive."
  }
  Move-Item -LiteralPath $DownloadedSource.FullName -Destination $SourceDir -Force
  Remove-Item -LiteralPath $SharpZip -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $SharpExtract -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Step "Preparing Python 3.13 virtual environment"
& $UvExe python install 3.13
if ($LASTEXITCODE -ne 0) {
  throw "uv python install failed with exit code $LASTEXITCODE"
}
if (-not (Test-Path (Join-Path $VenvDir "Scripts\python.exe"))) {
  & $UvExe venv $VenvDir --python 3.13
  if ($LASTEXITCODE -ne 0) {
    throw "uv venv failed with exit code $LASTEXITCODE"
  }
} else {
  Write-Output "Virtual environment already exists: $VenvDir"
}

Write-Step "Installing ml-sharp Python dependencies"
Push-Location $SourceDir
try {
  & $UvExe pip install --python (Join-Path $VenvDir "Scripts\python.exe") -r (Join-Path $SourceDir "requirements.txt")
  if ($LASTEXITCODE -ne 0) {
    throw "uv pip install failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

if ($DownloadCheckpoint) {
  Write-Step "Downloading SHARP checkpoint"
  New-Item -ItemType Directory -Path $CheckpointDir -Force | Out-Null
  if ((Test-Path $CheckpointPath) -and (-not (Test-Checkpoint $CheckpointPath))) {
    Remove-Item -LiteralPath $CheckpointPath -Force -ErrorAction SilentlyContinue
  }
  for ($Attempt = 1; $Attempt -le 3; $Attempt++) {
    if (-not (Test-Path $CheckpointPath)) {
      Download-File "https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt" $CheckpointPath
    }
    if (Test-Checkpoint $CheckpointPath) {
      break
    }
    Remove-Item -LiteralPath $CheckpointPath -Force -ErrorAction SilentlyContinue
    if ($Attempt -eq 3) {
      throw "Downloaded SHARP checkpoint is incomplete or unreadable after $Attempt attempts."
    }
  }
  $env:PARTICLE_SHARP_CHECKPOINT = $CheckpointPath
}

Write-Step "Verifying sharp CLI"
if (-not (Test-Path $SharpExe)) {
  throw "sharp.exe was not installed at $SharpExe"
}

& $SharpExe --help | Select-Object -First 40

Write-Step "Done"
Write-Output "InstallDir: $Root"
Write-Output "SharpExe: $SharpExe"
if (Test-Path $CheckpointPath) {
  Write-Output "Checkpoint: $CheckpointPath"
}
