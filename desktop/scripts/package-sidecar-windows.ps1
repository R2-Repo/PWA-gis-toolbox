# Package the Python sidecar as gis-sidecar.exe for Tauri externalBin (Windows).
# Requires: Python 3 + pip install pyinstaller
#
# Usage (from repo root, on Windows):
#   powershell -ExecutionPolicy Bypass -File desktop/scripts/package-sidecar-windows.ps1

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$PythonRoot = Join-Path $Root "desktop\sidecar\python"
$OutDir = Join-Path $Root "src-tauri\binaries"
$TargetName = "gis-sidecar-x86_64-pc-windows-msvc.exe"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Push-Location $PythonRoot
try {
    python -m pip install --upgrade pyinstaller | Out-Host
    $entry = Join-Path $PythonRoot "run_sidecar.py"
    python -m PyInstaller `
        --onefile `
        --name gis-sidecar `
        --paths $PythonRoot `
        --distpath $OutDir `
        --workpath (Join-Path $OutDir "build") `
        --specpath (Join-Path $OutDir "spec") `
        $entry
    $built = Join-Path $OutDir "gis-sidecar.exe"
    $target = Join-Path $OutDir $TargetName
    Move-Item -Force $built $target
    Write-Host "Wrote $target"
    Write-Host "Next: add externalBin [\"binaries/gis-sidecar\"] in src-tauri/tauri.conf.json when ready to bundle."
}
finally {
    Pop-Location
}
