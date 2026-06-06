# Verifies a desktop shortcut for Pi Agent
# Usage: powershell -File scripts/verify-shortcut.ps1 [optional-name]
# Exits 0 on success, 1 on missing shortcut.

$ErrorActionPreference = 'Stop'
$name = if ($args.Count -gt 0) { $args[0] } else { 'Pi Agent.lnk' }
$lnkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) $name

if (-not (Test-Path -LiteralPath $lnkPath)) {
    Write-Host "ERROR: shortcut not found: $lnkPath" -ForegroundColor Red
    exit 1
}

$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($lnkPath)

Write-Host "=== $name ==="
Write-Host ('TargetPath   : ' + $lnk.TargetPath)
Write-Host ('WorkingDir   : ' + $lnk.WorkingDirectory)
Write-Host ('IconLocation : ' + $lnk.IconLocation)
# Note: $lnk.Description is read via WScript.Shell COM in ANSI codepage.
# On a non-UTF8 terminal it may display as mojibake, but the value persisted
# in the .lnk is the original UTF-8 string written by create-shortcut.ps1.
Write-Host ('Description  : ' + $lnk.Description)
Write-Host ('WindowStyle  : ' + $lnk.WindowStyle)
Write-Host ('FullName     : ' + $lnk.FullName)

Write-Host ''
Write-Host '=== File info ==='
Get-Item -LiteralPath $lnkPath | Select-Object LastWriteTime, Length, Attributes | Format-List

exit 0
